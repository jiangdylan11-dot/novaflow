"""CPU-only post-run audit. Reads a finished probe; writes reports outside it.

Refuses an active/incomplete controller. No images, controller files, prototype,
services, gallery or product source are changed. --write saves JSON/Markdown.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import time


HERE = Path(__file__).resolve().parent
DEFAULT_PROBE = HERE / "layer-window-fastdisk-probe-20261025"
AB = HERE.parent / "qwen38-strata-deploy-20261024/adapted-ab"
EXPECTED_ORDER = ["bright-off", "bright-on", "dark-off", "dark-on"]
NODE = "NovaFlowQwen21StyleKeyLayerWindowExperimental"
PARAMS = {"model": ["4", 0], "style_reference_index": 1, "high_scale": 0.5,
          "low_scale": 1.5, "beta": 2.0, "layer_start": 24, "layer_end": 31,
          "audit_log": True, "cap_amplification": False, "active_sigma_min": 0.0}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read(path):
    return json.loads(Path(path).read_bytes())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(path, expected):
    data = Path(path).read_bytes()
    require(sha(data) == expected, f"SHA256 mismatch: {path}")
    return data


def receipt(path):
    path = Path(path)
    return {"path": str(path), "sha256": sha(path.read_bytes())}


def differences(a, b, prefix=""):
    if a == b:
        return []
    if isinstance(a, dict) and isinstance(b, dict):
        output = []
        for key in sorted(set(a) | set(b)):
            path = f"{prefix}.{key}" if prefix else key
            if key not in a or key not in b:
                output.append(path)
            else:
                output.extend(differences(a[key], b[key], path))
        return output
    return [prefix]


def decoded(path):
    from PIL import Image
    with Image.open(path) as image:
        size = image.size
        data = image.convert("RGBA").tobytes()
    return {"path": str(path), "size": list(size), "rgbaSHA256": sha(data)}, data


def parse_audit_logs(folder):
    output = []
    for name in ("stdout.log", "stderr.log"):
        for line in (folder / name).read_text(encoding="utf-8", errors="replace").splitlines():
            marker = "Qwen21StyleKeyLayerWindow audit="
            if marker in line:
                parsed, _ = json.JSONDecoder().raw_decode(line.split(marker, 1)[1])
                output.append(parsed)
    return output


def audit_enabled(records):
    require(len(records) == 16, "ON must have sixteen actual conditional forwards")
    targets, bypassed = set(range(24, 32)), set(range(24))
    prefixes, prefix_tokens = [], []
    for index, record in enumerate(records, 1):
        require(record["forwards"] == index and record["active_forwards"] == index, "Unexpected forward sequence")
        require(record["bypassed_forwards"] == 0 and record["previous_override_calls"] == 0, "Unexpected bypass or previous override")
        require(record["key_copies_this_forward"] == 8 and record["key_copies"] == index * 8 and record["target_calls"] == index * 8,
                "Expected eight target-layer K copies per forward")
        require(record["actual_num_layers"] == 32 and record["axes"] == [16, 56, 56] and record["axis0_scale"] == 1.0, "Native layer/axis contract changed")
        require(record["preferred_backend_check"]["non_null_count"] == 0, "Preferred attention backend is not native")
        require(set(map(int, record["selected_target_by_layer"])) == targets, "Unexpected selected layers")
        require(set(record["selected_target_by_layer"].values()) == {index}, "Selected-layer count changed")
        require(set(map(int, record["bypassed_target_by_layer"])) == bypassed, "Unexpected bypassed layers")
        require(set(record["bypassed_target_by_layer"].values()) == {index}, "Bypassed-layer count changed")
        for key in ("style_reference_index", "high_scale", "low_scale", "beta", "layer_start", "layer_end", "cap_amplification", "active_sigma_min"):
            require(record[key] == PARAMS[key], "Runtime audit parameter changed: " + key)
        require(record["latest_layout"]["target_tokens"] == 4800 and len(record["latest_layout"]["references"]) == 2, "Source/style/target layout changed")
        prefixes.append(record["prefix_calls"])
        prefix_tokens.append(record["latest_layout"]["prefix_tokens"])
    # The two CFG contexts have different text. Each first forward fills its own
    # cached prefix. Five causal prefix segments x 32 layers = 160 each.
    require(prefixes == [160] + [320] * 15, "Prefix cache did not stabilize after the two initial conditioning forwards")
    require(prefix_tokens[0] != prefix_tokens[1] and all(value == prefix_tokens[i % 2] for i, value in enumerate(prefix_tokens)),
            "Expected two alternating conditioning-prefix layouts")
    require(set(records[-1]["prefix_by_layer"].values()) == {10}, "Expected five prefix segments per layer for each initial CFG context")
    return {"forwards": 16, "targetLayerCopiesPerForward": 8, "totalKeyCopies": 128,
        "selectedLayers": sorted(targets), "targetHitsPerSelectedLayer": 16, "unselectedTargetLayersBypassed": sorted(bypassed),
        "prefixCallsByForward": prefixes, "prefixTokenCountsByForward": prefix_tokens,
        "prefixComputedOncePerPositiveAndNegativeConditioningContext": True,
        "prefixComputedOnlyOnGlobalFirstForward": False, "prefixCacheStableAfterSecondForward": True,
        "axis0ScaleUnchanged": True, "nativePreferredAttentionVerified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, default=DEFAULT_PROBE)
    parser.add_argument("--write", action="store_true")
    options = parser.parse_args()
    probe = options.probe.resolve()
    require((probe / "result.json").is_file(), "Controller still active: no final result.json; do not audit partial jobs")
    require((probe / "owned-stop.json").is_file(), "Controller cleanup receipt is not present yet")
    overall = read(probe / "result.json")
    require(overall.get("ok") is True and len(overall.get("jobs", [])) == 4, "Controller did not complete four successful jobs; no four-job proof claimed")
    require([r["job"] for r in overall["jobs"]] == EXPECTED_ORDER, "Unexpected job order")
    require(overall["resourceAbortReason"] is None, "Resource guard aborted")
    cleanup = read(probe / "owned-stop.json")
    require(cleanup == overall["ownedProcessCleanup"], "Cleanup receipts disagree")
    require(not cleanup.get("remainingOwnedIdentities") and cleanup.get("port8192ListeningAfterStop") is False, "Owned cleanup incomplete")
    preflight = read(probe / "preflight.json")
    require("--fast-disk" in preflight["command"], "Not the expected fast-disk probe")
    require(preflight["jobOrder"] == EXPECTED_ORDER, "Prepared job order changed")
    owner, load = read(probe / "owned-server.json"), read(probe / "load.json")
    require(owner["command"] == load["command"] == preflight["command"], "Owned process command differs from reviewed launch")
    require(owner["pid"] == load["pid"] and load["ready"] and load["actualClassAndModelCatalogVerified"], "Owned live catalog was not verified")
    catalog = json.loads(checked(probe / "object-info.json", load["objectInfoSHA256"]))
    require(catalog[NODE]["input"] == preflight["prototype"]["INPUT_TYPES"], "Actual loaded node schema differs")
    terminated = cleanup["terminatedOwnedIdentities"]
    require(any(item == owner["identity"] for item in terminated), "Cleanup did not bind the exact owned main identity")
    own_ids = {item["pid"] for item in terminated}
    require(all(item["pid"] == owner["pid"] or item["ppid"] in own_ids for item in terminated), "Cleanup included a process outside owned ancestry")
    for path, expected in preflight["protectedFiles"].items():
        checked(path, expected)
    original_probe = HERE / "layer-window-probe-20261025"
    profile = read(probe / "resource-profile-change.json")
    checked(original_probe / "result.json", profile["originalAttempt"]["resultSHA256"])
    checked(probe / "run-isolated-layer-window.py", profile["newAttempt"]["runnerSHA256"])
    for name, expected in preflight["prototype"]["files"].items():
        checked(Path(preflight["prototype"]["source"]) / name, expected)
        checked(Path(preflight["prototype"]["staged"]) / name, expected)
    rows, graphs, pixel_buffers = [], {}, {}
    baseline_pixels = {}
    for key, overall_job in zip(EXPECTED_ORDER, overall["jobs"]):
        folder = probe / "jobs" / key
        result = read(folder / "result.json")
        require(result == overall_job, "Per-job and controller result disagree")
        style, mode = key.split("-")
        enabled = mode == "on"
        graph = read(folder / "graph.json")
        checked(folder / "graph.json", result["graphSHA256"])
        require(graph["901"] == {"class_type": NODE, "inputs": {"model": ["4", 0], "enabled": enabled, **{k: v for k, v in PARAMS.items() if k != "model"}}}, "Experimental model inputs changed")
        require(graph["7"]["inputs"]["model"] == ["901", 0], "Experimental node is not between cache and sampler")
        pin = preflight["baselines"][style]["pin"]
        baseline_folder = AB / pin["case"]
        original_case = json.loads(checked(baseline_folder / "case.json", pin["case_sha256"]))
        original_graph = json.loads(checked(baseline_folder / "generation-flash/graph.json", pin["graph_sha256"]))
        original_prompt = checked(baseline_folder / "generation-flash/prompt.txt", pin["prompt_sha256"]).decode("utf-8")
        require(graph["5"]["inputs"]["prompt"] == original_graph["5"]["inputs"]["prompt"] == original_prompt, "Frozen native prompt changed")
        require(graph["5"]["inputs"]["negative_prompt"] == original_graph["5"]["inputs"]["negative_prompt"], "Frozen negative changed")
        allowed = ["10.inputs.filename_prefix", "100.inputs.image", "101.inputs.image", "7.inputs.model", "901"]
        actual = differences(original_graph, graph)
        require(actual == allowed, "Unexpected baseline graph change: " + str(actual))
        require(read(folder / "graph-diff-proof.json")["actualDifferences"] == actual, "Recorded graph diff differs")
        history = read(folder / "history.json")
        item = history[result["promptId"]]
        require(item["status"]["completed"] is True and item["status"]["status_str"] == "success", "Actual history not successful")
        require(item["prompt"][2] == graph, "Submitted graph and actual history differ")
        require(read(folder / "queued.json")["prompt_id"] == result["promptId"], "Queue id mismatch")
        require(item["outputs"]["10"]["images"][0]["filename"] == Path(result["output"]["isolatedServerOutput"]).name, "Actual output filename differs")
        image_bytes = checked(result["output"]["path"], result["output"]["sha256"])
        require(Path(result["output"]["isolatedServerOutput"]).read_bytes() == image_bytes, "Downloaded image differs from actual server output")
        pixels, buffer = decoded(result["output"]["path"])
        require(pixels["size"] == [1280, 960] and pixels["rgbaSHA256"] == result["output"]["decodedRGBA_SHA256"], "Output dimensions or decoded hash differs")
        references = read(folder / "references.json")
        expected_refs = preflight["baselines"][style]["references"]
        require(len(references) == 2, "Expected source/style pair")
        for i, ref in enumerate(references):
            require(ref["sha256"] == expected_refs[i]["sha256"], "Original image identity changed")
            case_image = original_case["images"][i]
            require(ref["sha256"] == case_image.get("originalSHA256", case_image["sha256"]), "Original case image hash changed")
            checked(ref["path"], ref["sha256"])
            checked(ref["localPath"], ref["sha256"])
            require(ref["graphName"] == graph[str(100 + i)]["inputs"]["image"], "Graph image role/name mismatch")
        audit = read(folder / "actual-node-audit.json")
        require(parse_audit_logs(folder) == audit, "Parsed audit differs from actual captured log lines")
        if enabled:
            runtime = audit_enabled(audit)
        else:
            require(not audit, "OFF job unexpectedly invoked layer-window attention override")
            runtime = {"disabledIdentityPath": True, "runtimeAuditLines": 0}
        release = read(folder / "release.json")
        require(not release["queue"].get("queue_running") and not release["queue"].get("queue_pending"), "Job not idle after release")
        require(result["newAIAnalysis"] is False and result["additionalAIAnalysisSeconds"] == 0, "Unexpected AI analysis")
        original_output = read(baseline_folder / "generation-flash/result.json")["outputs"][0]
        checked(original_output["path"], pin["output_sha256"])
        if style not in baseline_pixels:
            base_pixel, base_bytes = decoded(original_output["path"])
            baseline_pixels[style] = (base_pixel, base_bytes)
        graphs[key], pixel_buffers[key] = graph, buffer
        rows.append({"job": key, "enabled": enabled, "style": style, "taskId": result["promptId"], "baseline": pin,
            "graph": receipt(folder / "graph.json"), "history": receipt(folder / "history.json"), "result": receipt(folder / "result.json"),
            "originalReferences": references, "output": {**result["output"], "decodedSHARecomputed": pixels["rgbaSHA256"]},
            "fullFrozenNativePromptSHA256": pin["prompt_sha256"], "nativePromptExactlyUnchanged": True, "negativeExactlyUnchanged": True,
            "nativePromptSourcePath": str(baseline_folder / "generation-flash/prompt.txt"), "frozenBaselineGraphPath": str(baseline_folder / "generation-flash/graph.json"),
            "onlyAllowedModelNodeAndFileNamespaceChangesFromBaseline": actual, "runtime": runtime,
            "enqueueToSuccessfulHistorySeconds": result["enqueueToSuccessfulHistorySeconds"], "individualJobFullSeconds": result["individualJobFullSeconds"],
            "additionalAIAnalysisSeconds": 0, "timingIsNodeSpeedupEvidence": False,
            "visualQualityPendingRootReview": True, "referenceStyleAccepted": False})
    pairs = []
    for style in ("bright", "dark"):
        off, on = graphs[style + "-off"], graphs[style + "-on"]
        canonical_off, canonical_on = copy.deepcopy(off), copy.deepcopy(on)
        for graph in (canonical_off, canonical_on):
            graph["100"]["inputs"]["image"] = "<same-original-source>"
            graph["101"]["inputs"]["image"] = "<same-original-style>"
            graph["10"]["inputs"]["filename_prefix"] = "<output-prefix>"
        canonical_diff = differences(canonical_off, canonical_on)
        require(canonical_diff == ["901.inputs.enabled"], "OFF/ON changes beyond enabled: " + str(canonical_diff))
        baseline_info, baseline_data = baseline_pixels[style]
        off_info = next(row["output"] for row in rows if row["job"] == style + "-off")
        pairs.append({"style": style, "canonicalGraphDifferences": canonical_diff, "onlyEnabledChanges": True,
            "rawGraphDifferences": differences(off, on), "originalBaselineDecodedRGBA": baseline_info,
            "newOFFDecodedRGBA_SHA256": off_info["decodedRGBA_SHA256"], "baselineAndOFFPixelsIdentical": baseline_data == pixel_buffers[style + "-off"],
            "OFFAndONPixelsIdentical": pixel_buffers[style + "-off"] == pixel_buffers[style + "-on"],
            "interpretation": "Identical frozen graph/seed does not imply exact cross-run pixels; OFF-to-ON is the within-instance graph control. Visual quality remains root/user review."})
    samples = [json.loads(line) for line in (probe / "resource-samples.jsonl").read_text().splitlines() if line.strip()]
    resources = read(probe / "resource-summary.json")
    require(resources["samples"] == len(samples), "Resource sample count mismatch")
    require(resources["sampledMaxVRAMMiB"] == max(s["vramUsedMiB"] for s in samples), "VRAM peak mismatch")
    require(resources["sampledMinRAMAvailableBytes"] == min(s["ramAvailableBytes"] for s in samples), "RAM minimum mismatch")
    require(resources["abortReason"] is None and resources["limits"] == {"minRAMGiB": 4.0, "minVRAMFreeMiB": 768, "sustainedSeconds": 2.0}, "Guard settings/outcome differ")
    report = {"schema": "nf.qa.layer-window-fastdisk-postrun-audit.v1", "auditedAt": time.time(), "probe": str(probe),
        "controllerResult": receipt(probe / "result.json"), "preflight": receipt(probe / "preflight.json"),
        "resourceProfileChange": receipt(probe / "resource-profile-change.json"), "prototypeFiles": preflight["prototype"]["files"],
        "verificationPassed": True, "rows": rows, "pairs": pairs, "resources": resources, "ownedCleanup": cleanup,
        "allOriginalProtectedFilesAndGalleryUnchanged": True, "rawTimingsAreNotControlledSpeedupEvidence": True,
        "newAIAnalysisPerformed": False, "imageEditedByAudit": False, "rootVisualQualityPending": True,
        "generalStyleTransferAccepted": False, "productionDefaultsChanged": False, "noGPUOrServiceActionByThisAudit": True}
    output_json = HERE / "layer-window-fastdisk-analysis-20261025.json"
    output_md = HERE / "layer-window-fastdisk-analysis-20261025.md"
    require(not output_json.is_relative_to(probe) and not output_md.is_relative_to(probe), "Report must stay outside protected probe")
    md = "# Layer-window fast-disk post-run audit\n\nActual graphs, native prompt, original images, history, downloaded files and decoded RGBA hashes were rechecked. No image edit or service action. Visual quality remains pending root/user review.\n\n"
    md += "| Job | Successful history(s) | Individual full job(s) | Actual output |\n|---|---:|---:|---|\n"
    md += "\n".join(f"| {r['job']} | {r['enqueueToSuccessfulHistorySeconds']:.3f} | {r['individualJobFullSeconds']:.3f} | [PNG]({Path(r['output']['path']).as_posix()}) |" for r in rows)
    md += "\n\nOFF/ON canonical graphs differ only by node901.enabled. Each ON has16 conditional forwards, eight K copies per forward,128 total; only layers24–31 receive target modification. Prefixes are computed on the first positive and first negative forward (160 then320 calls), then cached unchanged for forwards3–16.\n\n"
    for pair in pairs:
        md += f"{pair['style']}: old baseline versus new OFF RGBA identical = {pair['baselineAndOFFPixelsIdentical']}; current OFF versus ON RGBA identical = {pair['OFFAndONPixelsIdentical']}.\n\n"
    md += f"Sampled peak VRAM {resources['sampledMaxVRAMMiB']}MiB; minimum available RAM {resources['sampledMinRAMAvailableBytes']/1073741824:.3f}GiB. Owned processes are gone and recorded8192 is closed. Four raw timings include uncontrolled cold/warm differences and are not node-speedup claims. No new AI analysis or automatic quality acceptance. Full evidence: [{output_json.name}]({output_json.as_posix()}).\n"
    if options.write:
        for path, value in ((output_json, json.dumps(report, ensure_ascii=False, indent=2) + "\n"), (output_md, md)):
            with path.open("x", encoding="utf-8", newline="\n") as file:
                file.write(value)
    print(json.dumps({"write": options.write, "reportJSON": str(output_json), "reportMD": str(output_md),
        "verificationPassed": True, "baselineOffPixelsIdentical": {p["style"]: p["baselineAndOFFPixelsIdentical"] for p in pairs},
        "eachOnForwards": 16, "eachOnKCopies": 128, "prefixCacheStableAfterSecondConditionalForward": True,
        "visualQualityPendingRoot": True, "probeFilesChanged": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
