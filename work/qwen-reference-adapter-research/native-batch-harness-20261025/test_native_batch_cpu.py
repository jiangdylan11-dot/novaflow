"""CPU-only safety tests. No live sockets, service processes or GPU calls."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("qa_native_batch", HERE / "run-native-batch.py")
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)
rt = batch.rt


def fake_case(index):
    return {"id": f"case-{index}", "formalCaseDirectory": str(HERE / f"case-{index}"), "files": [],
        "references": [{"sha256": batch.SOURCE_SHA}, {"sha256": str(index) * 64}],
        "renderer": {"path": "same-renderer", "sha256": "same"}, "protocolFrame": {"system": "same system", "user": "same user"},
        "canonicalGraph": {"model": "same-model", "cfg": 3}, "graph": {"native": True}}


class NativeBatchCPUTest(unittest.TestCase):
    def temporary(self):
        temp = tempfile.TemporaryDirectory(prefix="cpu-test-", dir=HERE)
        self.addCleanup(temp.cleanup)
        root = Path(temp.name).resolve()
        self.assertTrue(root.is_relative_to(HERE.resolve()))
        return root

    def test_six_and_eight_cases_freeze_without_service_or_process(self):
        root = self.temporary()
        for count in (6, 8):
            target = root / f"plan{count}.json"
            with patch.object(batch, "native_case", side_effect=[fake_case(i) for i in range(1, count + 1)]), patch.object(rt, "port_open", side_effect=AssertionError("No sockets in freeze")), patch.object(rt.OwnedServer, "start", side_effect=AssertionError("No process")), contextlib.redirect_stdout(io.StringIO()):
                batch.freeze_plan([root / str(i) for i in range(count)], target)
            plan = rt.read(target)
            self.assertEqual(len(plan["cases"]), count)
            self.assertEqual(plan["generation"]["negativePrompt"], "")
            self.assertFalse(plan["generation"]["layerNodePresent"])

    def test_range_rejects_one_and_nine(self):
        root = self.temporary()
        for count in (1, 9):
            with self.assertRaisesRegex(RuntimeError, "two to eight"), patch.object(batch, "native_case", side_effect=AssertionError("Range fails first")):
                batch.freeze_plan([root / str(i) for i in range(count)], root / f"bad{count}.json")

    def test_protocol_mismatch_rejected(self):
        root = self.temporary()
        cases = [fake_case(1), fake_case(2)]
        cases[1]["protocolFrame"]["user"] = "individual style instruction"
        with patch.object(batch, "native_case", side_effect=cases), self.assertRaisesRegex(RuntimeError, "fixed protocol"):
            batch.freeze_plan([root / "one", root / "two"], root / "bad.json")
        self.assertFalse((root / "bad.json").exists())

    def test_sampling_mismatch_rejected(self):
        root = self.temporary()
        cases = [fake_case(1), fake_case(2)]
        cases[1]["canonicalGraph"]["cfg"] = 1
        with patch.object(batch, "native_case", side_effect=cases), self.assertRaisesRegex(RuntimeError, "Model/negative/sampling/geometry"):
            batch.freeze_plan([root / "one", root / "two"], root / "bad.json")

    def test_duplicate_reference_rejected(self):
        root = self.temporary()
        cases = [fake_case(1), fake_case(2)]
        cases[1]["references"][1] = cases[0]["references"][1]
        with patch.object(batch, "native_case", side_effect=cases), self.assertRaisesRegex(RuntimeError, "distinct actual references"):
            batch.freeze_plan([root / "one", root / "two"], root / "bad.json")

    def test_plan_not_overwritten(self):
        root = self.temporary()
        target = root / "plan.json"
        target.write_bytes(b"keep original plan")
        with patch.object(batch, "native_case", side_effect=[fake_case(1), fake_case(2)]), self.assertRaises(FileExistsError):
            batch.freeze_plan([root / "one", root / "two"], target)
        self.assertEqual(target.read_bytes(), b"keep original plan")

    def test_active_flash_rejected_without_http(self):
        with patch.object(rt, "port_open", side_effect=lambda port: port == 8198), patch.object(rt, "http", side_effect=AssertionError("No HTTP needed")), self.assertRaisesRegex(RuntimeError, "8198 is active"):
            rt.other_services_idle()

    def test_occupied_comfy_queue_rejected(self):
        queue = {"queue_running": [["existing-user-job"]], "queue_pending": []}
        with patch.object(rt, "port_open", side_effect=lambda port: port == 8188), patch.object(rt, "http", return_value=queue) as http, self.assertRaisesRegex(RuntimeError, "occupied"):
            rt.other_services_idle()
        http.assert_called_once_with("http://127.0.0.1:8188", "/queue")

    def test_nonempty_runroot_not_overwritten(self):
        root = self.temporary()
        plan = root / "plan.json"
        plan.write_text(json.dumps({"schema": "nf.qa.frozen-native-reference-batch.v1", "cases": [{}, {}]}))
        run = root / "run"
        run.mkdir()
        keep = run / "keep.txt"
        keep.write_bytes(b"keep unrelated work")
        with self.assertRaisesRegex(RuntimeError, "Nonempty run root"), patch.object(rt, "port_open", side_effect=AssertionError("Refuse before network")):
            batch.preflight(plan, run)
        self.assertEqual(keep.read_bytes(), b"keep unrelated work")

    def test_no_run_flag_never_constructs_owned_process(self):
        args = [str(HERE / "run-native-batch.py"), "--plan", "plan.json", "--run-root", "run"]
        with patch.object(sys, "argv", args), patch.object(batch, "preflight", return_value=({"jobOrder": ["a", "b"]}, [])), patch.object(rt, "OwnedServer", side_effect=AssertionError("--run required")), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(batch.main(), 0)

    def test_independent_analysis_total_retained(self):
        fields, files = batch.analysis_timing({"totalMs": 67500, "requestMs": 26000}, self.temporary())
        self.assertEqual(fields["analysisTimingScope"], "independent-analysis")
        self.assertEqual(fields["originalAnalysisTotalSeconds"], 67.5)
        self.assertEqual(fields["originalAnalysisRequestSeconds"], 26)
        self.assertIsNone(fields["sharedAnalysisTimingProvenance"])
        self.assertEqual(files, [])

    def test_missing_analysis_total_is_null_not_zero(self):
        fields, _ = batch.analysis_timing({"requestMs": 23000}, self.temporary())
        self.assertIsNone(fields["originalAnalysisTotalSeconds"])
        self.assertEqual(fields["originalAnalysisRequestSeconds"], 23)
        self.assertEqual(fields["analysisTimingScope"], "request-only-total-unavailable")
        for invalid in (-1, True, float("nan")):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "Invalid analysis timing"):
                batch.analysis_timing({"requestMs": invalid}, self.temporary())

    def shared_timing_fixture(self):
        root = self.temporary()
        ad = root / "case-one" / "flash-analysis"
        ad.mkdir(parents=True)
        shared = root / "shared"
        shared.mkdir()
        for name in ("load.json", "identity.json", "release.json", "after-status.json"):
            (shared / name).write_text('{"ok":true}', encoding="utf-8")
        for name in ("identity.json", "release.json"):
            (ad / name).write_bytes((shared / name).read_bytes())
        result = {"ok": True, "model": "native-model", "requestMs": 23000, "promptSHA256": "prompt",
                  "finishReason": "stop", "sharedBatchCompleted": True, "sharedLoadUnattributed": True,
                  "sharedSettingsSHA256": "settings", "sharedBatchResult": str(shared / "result.json")}
        rt.save(shared / "result.json", {"ok": True, "resourcesReleased": True, "resourceStop": None,
            "sharedSettingsSHA256": "settings", "sharedLoadMs": 41000, "sharedUnloadMs": 5000,
            "batchTotalMs": 130000, "requests": [{"case": "case-one", **result}]})
        provenance = {"sharedBatchResult": str(shared / "result.json"), "sharedSettingsSHA256": "settings",
            "independentCaseUnload": False, "copiedOnlyAfterSharedReleaseConfirmed": True,
            "sharedLoadReceipt": str(shared / "load.json"), "sharedIdentityReceipt": str(shared / "identity.json"),
            "sharedReleaseReceipt": str(shared / "release.json"), "sharedAfterStatus": str(shared / "after-status.json")}
        for name in ("identity.json", "release.json"):
            provenance[name + "SHA256"] = rt.digest((shared / name).read_bytes())
        rt.save(ad / "shared-runtime-provenance.json", provenance)
        return ad, result, shared

    def test_shared_analysis_request_and_overhead_remain_separate(self):
        ad, result, shared = self.shared_timing_fixture()
        fields, files = batch.analysis_timing(result, ad)
        self.assertEqual(fields["analysisTimingScope"], "shared-batch-request-only")
        self.assertEqual(fields["originalAnalysisRequestSeconds"], 23)
        self.assertIsNone(fields["originalAnalysisTotalSeconds"])
        provenance = fields["sharedAnalysisTimingProvenance"]
        self.assertEqual(provenance["sharedLoadSeconds"], 41)
        self.assertEqual(provenance["sharedUnloadSeconds"], 5)
        self.assertEqual(provenance["wholeBatchSeconds"], 130)
        self.assertFalse(provenance["allocatedSharedOverheadToThisCase"])
        self.assertIn(shared / "result.json", files)
        self.assertEqual(len(files), 6)

    def test_shared_analysis_incomplete_or_mismatched_receipt_rejected(self):
        ad, result, shared = self.shared_timing_fixture()
        altered = dict(result, requestMs=1)
        with self.assertRaisesRegex(RuntimeError, "batch/request timing identity"):
            batch.analysis_timing(altered, ad)
        (ad / "release.json").write_text('{"ok":false}', encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "copied receipt differs"):
            batch.analysis_timing(result, ad)
        (ad / "shared-runtime-provenance.json").unlink()
        with self.assertRaisesRegex(RuntimeError, "requires both batch"):
            batch.analysis_timing(result, ad)

    def composite_timing_fixture(self):
        ad, result, original = self.shared_timing_fixture()
        first = rt.read(original / "result.json")
        first.update(ok=False, afterStatus={"portOpen": False, "ownedHttpAlive": False, "heavyProcesses": []})
        # A CPU-validated view may recover a complete original answer rejected by
        # the old content gate; it must not rewrite that original request record.
        first["requests"][0]["ok"] = False
        rt.save(original / "result.json", first)
        continued = original.parent / "continued"
        continued.mkdir()
        second = dict(first, ok=True, sharedLoadMs=35000, sharedUnloadMs=4000, batchTotalMs=60000,
                      requests=[{"case": "case-two", "model": "native-model", "requestMs": 7000, "finishReason": "stop", "ok": True}])
        rt.save(continued / "result.json", second)
        final_dir = original.parent / "batch-final"
        final_dir.mkdir()
        result.update(sharedBatchResult=str(final_dir / "result.json"), sharedSessionId="session-1-original")
        sessions = []
        for index, (folder, actual) in enumerate(((original, first), (continued, second)), 1):
            sessions.append({"sessionId": "session-1-original" if index == 1 else "session-2-continuation",
                "caseIds": [row["case"] for row in actual["requests"]], "receiptPath": str(folder / "result.json"),
                "receiptSHA256": rt.digest((folder / "result.json").read_bytes()), "loadMs": actual["sharedLoadMs"],
                "unloadMs": actual["sharedUnloadMs"], "executionMs": actual["batchTotalMs"],
                "startedAtUTC": "2026-10-25T01:00:00+00:00" if index == 1 else "2026-10-25T01:03:00+00:00",
                "finishedAtUTC": "2026-10-25T01:02:10+00:00" if index == 1 else "2026-10-25T01:04:00+00:00"})
        composite = dict(first, ok=True, sessions=sessions, sharedBatchCompleted=True,
            sumLoadsMs=76000, sumUnloadsMs=9000, sumSessionExecutionMs=190000, wallClockSpanMs=240000,
            wallClockSpanIncludesInterSessionGap=True,
            requests=[{"case": "case-one", **result}, {**second["requests"][0], "sharedSessionId": "session-2-continuation"}])
        rt.save(final_dir / "result.json", composite)
        provenance = rt.read(ad / "shared-runtime-provenance.json")
        provenance.update(sharedBatchResult=result["sharedBatchResult"], sharedSessionId=result["sharedSessionId"],
                          sharedSessionResult=str(original / "result.json"), sharedSessionResultSHA256=sessions[0]["receiptSHA256"])
        rt.save(ad / "shared-runtime-provenance.json", provenance)
        return ad, result, final_dir

    def test_composite_preserves_original_session_and_distinguishes_wall_time(self):
        ad, result, _ = self.composite_timing_fixture()
        fields, _ = batch.analysis_timing(result, ad)
        self.assertEqual(fields["analysisTimingScope"], "composite-shared-batch-request-only")
        self.assertIsNone(fields["originalAnalysisTotalSeconds"])
        self.assertEqual(fields["originalAnalysisRequestSeconds"], 23)
        shared = fields["sharedAnalysisTimingProvenance"]
        self.assertEqual(shared["actualSession"]["loadSeconds"], 41)
        self.assertEqual(shared["sumSharedLoadSeconds"], 76)
        self.assertEqual(shared["sumSessionExecutionSeconds"], 190)
        self.assertEqual(shared["wallClockSpanSeconds"], 240)
        self.assertTrue(shared["wallClockSpanIncludesInterSessionGap"])
        self.assertFalse(shared["allocatedSharedOverheadToThisCase"])

    def test_composite_wrong_session_or_timing_sum_rejected(self):
        ad, result, final_dir = self.composite_timing_fixture()
        with self.assertRaisesRegex(RuntimeError, "session identity mismatch"):
            batch.analysis_timing(dict(result, sharedSessionId="session-2-continuation"), ad)
        composite = rt.read(final_dir / "result.json")
        composite["sumLoadsMs"] = 35000
        rt.save(final_dir / "result.json", composite)
        with self.assertRaisesRegex(RuntimeError, "timing sum mismatch"):
            batch.analysis_timing(result, ad)

    def test_composite_uses_actual_receipt_bytes_without_redundant_view_hashes(self):
        ad, result, _ = self.composite_timing_fixture()
        path = ad / "shared-runtime-provenance.json"
        provenance = rt.read(path)
        for key in ("sharedSettingsSHA256", "identity.jsonSHA256", "release.jsonSHA256"):
            provenance.pop(key)
        rt.save(path, provenance)
        fields, _ = batch.analysis_timing(result, ad)
        self.assertEqual(fields["sharedAnalysisTimingProvenance"]["actualSession"]["sessionId"], "session-1-original")
        (ad / "identity.json").write_text('{"different":true}', encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "copied receipt differs"):
            batch.analysis_timing(result, ad)

    def test_actual_user_eight_validated_formal_cases_cpu_only(self):
        cases = [batch.native_case(batch.AB / f"usr8-{name}-v10n-20261025-formal")
                 for name in ("bright", "dark", "warm", "cg", "soft", "wet", "graphic", "eastern")]
        for index, case in enumerate(cases):
            self.assertTrue(case["nativeSSEToPromptExact"])
            self.assertEqual(case["protocolFrame"], cases[0]["protocolFrame"])
            self.assertEqual(case["canonicalGraph"], cases[0]["canonicalGraph"])
            self.assertIsNone(case["originalAnalysisTotalSeconds"])
            self.assertGreater(case["originalAnalysisRequestSeconds"], 0)
            self.assertEqual(case["analysisTimingScope"], "composite-shared-batch-request-only")
            actual = case["sharedAnalysisTimingProvenance"]["actualSession"]
            self.assertEqual(actual["sessionId"], "session-1-original" if index < 2 else "session-2-continuation")
        self.assertNotIn("torch", sys.modules)

    def test_native_archived_empty_case_cpu_only(self):
        case = batch.native_case(batch.AB / "cg-neutral-cache-v5-empty-negative-formal")
        self.assertTrue(case["nativeSSEToPromptExact"])
        self.assertEqual(case["graph"]["5"]["inputs"]["negative_prompt"], "")
        self.assertNotIn("torch", sys.modules)

    def test_native_archived_nonempty_negative_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "requires an empty negative"):
            batch.native_case(batch.AB / "cg-neutral-cache-v5-formal")
        self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main(verbosity=2)
