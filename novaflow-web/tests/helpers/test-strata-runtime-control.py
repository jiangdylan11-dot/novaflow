"""CPU-only lifecycle tests. No subprocess, HTTP server, model, or GPU is started."""
import copy
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[2] / "worker/src/strata-runtime-control.py"
SPEC = importlib.util.spec_from_file_location("strata_runtime_control", SOURCE)
CONTROL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROL)


class FakeProcess:
    def __init__(self, pid, exe, command, born=1234.5, children=()):
        self.pid, self.path, self.command, self.born = pid, exe, command, born
        self.descendants, self.signals, self.alive = list(children), [], True

    @property
    def info(self):
        return {"pid": self.pid, "exe": self.path}

    def create_time(self):
        return self.born

    def exe(self):
        return self.path

    def cmdline(self):
        return list(self.command)

    def children(self, recursive=False):
        assert recursive
        return [child for child in self.descendants if child.alive]

    def terminate(self):
        self.signals.append("terminate")
        self.alive = False

    def kill(self):
        self.signals.append("kill")
        self.alive = False

    def wait(self, timeout=None):
        if self.alive:
            raise CONTROL.subprocess.TimeoutExpired(self.command, timeout)
        return 0


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.server = {"exe": str(self.root / "strata.exe"), "vision": {"exe": str(self.root / "strata-vision.exe")},
                       "tokenizer": str(self.root / "pack/tokenizer"), "args": ["--pack", str(self.root / "pack")]}
        self.main = {"pythonPath": str(self.root / "python.exe"), "controlRoot": str(self.root / "control"),
                     "serverConfigPath": str(self.root / "server.json"), "baseUrl": "http://127.0.0.1:8198",
                     "receiptPath": str(self.root / "owner.json"), "modelFiles": [{"path": str(self.root / "model.gguf"), "bytes": 3}]}
        self.write_config()
        self.settings = CONTROL.Settings(self.root / "main.json", legacy_diagnostic=True)
        self.child = FakeProcess(11, self.server["exe"], [self.server["exe"], "--serve"])
        self.vision = FakeProcess(12, self.server["vision"]["exe"], [self.server["vision"]["exe"]])
        self.parent = FakeProcess(10, self.settings.python, self.settings.command(), children=[self.child, self.vision])
        self.processes = {item.pid: item for item in [self.parent, self.child, self.vision]}
        self.patch(CONTROL.psutil, "Process", self.process)
        self.patch(CONTROL.psutil, "process_iter", lambda attrs: [item for item in self.processes.values() if item.alive])
        self.patch(CONTROL, "port_open", lambda settings: self.parent.alive)

    def patch(self, target, name, value):
        patcher = mock.patch.object(target, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def process(self, pid):
        if pid not in self.processes or not self.processes[pid].alive:
            raise CONTROL.psutil.NoSuchProcess(pid)
        return self.processes[pid]

    def write_config(self):
        (self.root / "server.json").write_text(json.dumps(self.server), encoding="utf-8")
        (self.root / "main.json").write_text(json.dumps(self.main), encoding="utf-8")

    def owner(self):
        receipt = {"schemaVersion": 1, "configPath": self.settings.path, "serverConfigPath": self.settings.server_path,
                   "baseUrl": self.settings.base, "http": CONTROL.process_identity(self.parent), "children": []}
        owner = CONTROL.Owner(self.settings, receipt)
        owner.capture()
        return owner

    def test_plan_is_explicit_offline_lazy_and_independent(self):
        command = self.settings.command()
        self.assertIn("--offline", command)
        self.assertIn("--lazy", command)
        self.assertEqual(command[0], self.settings.python)
        self.assertIn("8198", command)

    def test_forbidden_port_and_remote_host_rejected(self):
        for url in ["http://127.0.0.1:8188", "http://0.0.0.0:8198", "http://127.0.0.1:8198/path"]:
            self.main["baseUrl"] = url
            self.write_config()
            with self.assertRaises(CONTROL.ControlError):
                CONTROL.Settings(self.root / "main.json")

    def test_wrong_byte_length_preflight_rejected(self):
        for value in [self.settings.python, self.server["exe"], self.server["vision"]["exe"], str(Path(self.settings.control) / "serve/server.py")]:
            Path(value).parent.mkdir(parents=True, exist_ok=True)
            Path(value).write_bytes(b"x")
        (self.root / "model.gguf").write_bytes(b"bad-length")
        with self.assertRaisesRegex(CONTROL.ControlError, "byte length"):
            self.settings.preflight_load()

    def test_preflight_requires_pack_no_automatic_acquisition(self):
        for value in [self.settings.python, self.server["exe"], self.server["vision"]["exe"], str(Path(self.settings.control) / "serve/server.py")]:
            Path(value).parent.mkdir(parents=True, exist_ok=True)
            Path(value).write_bytes(b"x")
        (self.root / "model.gguf").write_bytes(b"abc")
        with self.assertRaisesRegex(CONTROL.ControlError, "pack/tokenizer"):
            self.settings.preflight_load()

    def test_child_ledger_has_exact_identity_and_does_not_modify_config(self):
        before = copy.deepcopy(self.server)
        owner = self.owner()
        self.assertEqual({item["pid"] for item in owner.receipt["children"]}, {11, 12})
        self.assertTrue(all(item["createTime"] == 1234.5 for item in owner.receipt["children"]))
        self.assertEqual(self.server, before)
        self.assertEqual(CONTROL.Owner.read(self.settings).receipt["http"]["pid"], 10)

    def test_native_child_denied_cmdline_still_has_strong_exit_proof(self):
        def denied():
            raise CONTROL.psutil.AccessDenied(self.vision.pid)
        self.patch(self.vision, "cmdline", denied)
        owner = self.owner()
        self.assertEqual({item["pid"] for item in owner.receipt["children"]}, {11, 12})
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        result = CONTROL.unload(self.settings, 1)
        self.assertTrue(result["released"])
        self.assertFalse(self.vision.alive)

    def test_pid_reuse_refused_before_any_signal(self):
        self.owner()
        self.parent.born += 5
        with self.assertRaisesRegex(CONTROL.ControlError, "PID identity changed"):
            CONTROL.unload(self.settings, 1)
        self.assertFalse(any(item.signals for item in self.processes.values()))

    def test_changed_http_command_refused(self):
        self.owner()
        self.parent.command.append("--other")
        with self.assertRaises(CONTROL.ControlError):
            CONTROL.unload(self.settings, 1)
        self.assertFalse(self.parent.signals)

    def test_changed_receipt_configuration_refused(self):
        owner = self.owner()
        owner.receipt["serverConfigPath"] = str(self.root / "foreign.json")
        owner.save()
        with self.assertRaises(CONTROL.ControlError):
            CONTROL.unload(self.settings, 1)
        self.assertFalse(self.parent.signals)

    def test_not_loaded_api_still_stops_vision_and_http(self):
        self.owner()
        self.patch(CONTROL, "http", lambda *args: {"status": "not loaded"})
        result = CONTROL.unload(self.settings, 1)
        self.assertTrue(result["released"])
        self.assertEqual(result["apiUnloadStatus"], "not loaded")
        self.assertFalse(any(item.alive for item in self.processes.values()))

    def test_api_failure_still_releases_owned_tree(self):
        self.owner()
        self.patch(CONTROL, "http", mock.Mock(side_effect=OSError("offline")))
        result = CONTROL.unload(self.settings, 1)
        self.assertTrue(result["released"])
        self.assertEqual(result["apiUnloadStatus"], "unconfirmed")

    def test_dead_http_orphan_uses_durable_child_ledger(self):
        self.owner()
        self.parent.alive = False
        self.patch(CONTROL, "http", mock.Mock(side_effect=AssertionError("must not call HTTP")))
        self.assertTrue(CONTROL.unload(self.settings, 1)["released"])
        self.assertEqual(self.child.signals, ["terminate"])
        self.assertEqual(self.vision.signals, ["terminate"])

    def test_unknown_exact_engine_is_not_killed_and_release_fails(self):
        self.owner()
        foreign = FakeProcess(99, self.server["exe"], [self.server["exe"]])
        self.processes[99] = foreign
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        with self.assertRaisesRegex(CONTROL.ControlError, "not fully confirmed"):
            CONTROL.unload(self.settings, 1)
        self.assertTrue(foreign.alive)
        self.assertFalse(foreign.signals)

    def test_without_receipt_closed_port_is_idempotent(self):
        for item in self.processes.values():
            item.alive = False
        result = CONTROL.unload(self.settings, 1)
        self.assertTrue(result["released"])
        self.assertTrue(result["alreadyStopped"])

    def test_without_receipt_occupied_port_never_kills(self):
        with self.assertRaisesRegex(CONTROL.ControlError, "without an ownership receipt"):
            CONTROL.unload(self.settings, 1)
        self.assertFalse(any(item.signals for item in self.processes.values()))

    def test_second_unload_with_old_receipt_is_idempotent(self):
        self.owner()
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        self.assertTrue(CONTROL.unload(self.settings, 1)["released"])
        self.assertTrue(CONTROL.unload(self.settings, 1)["released"])

    def test_new_child_during_load_is_persisted(self):
        owner = self.owner()
        late = FakeProcess(13, self.server["vision"]["exe"], ["late-vision"])
        self.processes[13] = late
        self.parent.descendants.append(late)
        owner.capture()
        self.assertIn(13, [item["pid"] for item in CONTROL.read_json(self.settings.receipt)["children"]])

    def test_owned_ready_removed_only_after_tree_exit(self):
        owner = self.owner()
        owner.receipt["instanceId"] = "owned-instance"
        owner.save()
        CONTROL.atomic_json(self.settings.ready, {"pid": 10, "instance_id": "owned-instance", "created_at": 1235,
                                                 "bound_host": "127.0.0.1", "bound_port": 8198})
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        self.assertTrue(CONTROL.unload(self.settings, 1)["released"])
        self.assertFalse(Path(self.settings.ready).exists())

    def test_unowned_ready_is_not_deleted(self):
        self.owner()
        CONTROL.atomic_json(self.settings.ready, {"pid": 999, "created_at": 1235, "bound_host": "127.0.0.1", "bound_port": 8198})
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        with self.assertRaisesRegex(CONTROL.ControlError, "Ready file is not owned"):
            CONTROL.unload(self.settings, 1)
        self.assertTrue(Path(self.settings.ready).exists())

    def test_full_load_records_owner_before_http_and_uses_isolated_environment(self):
        self.parent.descendants = []  # Heavy children appear only after POST/load.
        self.patch(self.settings, "preflight_load", lambda: None)
        self.patch(CONTROL, "port_open", lambda settings: False)
        self.patch(CONTROL, "exact_heavy_processes", lambda settings: [])
        original_read = CONTROL.read_json
        def fake_read(path):
            if str(path) == self.settings.ready:
                return {"pid": 10, "created_at": CONTROL.time.time(), "bound_host": "127.0.0.1", "bound_port": 8198,
                        "instance_id": "test-load-instance"}
            return original_read(path)
        self.patch(CONTROL, "read_json", fake_read)
        launched = []
        def fake_popen(command, **kwargs):
            launched.append((command, kwargs))
            return self.parent
        self.patch(CONTROL.subprocess, "Popen", fake_popen)
        def fake_http(settings, method, endpoint, timeout):
            self.assertTrue(Path(settings.receipt).exists())
            if endpoint == "/load":
                self.parent.descendants = [self.child, self.vision]
                return {"status": "loaded"}
            return {"loaded": True}
        self.patch(CONTROL, "http", fake_http)
        result = CONTROL.load(self.settings, 1)
        self.assertTrue(result["loaded"])
        self.assertEqual(set(result["ownedChildPids"]), {11, 12})
        self.assertEqual(launched[0][1]["cwd"], self.settings.control)
        for key in ["STRATA_NO_ACQUIRE", "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PYTHONNOUSERSITE"]:
            self.assertEqual(launched[0][1]["env"][key], "1")

    def test_load_failure_stops_http_and_children(self):
        self.patch(self.settings, "preflight_load", lambda: None)
        self.patch(CONTROL, "port_open", lambda settings: False)
        self.patch(CONTROL, "exact_heavy_processes", lambda settings: [])
        self.patch(CONTROL.subprocess, "Popen", lambda *args, **kwargs: self.parent)
        original_read = CONTROL.read_json
        self.patch(CONTROL, "read_json", lambda path: {"pid": 10, "created_at": CONTROL.time.time(), "bound_host": "127.0.0.1", "bound_port": 8198} if str(path) == self.settings.ready else original_read(path))
        self.patch(CONTROL, "http", mock.Mock(side_effect=OSError("load failed")))
        with self.assertRaisesRegex(OSError, "load failed"):
            CONTROL.load(self.settings, 1)
        self.assertFalse(any(item.alive for item in self.processes.values()))

    def test_seen_child_capture_denied_retains_strong_original_identity(self):
        owner = self.owner()
        original = copy.deepcopy(owner.receipt["children"])
        self.patch(self.vision, "exe", mock.Mock(side_effect=CONTROL.psutil.AccessDenied(self.vision.pid)))
        owner.capture()
        self.assertEqual(owner.receipt["children"], original)
        self.assertFalse(self.vision.signals)

    def test_unseen_child_capture_denied_is_not_adopted(self):
        owner = self.owner()
        new = FakeProcess(99, self.server["exe"], ["unknown"])
        new.exe = mock.Mock(side_effect=CONTROL.psutil.AccessDenied(new.pid))
        self.parent.descendants.append(new)
        with self.assertRaisesRegex(CONTROL.ControlError, "newly observed child"):
            owner.capture()
        self.assertNotIn(99, [item["pid"] for item in owner.receipt["children"]])
        self.assertFalse(new.signals)

    def test_known_child_pid_reuse_refused_without_signaling(self):
        self.owner()
        self.vision.born += 10
        with self.assertRaises(CONTROL.ControlError) as failure:
            CONTROL.unload(self.settings, 0.1)
        self.assertEqual(failure.exception.code, "ownership-mismatch")
        self.assertFalse(any(item.signals for item in self.processes.values()))

    def test_exited_gpu_probe_pid_can_be_reobserved_as_new_owned_engine_instance(self):
        helper = FakeProcess(13, str(self.root / "nvidia-smi.exe"), ["gpu-probe"])
        self.parent.descendants.append(helper)
        self.processes[13] = helper
        owner = self.owner()
        helper.alive = False
        engine = FakeProcess(13, self.server["exe"], [self.server["exe"]], born=helper.born + 10)
        self.processes[13] = engine
        self.parent.descendants.append(engine)
        owner.capture()
        current = next(item for item in owner.receipt["children"] if item["pid"] == 13)
        self.assertEqual(current["createTime"], engine.born)
        self.assertEqual(current["exe"], CONTROL.canonical(engine.path))
        self.assertEqual(owner.receipt["retiredHelpers"][-1]["createTime"], helper.born)
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        self.assertTrue(CONTROL.unload(self.settings, 1)["released"])
        self.assertEqual(engine.signals, ["terminate"])
        self.assertFalse(helper.signals)

    def test_reused_console_pid_outside_owned_tree_is_never_adopted_or_signaled(self):
        helper = FakeProcess(13, str(self.root / "conhost.exe"), ["console"])
        self.parent.descendants.append(helper)
        self.processes[13] = helper
        self.owner()
        helper.alive = False
        foreign = FakeProcess(13, str(self.root / "unrelated.exe"), ["unrelated"], born=helper.born + 10)
        self.processes[13] = foreign
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        self.assertTrue(CONTROL.unload(self.settings, 1)["released"])
        self.assertTrue(foreign.alive)
        self.assertFalse(foreign.signals)

    def test_signal_identity_denied_defers_without_signaling(self):
        identity = CONTROL.process_identity(self.vision, include_cmdline=False)
        self.patch(self.vision, "exe", mock.Mock(side_effect=CONTROL.psutil.AccessDenied(self.vision.pid)))
        CONTROL.signal_owned(identity, "kill")
        self.assertFalse(self.vision.signals)
        self.assertEqual(CONTROL.wait_dead([identity], 0), [identity])

    def test_wait_denied_then_gone_is_proven_by_disappearance(self):
        identity = CONTROL.process_identity(self.vision, include_cmdline=False)
        calls = []
        def exiting():
            calls.append(True)
            if len(calls) < 3:
                raise CONTROL.psutil.AccessDenied(self.vision.pid)
            self.vision.alive = False
            raise CONTROL.psutil.NoSuchProcess(self.vision.pid)
        self.patch(self.vision, "exe", exiting)
        self.assertEqual(CONTROL.wait_dead([identity], 0.5), [])
        self.assertFalse(self.vision.signals)

    def test_persistent_identity_denial_never_releases_or_signals_that_pid(self):
        self.owner()
        self.patch(self.vision, "exe", mock.Mock(side_effect=CONTROL.psutil.AccessDenied(self.vision.pid)))
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        with self.assertRaises(CONTROL.ControlError) as failure:
            CONTROL.unload(self.settings, 0.1)
        self.assertEqual(failure.exception.code, "release-unconfirmed")
        self.assertTrue(self.vision.alive)
        self.assertFalse(self.vision.signals)
        self.assertNotEqual(CONTROL.read_json(self.settings.receipt).get("state"), "released")

    def test_final_process_scan_denial_retries_until_empty(self):
        self.owner()
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        scan = mock.Mock(side_effect=[CONTROL.ControlError("release-unconfirmed", "temporary scan failure"), [], []])
        self.patch(CONTROL, "exact_heavy_processes", scan)
        self.assertTrue(CONTROL.unload(self.settings, 0.5)["released"])
        self.assertGreaterEqual(scan.call_count, 2)

    def test_final_open_port_retries_before_releasing(self):
        self.owner()
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        port = mock.Mock(side_effect=[True, True, False])
        self.patch(CONTROL, "port_open", port)
        self.assertTrue(CONTROL.unload(self.settings, 0.5)["released"])
        self.assertEqual(port.call_count, 3)

    def test_monitor_failure_still_attempts_owned_cleanup(self):
        self.owner()
        @contextlib.contextmanager
        def monitor(owner):
            yield
            raise RuntimeError("simulated monitor I/O error")
        self.patch(CONTROL.Owner, "monitoring", monitor)
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        with self.assertRaisesRegex(RuntimeError, "simulated monitor"):
            CONTROL.unload(self.settings, 0.5)
        self.assertFalse(any(item.alive for item in self.processes.values()))

    def test_parent_command_gone_between_identity_reads_is_dead(self):
        owner = self.owner()
        def gone():
            self.parent.alive = False
            raise CONTROL.psutil.NoSuchProcess(self.parent.pid)
        self.patch(self.parent, "cmdline", gone)
        self.assertIsNone(owner.parent())
        self.assertTrue(CONTROL.unload(self.settings, 0.5)["released"])

    def test_success_diagnostic_is_json_and_excludes_config_secrets(self):
        for item in self.processes.values():
            item.alive = False
        self.main["privateSecret"] = "NEVER_RECORD_SECRET"
        self.server["api_key"] = "NEVER_RECORD_API_KEY"
        self.write_config()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(CONTROL.main(["unload", "--config", str(self.root / "main.json"), "--legacy-diagnostic"]), 0)
        result = json.loads(stdout.getvalue())
        receipt = CONTROL.read_json(self.settings.last_command)
        self.assertTrue(result["released"])
        self.assertEqual(receipt["command"], "unload")
        self.assertEqual(receipt["phase"], "read-owner")
        self.assertEqual(receipt["state"], "complete")
        serialized = json.dumps(receipt)
        self.assertNotIn("NEVER_RECORD", serialized)
        self.assertNotIn("privateSecret", serialized)

    def test_failure_diagnostic_has_phase_error_and_no_secret_body(self):
        self.owner()
        self.parent.born += 5
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(CONTROL.main(["unload", "--config", str(self.root / "main.json"), "--timeout", "0.1", "--legacy-diagnostic"]), 1)
        receipt = CONTROL.read_json(self.settings.last_command)
        self.assertEqual(receipt["errorCode"], "ownership-mismatch")
        self.assertEqual(receipt["state"], "failed")
        self.assertEqual(receipt["phase"], "capture-before-stop")
        self.assertFalse(receipt["result"]["released"])
        # Arbitrary library error text can contain an HTTP body; never persist it.
        self.assertNotIn("secret", json.dumps(CONTROL.error_summary(RuntimeError("secret data:image/png;base64,xyz"))))

    def test_diagnostic_path_cannot_overwrite_ownership_receipt(self):
        self.main["lastCommandPath"] = self.main["receiptPath"]
        self.write_config()
        with self.assertRaisesRegex(CONTROL.ControlError, "must not overwrite"):
            CONTROL.Settings(self.root / "main.json")

    def test_mutation_requires_token_or_explicit_legacy_diagnostic(self):
        strict = CONTROL.Settings(self.root / "main.json")
        for call in (CONTROL.load, CONTROL.unload):
            with self.assertRaises(CONTROL.ControlError) as failure:
                call(strict, .1)
            self.assertEqual(failure.exception.code, "owner-token-required")
        self.assertFalse(any(item.signals for item in self.processes.values()))
        self.assertFalse(Path(strict.receipt).exists())

    def test_busy_b_load_and_b_finally_unload_cannot_touch_active_a(self):
        owner = self.owner()
        owner.receipt["ownerToken"] = "operation-A-token"
        owner.save()
        before = Path(self.settings.receipt).read_bytes()
        b = CONTROL.Settings(self.root / "main.json", owner_token="operation-B-token")
        self.patch(b, "preflight_load", lambda: None)
        with self.assertRaises(CONTROL.ControlError) as failure:
            CONTROL.load(b, .1)
        self.assertEqual(failure.exception.code, "runtime-busy")
        result = CONTROL.unload(b, .1)
        self.assertTrue(result["notOwned"])
        self.assertTrue(result["foreignRuntimePreserved"])
        self.assertEqual(result["releaseScope"], "operation-token")
        self.assertEqual(Path(self.settings.receipt).read_bytes(), before)
        self.assertTrue(all(item.alive and not item.signals for item in self.processes.values()))
        a = CONTROL.Settings(self.root / "main.json", owner_token="operation-A-token")
        self.patch(CONTROL, "http", lambda *args: {"status": "unloaded"})
        self.assertTrue(CONTROL.unload(a, .5)["released"])
        self.assertFalse(any(item.alive for item in self.processes.values()))

    def load_probe_from_receipt(self, state="released"):
        owner = self.owner()
        owner.receipt.update(state=state, ownerToken="operation-A-token")
        owner.save()
        settings = CONTROL.Settings(self.root / "main.json", owner_token="operation-B-token")
        self.patch(settings, "preflight_load", lambda: None)
        self.patch(CONTROL, "port_open", lambda settings: False)
        self.patch(CONTROL, "exact_heavy_processes", lambda settings: [])
        launch = mock.Mock(side_effect=RuntimeError("CPU launch boundary reached"))
        self.patch(CONTROL.subprocess, "Popen", launch)
        for process in self.processes.values():
            process.alive = False
        return owner, settings, launch

    def test_released_reused_http_and_child_can_reach_launch_without_any_signal(self):
        owner, settings, launch = self.load_probe_from_receipt()
        before = Path(settings.receipt).read_bytes()
        replacements = []
        for identity in [owner.receipt["http"], *owner.receipt["children"]]:
            reused = FakeProcess(identity["pid"], str(self.root / "unrelated-node.exe"), ["unrelated"], born=identity["createTime"] + 100)
            self.processes[reused.pid] = reused
            replacements.append(reused)
        with self.assertRaisesRegex(RuntimeError, "CPU launch boundary reached"):
            CONTROL.load(settings, .1)
        launch.assert_called_once()
        self.assertEqual(Path(settings.receipt).read_bytes(), before)
        self.assertTrue(all(process.alive and not process.signals for process in replacements))

    def test_released_same_http_or_child_identity_still_alive_blocks_load(self):
        owner, settings, launch = self.load_probe_from_receipt()
        for process in [self.parent, self.child, self.vision]:
            with self.subTest(pid=process.pid):
                process.alive = True
                with self.assertRaises(CONTROL.ControlError) as failure:
                    CONTROL.load(settings, .1)
                self.assertEqual(failure.exception.code, "runtime-busy")
                process.alive = False
        launch.assert_not_called()
        self.assertFalse(any(process.signals for process in self.processes.values()))

    def test_released_unreadable_identity_blocks_load_without_signal(self):
        owner, settings, launch = self.load_probe_from_receipt()
        for process in [self.parent, self.child]:
            for query in ["create_time", "exe"]:
                with self.subTest(pid=process.pid, query=query):
                    process.alive = True
                    with mock.patch.object(process, query, side_effect=CONTROL.psutil.AccessDenied(process.pid)):
                        with self.assertRaises(CONTROL.ControlError) as failure:
                            CONTROL.load(settings, .1)
                    self.assertEqual(failure.exception.code, "ownership-unconfirmed")
                    process.alive = False
        launch.assert_not_called()
        self.assertFalse(any(process.signals for process in self.processes.values()))

    def test_released_invalid_identity_or_same_time_changed_exe_blocks_load(self):
        owner, settings, launch = self.load_probe_from_receipt()
        original = copy.deepcopy(owner.receipt)
        for field, value in [("pid", -1), ("createTime", float("nan")), ("exe", "relative.exe")]:
            with self.subTest(field=field):
                owner.receipt = copy.deepcopy(original)
                owner.receipt["children"][0][field] = value
                owner.save()
                with self.assertRaises(CONTROL.ControlError) as failure:
                    CONTROL.load(settings, .1)
                self.assertEqual(failure.exception.code, "ownership-mismatch")
        owner.receipt = original
        owner.save()
        self.child.alive = True
        self.child.path = str(self.root / "different.exe")
        with self.assertRaises(CONTROL.ControlError) as failure:
            CONTROL.load(settings, .1)
        self.assertEqual(failure.exception.code, "ownership-mismatch")
        launch.assert_not_called()
        self.assertFalse(any(process.signals for process in self.processes.values()))

    def test_active_and_releasing_reused_pids_still_refused_before_launch(self):
        owner, settings, launch = self.load_probe_from_receipt()
        for state in ["loaded", "releasing"]:
            owner.receipt["state"] = state
            owner.save()
            for identity in [owner.receipt["http"], owner.receipt["children"][0]]:
                with self.subTest(state=state, pid=identity["pid"]):
                    reused = FakeProcess(identity["pid"], str(self.root / "unrelated-node.exe"), ["unrelated"], born=identity["createTime"] + 100)
                    self.processes[reused.pid] = reused
                    with self.assertRaises(CONTROL.ControlError) as failure:
                        CONTROL.load(settings, .1)
                    self.assertEqual(failure.exception.code, "ownership-mismatch")
                    self.assertFalse(reused.signals)
                    reused.alive = False
        launch.assert_not_called()

    def test_released_receipt_still_respects_config_port_heavy_and_ready_guards(self):
        owner, settings, launch = self.load_probe_from_receipt()
        before = copy.deepcopy(owner.receipt)
        owner.receipt["serverConfigPath"] = str(self.root / "foreign.json")
        owner.save()
        with self.assertRaises(CONTROL.ControlError):
            CONTROL.load(settings, .1)
        owner.receipt = before
        owner.save()
        for guard in ["port_open", "exact_heavy_processes"]:
            with self.subTest(guard=guard), mock.patch.object(CONTROL, guard, return_value=True):
                with self.assertRaises(CONTROL.ControlError) as failure:
                    CONTROL.load(settings, .1)
                self.assertEqual(failure.exception.code, "runtime-busy")
        CONTROL.atomic_json(settings.ready, {"pid": 999})
        with self.assertRaises(CONTROL.ControlError) as failure:
            CONTROL.load(settings, .1)
        self.assertEqual(failure.exception.code, "ready-ownership-unconfirmed")
        self.assertTrue(Path(settings.ready).exists())
        launch.assert_not_called()
        self.assertFalse(any(process.signals for process in self.processes.values()))

    def test_owner_token_partial_load_failure_still_cleans_own_tree(self):
        self.settings.owner_token = "operation-A-token"
        self.settings.legacy_diagnostic = False
        self.test_load_failure_stops_http_and_children()
        saved = CONTROL.read_json(self.settings.receipt)
        self.assertEqual(saved["ownerToken"], "operation-A-token")
        self.assertEqual(saved["state"], "released")
        self.assertTrue(CONTROL.unload(self.settings, .1)["released"])

    def test_os_claim_lock_blocks_second_load_but_foreign_unload_is_noop(self):
        owner = self.owner()
        owner.receipt["ownerToken"] = "operation-A-token"
        owner.save()
        b = CONTROL.Settings(self.root / "main.json", owner_token="operation-B-token")
        with CONTROL.operation_lock(self.settings):
            with self.assertRaises(CONTROL.ControlError) as failure:
                CONTROL.load(b, .1)
            self.assertEqual(failure.exception.code, "runtime-busy")
            self.assertTrue(CONTROL.unload(b, .1)["notOwned"])
        self.assertTrue(all(item.alive and not item.signals for item in self.processes.values()))

    def test_legacy_receipt_is_foreign_to_production_token(self):
        self.owner()  # Existing pre-token receipt is not silently adopted.
        b = CONTROL.Settings(self.root / "main.json", owner_token="operation-B-token")
        self.assertTrue(CONTROL.unload(b, .1)["notOwned"])
        self.assertTrue(all(item.alive and not item.signals for item in self.processes.values()))

    def test_partial_http_identity_registration_failure_uses_owned_popen_handle(self):
        self.settings.owner_token = "operation-A-token"
        self.settings.legacy_diagnostic = False
        self.child.alive = self.vision.alive = False  # No /load happened yet.
        self.patch(self.parent, "wait", mock.Mock(return_value=0))
        self.patch(self.settings, "preflight_load", lambda: None)
        self.patch(CONTROL, "port_open", lambda settings: False)
        self.patch(CONTROL, "exact_heavy_processes", lambda settings: [])
        self.patch(CONTROL.subprocess, "Popen", lambda *args, **kwargs: self.parent)
        self.patch(CONTROL, "process_identity", mock.Mock(side_effect=CONTROL.psutil.AccessDenied(self.parent.pid)))
        with self.assertRaises(CONTROL.psutil.AccessDenied):
            CONTROL.load(self.settings, .1)
        self.assertFalse(self.parent.alive)
        self.assertEqual(self.parent.signals, ["terminate"])
        self.assertFalse(Path(self.settings.receipt).exists())

    def test_partial_http_receipt_write_failure_still_stops_new_owned_process(self):
        self.settings.owner_token = "operation-A-token"
        self.settings.legacy_diagnostic = False
        self.child.alive = self.vision.alive = False
        self.patch(self.settings, "preflight_load", lambda: None)
        self.patch(CONTROL, "port_open", lambda settings: False)
        self.patch(CONTROL, "exact_heavy_processes", lambda settings: [])
        self.patch(CONTROL.subprocess, "Popen", lambda *args, **kwargs: self.parent)
        self.patch(CONTROL.Owner, "save", mock.Mock(side_effect=OSError("disk unavailable")))
        with self.assertRaisesRegex(OSError, "disk unavailable"):
            CONTROL.load(self.settings, .1)
        self.assertFalse(self.parent.alive)
        self.assertEqual(self.parent.signals, ["terminate"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
