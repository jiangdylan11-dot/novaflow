"""Work-only native Qwen batch harness. Freeze a plan, preflight, then explicit --run.

No process or GPU is started by importing this module or freezing/preflighting a
plan. Only --run starts a fresh owned8192 server. No experimental layer node.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import time
import traceback
import urllib.parse

import owned_comfy_runtime as rt

SCRIPT = Path(__file__).resolve()
RESEARCH = SCRIPT.parent.parent
WORK = RESEARCH.parent
AB = WORK / "qwen38-strata-deploy-20261024/adapted-ab"
PYTHON = Path("C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe")
COMFY = rt.COMFY
WHITELIST = ["ComfyUI-GGUF-leejet", "novaflow_qwen_bf16_loader"]
SOURCE_SHA = "2a3a4e310458f19fa849d525ac8598df27c269473de35df40b495cb1be6d98df"
SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
NATIVE_IDS = {"1", "2", "3", "4", "5", "7", "8", "10", "100", "101", "nf_turbo_7_sigmas", "nf_turbo_7_sampler"}
MODEL_NAMES = [("NovaFlowGGUFBF16Loader", "unet_name", "Qwen-Image-2.1-Turbo-BF16.gguf", ["diffusion_models", "unet"]),
               ("CLIPLoader", "clip_name", "qwen3vl_8b_bf16_heretic.safetensors", ["text_encoders", "clip"]),
               ("VAELoader", "vae_name", "qwen_image_2.1_vae_bf16.safetensors", ["vae"])]


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def receipt(path):
    path = Path(path).resolve()
    return {"path": str(path), "sha256": rt.digest(path.read_bytes())}


def normalized(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def work_path(path):
    path = Path(path).resolve()
    need(path.is_relative_to(WORK.resolve()), "All plans/runs must remain inside repository work/")
    return path


def analysis_timing(analysis, directory):
    """Keep per-request time separate from an unallocated shared load/unload."""
    def seconds(record, key):
        value = record.get(key)
        if value is None:
            return None
        need(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0,
             "Invalid analysis timing: " + key)
        return value / 1000

    directory = Path(directory)
    total, request = seconds(analysis, "totalMs"), seconds(analysis, "requestMs")
    fields = {"analysisTimingScope": "independent-analysis" if total is not None else "request-only-total-unavailable",
              "originalAnalysisTotalSeconds": total, "originalAnalysisRequestSeconds": request,
              "sharedAnalysisTimingProvenance": None}
    batch_path = analysis.get("sharedBatchResult")
    provenance_path = directory / "shared-runtime-provenance.json"
    if not batch_path and not provenance_path.exists():
        return fields, []
    need(batch_path and provenance_path.is_file(), "Shared analysis timing requires both batch and runtime provenance")
    batch_path = work_path(batch_path)
    batch, provenance = rt.read(batch_path), rt.read(provenance_path)
    need(batch.get("ok") is True and batch.get("resourcesReleased") is True and batch.get("resourceStop") is None,
         "Shared analysis batch did not complete and release")
    need(analysis.get("sharedBatchCompleted") is True and analysis.get("sharedLoadUnattributed") is True,
         "Shared load attribution must remain explicit")
    need(Path(provenance["sharedBatchResult"]).resolve() == batch_path and provenance.get("independentCaseUnload") is False
         and provenance.get("copiedOnlyAfterSharedReleaseConfirmed") is True, "Shared runtime provenance mismatch")
    composite = "sessions" in batch
    need(analysis.get("sharedSettingsSHA256") == batch.get("sharedSettingsSHA256") and bool(batch.get("sharedSettingsSHA256")),
         "Shared analysis settings mismatch")
    need(provenance.get("sharedSettingsSHA256") == batch["sharedSettingsSHA256"]
         or (composite and "sharedSettingsSHA256" not in provenance), "Shared runtime settings mismatch")
    matches = [record for record in batch.get("requests", []) if record.get("case") == directory.parent.name]
    need(len(matches) == 1 and all(matches[0].get(key) == analysis.get(key)
         for key in ("ok", "model", "requestMs", "promptSHA256", "finishReason")), "Shared batch/request timing identity mismatch")
    need(request is not None, "Shared analysis must retain its actual requestMs")
    shared_paths = [batch_path, provenance_path]
    for key in ("sharedLoadReceipt", "sharedIdentityReceipt", "sharedReleaseReceipt", "sharedAfterStatus"):
        shared_paths.append(work_path(provenance[key]))
    for name, key in (("identity.json", "sharedIdentityReceipt"), ("release.json", "sharedReleaseReceipt")):
        expected = provenance.get(name + "SHA256")
        need(expected is not None or composite, "Independent shared receipt SHA is absent: " + name)
        original = rt.checked(provenance[key], expected) if expected is not None else Path(provenance[key]).read_bytes()
        need(original == (directory / name).read_bytes(), "Shared copied receipt differs: " + name)
    if composite:
        sessions, session_ids, assigned_cases = [], set(), set()
        for session in batch["sessions"]:
            session_id = session["sessionId"]
            need(isinstance(session_id, str) and session_id not in session_ids, "Duplicate composite session")
            session_ids.add(session_id)
            path = work_path(session["receiptPath"])
            actual = json.loads(rt.checked(path, session["receiptSHA256"]))
            need(actual.get("resourcesReleased") is True and actual.get("resourceStop") is None,
                 "Actual composite session did not release safely")
            after = actual.get("afterStatus", {})
            need(after.get("portOpen") is False and after.get("ownedHttpAlive") is False and after.get("heavyProcesses") == [],
                 "Actual composite session still owns model resources")
            need(actual.get("sharedSettingsSHA256") == batch["sharedSettingsSHA256"], "Composite session settings mismatch")
            case_ids = session["caseIds"]
            need(isinstance(case_ids, list) and case_ids and len(set(case_ids)) == len(case_ids)
                 and not (assigned_cases & set(case_ids)), "Composite cases cannot belong to multiple sessions")
            assigned_cases.update(case_ids)
            actual_requests = actual.get("requests", [])
            need(case_ids == [record["case"] for record in actual_requests], "Composite session case ownership differs from original")
            for key, original_key in (("loadMs", "sharedLoadMs"), ("unloadMs", "sharedUnloadMs"), ("executionMs", "batchTotalMs")):
                value, original_value = seconds(session, key), seconds(actual, original_key)
                need(value is not None and value == original_value, "Composite session time differs from original: " + key)
            need(isinstance(session.get("startedAtUTC"), str) and isinstance(session.get("finishedAtUTC"), str),
                 "Composite session wall-clock provenance missing")
            for request_record in actual_requests:
                combined = [row for row in batch["requests"] if row.get("case") == request_record["case"]]
                need(len(combined) == 1 and combined[0].get("sharedSessionId") == session_id
                     and all(combined[0].get(key) == request_record.get(key) for key in ("model", "requestMs", "finishReason")),
                     "Composite changed actual request identity/time")
            sessions.append({"sessionId": session_id, "caseIds": case_ids, "receipt": receipt(path),
                "loadSeconds": seconds(session, "loadMs"), "unloadSeconds": seconds(session, "unloadMs"),
                "executionSeconds": seconds(session, "executionMs"),
                "startedAtUTC": session["startedAtUTC"], "finishedAtUTC": session["finishedAtUTC"]})
            shared_paths.append(path)
        need(len(sessions) >= 2 and assigned_cases == {row["case"] for row in batch["requests"]},
             "Composite must retain all requests from its actual sessions")
        for sum_key, session_key in (("sumLoadsMs", "loadSeconds"), ("sumUnloadsMs", "unloadSeconds"), ("sumSessionExecutionMs", "executionSeconds")):
            value = seconds(batch, sum_key)
            need(value is not None and math.isclose(value, sum(session[session_key] for session in sessions), rel_tol=0, abs_tol=0.000005),
                 "Composite timing sum mismatch: " + sum_key)
        wall_span = seconds(batch, "wallClockSpanMs")
        need(wall_span is not None and wall_span >= seconds(batch, "sumSessionExecutionMs")
             and batch.get("wallClockSpanIncludesInterSessionGap") is True, "Composite wall span must distinguish the inter-session gap")
        session_id = analysis.get("sharedSessionId")
        need(session_id == provenance.get("sharedSessionId") == matches[0].get("sharedSessionId"), "Actual case session identity mismatch")
        selected = [session for session in sessions if session["sessionId"] == session_id and directory.parent.name in session["caseIds"]]
        need(len(selected) == 1, "Case lacks exactly one actual session")
        selected = selected[0]
        need(work_path(provenance["sharedSessionResult"]) == Path(selected["receipt"]["path"])
             and provenance["sharedSessionResultSHA256"] == selected["receipt"]["sha256"], "Actual case session receipt mismatch")
        for key, name in (("sharedLoadReceipt", "load.json"), ("sharedIdentityReceipt", "identity.json"),
                          ("sharedReleaseReceipt", "release.json"), ("sharedAfterStatus", "after-status.json")):
            need(work_path(provenance[key]) == Path(selected["receipt"]["path"]).parent / name, "Case receipt points to another session: " + key)
        fields.update(analysisTimingScope="composite-shared-batch-request-only", originalAnalysisTotalSeconds=None,
            sharedAnalysisTimingProvenance={"batchResult": receipt(batch_path), "runtimeProvenance": receipt(provenance_path),
                "case": directory.parent.name, "actualSession": selected, "sessions": sessions,
                "sumSessionExecutionSeconds": seconds(batch, "sumSessionExecutionMs"), "sumSharedLoadSeconds": seconds(batch, "sumLoadsMs"),
                "sumSharedUnloadSeconds": seconds(batch, "sumUnloadsMs"), "wallClockSpanSeconds": wall_span,
                "wallClockSpanIncludesInterSessionGap": True, "sharedLoadUnattributed": True,
                "independentCaseUnload": False, "allocatedSharedOverheadToThisCase": False,
                "receipts": [receipt(path) for path in shared_paths[2:]]})
        return fields, list(dict.fromkeys(shared_paths))
    fields.update(analysisTimingScope="shared-batch-request-only", originalAnalysisTotalSeconds=None,
        sharedAnalysisTimingProvenance={"batchResult": receipt(batch_path), "runtimeProvenance": receipt(provenance_path),
            "case": directory.parent.name, "sharedLoadUnattributed": True, "independentCaseUnload": False,
            "sharedLoadSeconds": seconds(batch, "sharedLoadMs"), "sharedUnloadSeconds": seconds(batch, "sharedUnloadMs"),
            "wholeBatchSeconds": seconds(batch, "batchTotalMs"), "allocatedSharedOverheadToThisCase": False,
            "receipts": [receipt(path) for path in shared_paths[2:]]})
    return fields, shared_paths


def native_case(folder):
    """Read a fully built formal case and its one already completed AI answer."""
    from PIL import Image
    folder = work_path(folder)
    case_path, graph_path, build_path = folder / "case.json", folder / "worker-graph.json", folder / "formal-build-proof.json"
    case, build = rt.read(case_path), rt.read(build_path)
    need(case.get("formalWorkerGraph") == build, "Case/build receipt mismatch")
    need(build.get("generatedBy") == "createWorkflowHost.buildGraph" and build.get("liveCatalog") is True, "Expected actual formal worker builder")
    need(build.get("programSuppliedPrompt") is False and build.get("manualDiagnosticPrompt") is False, "Require unmodified model-native prompt")
    need(build.get("sourcePixels") == [1280, 960] and build.get("sourceAlignedToOutput") is True, "Require original source-aligned canvas")
    rt.checked(build["rendererPath"], build["rendererSHA256"])
    graph = json.loads(rt.checked(graph_path, build["sha256"]))
    pointer_path = folder / "flash-analysis/result.json"
    analysis_path = Path(rt.read(pointer_path)["resultPath"]).resolve()
    need(analysis_path == Path(build["actualAnalysisResultPath"]).resolve(), "Formal graph points to a different analysis")
    ad = analysis_path.parent
    analysis, meta = rt.read(analysis_path), rt.read(ad / "request-metadata.json")
    timing, timing_files = analysis_timing(analysis, ad)
    need(analysis.get("ok") is True and analysis.get("finishReason") == "stop" and analysis.get("resourcesReleased") is True and analysis.get("resourceStop") is None, "AI analysis must be complete and released")
    need(analysis["afterStatus"]["portOpen"] is False and analysis["afterStatus"]["ownedHttpAlive"] is False and analysis["afterStatus"]["heavyProcesses"] == [], "AI resources not released")
    release = rt.read(ad / "release.json")
    need(release.get("ok") is True and release.get("released") is True, "Missing native-analysis release receipt")
    need(rt.read(ad / "identity.json")["models"]["data"][0]["id"] == analysis["model"] == meta["model"], "Actual AI model identity mismatch")
    events, raw, parsed = rt.read(ad / "events.json"), (ad / "raw.txt").read_text(encoding="utf-8"), rt.read(ad / "parsed.json")
    choices = [choice for event in events for choice in event.get("data", {}).get("choices", [])]
    streamed = "".join(choice.get("delta", {}).get("content", "") for choice in choices).strip()
    need(any(choice.get("finish_reason") == "stop" for choice in choices), "No completed native SSE answer")
    need(streamed.replace("\r\n", "\n") == raw.replace("\r\n", "\n"), "SSE/raw differ beyond file line endings")
    unwrapped = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    need(json.loads(unwrapped, strict=False) == parsed, "Native raw/parsed mismatch")
    prompt = (ad / "prompt.txt").read_bytes().decode("utf-8")
    need(isinstance(parsed.get("prompt"), str) and parsed["prompt"] == prompt == graph["5"]["inputs"]["prompt"], "Prompt was rewritten between model and graph")
    need(rt.digest(prompt.encode()) == build["actualPromptSHA256"], "Formal prompt receipt mismatch")
    need(not (ad / "compiled-prompt.txt").exists(), "Compiled prompt is not this native batch route")
    need(graph["5"]["inputs"]["negative_prompt"] == "", "This new uniform protocol requires an empty negative")
    if case.get("sharedNegativePolicy"):
        policy = case["sharedNegativePolicy"]
        need(json.loads(rt.checked(policy["path"], policy["sha256"]))["negativePrompt"] == "", "Frozen negative policy is not empty")
    need(set(graph) in (NATIVE_IDS, NATIVE_IDS | {"201"}), "Unexpected nodes; layer/adapter/extra experimental nodes are forbidden")
    expected_classes = {"1": "NovaFlowGGUFBF16Loader", "2": "CLIPLoader", "3": "VAELoader", "4": "QwenImage21Cache", "5": "TextEncodeQwenImage21",
                        "7": "SamplerCustom", "8": "VAEDecode", "10": "SaveImage", "100": "LoadImage", "101": "LoadImage",
                        "nf_turbo_7_sigmas": "ManualSigmas", "nf_turbo_7_sampler": "KSamplerSelect"}
    need(all(graph[key]["class_type"] == cls for key, cls in expected_classes.items()), "Native class layout changed")
    for node_id, (_, input_key, name, _) in zip(("1", "2", "3"), MODEL_NAMES):
        need(graph[node_id]["inputs"][input_key] == name, "Frozen weight/encoder/VAE changed")
    sampler = graph["7"]["inputs"]
    need(sampler["model"] == ["4", 0] and sampler["positive"] == ["5", 0] and sampler["negative"] == ["5", 1] and sampler["latent_image"] == ["5", 2], "Native sampler/model/conditioning chain changed")
    need(sampler["cfg"] == 3 and sampler["noise_seed"] == 54792256 and sampler["add_noise"] is True, "Require shared CFG3/seed")
    need(graph["nf_turbo_7_sigmas"]["inputs"]["sigmas"] == SIGMAS and graph["nf_turbo_7_sampler"]["inputs"]["sampler_name"] == "euler", "Require dedicated Turbo8 schedule")
    need(graph["5"]["inputs"]["images.image_1"] == ["100", 0] and graph["5"]["inputs"]["resolution"] == 0, "Original source must enter directly")
    need(len(case["images"]) == 2, "This batch requires source plus one reference")
    references = []
    for i, image in enumerate(case["images"]):
        path = Path(image.get("originalPath", image["path"])).resolve()
        expected = image.get("originalSHA256", image["sha256"])
        data = rt.checked(path, expected)
        with Image.open(path) as decoded:
            size = list(decoded.size)
        references.append({"path": str(path), "sha256": expected, "bytes": len(data), "size": size, "role": "source" if i == 0 else "style"})
    need(references[0]["sha256"] == SOURCE_SHA and references[0]["size"] == [1280, 960], "All cases must use the same original source bytes")
    slots = meta.get("analysisInputSlots", [1, 2])
    need(len(meta["images"]) == len(slots), "Native image role metadata mismatch")
    for image, slot in zip(meta["images"], slots):
        rt.checked(image["path"], image["sha256"])
        need(image.get("originalSHA256", image["sha256"]) == references[slot - 1]["sha256"], "Analysis/generation image roles differ")
        if image.get("originalPath"):
            rt.checked(image["originalPath"], image["originalSHA256"])
    w, h = references[1]["size"]
    if w * h > 1048576:
        factor = (1048576 / (w * h)) ** 0.5
        dims = [max(32, int(w * factor) // 32 * 32), max(32, int(h * factor) // 32 * 32)]
        need(graph.get("201") == {"class_type": "ImageScale", "inputs": {"image": ["101", 0], "upscale_method": "lanczos", "width": dims[0], "height": dims[1], "crop": "disabled"}}, "Shared reference pixel-budget preprocessing changed")
        need(graph["5"]["inputs"]["images.image_2"] == ["201", 0], "Scaled reference role changed")
    else:
        need("201" not in graph and graph["5"]["inputs"]["images.image_2"] == ["101", 0], "Small reference should enter directly")
    frame = copy.deepcopy(meta)
    for key in ("images", "generationImages"):
        frame.pop(key, None)
    canonical = copy.deepcopy(graph)
    canonical.pop("201", None)
    canonical["5"]["inputs"]["prompt"] = "<native-model-prompt>"
    canonical["5"]["inputs"]["images.image_2"] = ["<shared-reference-size-policy>", 0]
    for node_id in ("100", "101"):
        canonical[node_id]["inputs"]["image"] = "<original-image-upload>"
    canonical["10"]["inputs"]["filename_prefix"] = "<output-prefix>"
    artifacts = [case_path, graph_path, build_path, pointer_path, analysis_path,
                 *[ad / name for name in ("request-metadata.json", "identity.json", "release.json", "events.json", "raw.txt", "parsed.json", "prompt.txt")]]
    artifacts.extend(timing_files)
    if case.get("sharedNegativePolicy"):
        artifacts.append(Path(case["sharedNegativePolicy"]["path"]))
    return {"id": folder.name, "formalCaseDirectory": str(folder), "files": [receipt(path) for path in artifacts],
        "graphPath": str(graph_path), "graphSHA256": rt.digest(graph_path.read_bytes()), "promptPath": str(ad / "prompt.txt"),
        "promptSHA256": rt.digest(prompt.encode()), "analysisResultPath": str(analysis_path), "analysisModel": analysis["model"],
        **timing, "additionalAnalysisDuringRenderSeconds": 0,
        "references": references, "renderer": {"path": build["rendererPath"], "sha256": build["rendererSHA256"]},
        "nativeSSEToPromptExact": True, "graph": graph, "protocolFrame": frame, "canonicalGraph": canonical}


def freeze_plan(folders, output):
    need(2 <= len(folders) <= 8, "Freeze two to eight formal cases")
    cases = [native_case(folder) for folder in folders]
    need(len({case["id"] for case in cases}) == len(cases), "Duplicate case ids")
    need(len({case["references"][1]["sha256"] for case in cases}) == len(cases), "Use distinct actual references for multi-style regression")
    first = cases[0]
    for case in cases[1:]:
        need(case["protocolFrame"] == first["protocolFrame"], "Analysis system/user/settings differ across cases; not one fixed protocol")
        need(case["canonicalGraph"] == first["canonicalGraph"], "Model/negative/sampling/geometry differs beyond native prompt and shared reference sizing")
        need(case["renderer"] == first["renderer"], "Formal builder runtime differs")
    plan = {"schema": "nf.qa.frozen-native-reference-batch.v1", "frozenAt": time.time(), "sourceImageSHA256": SOURCE_SHA,
        "sameActualAnalysisProtocol": True, "systemUTF8SHA256": rt.digest(first["protocolFrame"]["system"].encode()),
        "userUTF8SHA256": rt.digest(first["protocolFrame"]["user"].encode()), "commonActualRequestMetadata": first["protocolFrame"],
        "generation": {"model": MODEL_NAMES[0][2], "steps": 8, "cfg": 3, "seed": 54792256, "width": 1280, "height": 960, "negativePrompt": "", "layerNodePresent": False},
        "cases": [{k: v for k, v in case.items() if k not in ("graph", "protocolFrame", "canonicalGraph")} for case in cases],
        "newAIAnalysisDuringGeneration": False, "qualityAccepted": False, "formalDefaultChanged": False}
    output = work_path(output)
    rt.save(output, plan, exclusive=True)
    rt.emit("plan-frozen-no-GPU", path=str(output), sha256=rt.digest(output.read_bytes()), cases=[case["id"] for case in cases])


def protected_files():
    output = {}
    dark = AB / "accepted-dark-r10"
    manifest = rt.read(dark / "manifest.json")
    need(len(manifest["files"]) == 13, "Frozen Dark manifest changed")
    for item in manifest["files"]:
        for path in (dark / item["file"], Path(item["copiedFrom"])):
            rt.checked(path, item["sha256"])
            output[str(path.resolve())] = item["sha256"]
    gallery = RESEARCH / "gallery-20261024"
    data = rt.read(gallery / "manifest.json")
    paths = [dark / "manifest.json", gallery / "manifest.json", gallery / "data.js", gallery / "gallery.js"]
    accepted_hashes = {"86e0a1d053f3eaad82660a213107b54b7ef5599459a9f76318c0894db5c1c8e9", "674dcfc105eb2799b4ec72e63b64904af3993b86a9295a2cbbc57f97c45c7312"}
    for image in data["images"].values():
        if image["sha256"] in accepted_hashes:
            paths.append(gallery / image["path"])
            if image.get("originalPath"):
                paths.append(Path(image["originalPath"]))
    for item in data["latest"]:
        if item.get("qualityAccepted") or item.get("referenceStyleAccepted"):
            paths.append(gallery / item["recordPath"])
    for path in paths:
        output[str(path.resolve())] = rt.digest(path.read_bytes())
    return output


def preflight(plan_path, run_root):
    need(os.name == "nt", "Owned process lifecycle is Windows-only")
    plan_path, run_root = work_path(plan_path), work_path(run_root)
    need(not run_root.is_relative_to(RESEARCH / "gallery-20261024") and run_root != SCRIPT.parent, "Run root must be a separate fresh work directory")
    need(not run_root.is_relative_to(AB), "Run root must stay outside existing native-analysis/formal-case records")
    plan = rt.read(plan_path)
    need(plan.get("schema") == "nf.qa.frozen-native-reference-batch.v1" and 2 <= len(plan["cases"]) <= 8, "Not a frozen two-to-eight case plan")
    plan_sha = rt.digest(plan_path.read_bytes())
    for sentinel in ("load.json", "result.json", "owned-server.json"):
        need(not (run_root / sentinel).exists(), "Prior run exists; no rerun or overwrite")
    marker_path = run_root / "native-batch-run-root.json"
    marker = {"planSHA256": plan_sha, "runner": str(SCRIPT), "runnerSHA256": rt.digest(SCRIPT.read_bytes()),
              "runtimeCoreSHA256": rt.digest((SCRIPT.parent / "owned_comfy_runtime.py").read_bytes())}
    if run_root.exists() and any(run_root.iterdir()):
        need(marker_path.exists() and rt.read(marker_path) == marker, "Nonempty run root is not this exact prepared plan")
    need(not rt.port_open(8192), "8192 already owned; do not restart")
    services = rt.other_services_idle()
    cases = []
    for frozen in plan["cases"]:
        for file in frozen["files"]:
            rt.checked(file["path"], file["sha256"])
        current = native_case(frozen["formalCaseDirectory"])
        need({k: v for k, v in current.items() if k not in ("graph", "protocolFrame", "canonicalGraph")} == frozen, "Frozen native case changed")
        cases.append(current)
    need(all(case["protocolFrame"] == cases[0]["protocolFrame"] and case["canonicalGraph"] == cases[0]["canonicalGraph"] for case in cases), "Current cases no longer share one protocol")
    run_root.mkdir(parents=True, exist_ok=True)
    if not marker_path.exists():
        rt.save(marker_path, marker, exclusive=True)
    rt.configure(run_root)
    for part in ("input", "output", "temp", "user", "models", "custom_nodes", "cache"):
        (rt.BASE / part).mkdir(parents=True, exist_ok=True)
    need(not any((rt.BASE / "custom_nodes").iterdir()), "Native batch has no local prototype/custom package")
    loaders = []
    for name in WHITELIST:
        root = Path("E:/NovaFlow/custom_nodes") / name
        need((root / "__init__.py").is_file(), "Known loader missing")
        loaders.append({"path": str(root), "pythonFiles": {str(p.relative_to(root)): rt.digest(p.read_bytes()) for p in sorted(root.rglob("*.py"))}})
    config = {"existing_model_weights_readonly": {"base_path": "E:/NovaFlow/models", "is_default": True,
        "diffusion_models": "diffusion_models\nunet", "unet": "diffusion_models\nunet", "text_encoders": "text_encoders\nclip", "clip": "text_encoders\nclip", "vae": "vae"},
        "two_known_loaders_readonly": {"base_path": "E:/NovaFlow/custom_nodes", "custom_nodes": "."}}
    rt.save(run_root / "extra-model-paths.yaml", config)
    weights = []
    for _, _, name, directories in MODEL_NAMES:
        path = next((Path("E:/NovaFlow/models") / d / name for d in directories if (Path("E:/NovaFlow/models") / d / name).is_file()), None)
        need(path is not None, "Required model file missing: " + name)
        weights.append({"path": str(path), "bytes": path.stat().st_size, "liveMultiGBSHARecomputed": False})
    import shutil
    nvidia = shutil.which("nvidia-smi") or shutil.which("nvidia-smi.exe")
    need(nvidia is not None, "nvidia-smi required for guard")
    need(PYTHON.is_file() and (COMFY / "main.py").is_file(), "Existing engine Python/Comfy is absent")
    command = [str(PYTHON), "-s", "-B", str(COMFY / "main.py"), "--listen", "127.0.0.1", "--port", "8192",
        "--base-directory", str(rt.BASE), "--extra-model-paths-config", str(run_root / "extra-model-paths.yaml"),
        "--input-directory", str(rt.BASE / "input"), "--output-directory", str(rt.BASE / "output"), "--temp-directory", str(rt.BASE / "temp"),
        "--user-directory", str(rt.BASE / "user"), "--fast-disk", "--disable-auto-launch", "--disable-api-nodes",
        "--disable-all-custom-nodes", "--whitelist-custom-nodes", *WHITELIST]
    report = {"ok": True, "preflightOnly": True, "serverStarted": False, "plan": receipt(plan_path), "command": command,
        "jobOrder": [case["id"] for case in cases], "nodeWhitelist": WHITELIST, "experimentalLayerNodePresent": False,
        "resourceGuard": {"minRAMGiB": 4.0, "minVRAMFreeMiB": 768, "sustainedSeconds": 2.0}, "nvidiaSmi": nvidia,
        "existingServicesReadOnly": services, "protectedFiles": protected_files(), "knownLoaderPythonFiles": loaders, "modelFiles": weights,
        "frozenCases": plan["cases"], "runner": marker, "fastDiskRAMBenefitGuaranteed": False}
    rt.save(run_root / "preflight.json", report)
    return report, cases


def validate_catalog(catalog, cases):
    needed = {node["class_type"] for case in cases for node in case["graph"].values()}
    need(not (needed - set(catalog)), "Live catalog lacks native graph nodes: " + str(needed - set(catalog)))
    for cls, key, name, _ in MODEL_NAMES:
        values = catalog[cls]["input"]["required"][key][0]
        need(isinstance(values, list) and name in values, "Live model catalog cannot resolve " + name)


def run_job(owner, guard, case, idle_vram, timeout):
    from PIL import Image
    folder = rt.HERE / "jobs" / case["id"]
    folder.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    offsets = rt.log_parts()
    rt.other_services_idle()
    refs = [rt.upload(owner, ref, "NF_NATIVE_" + case["id"] + "_" + ref["role"] + Path(ref["path"]).suffix.lower()) for ref in case["references"]]
    graph = copy.deepcopy(case["graph"])
    graph["100"]["inputs"]["image"], graph["101"]["inputs"]["image"] = [ref["graphName"] for ref in refs]
    graph["10"]["inputs"]["filename_prefix"] = "NF_NATIVE_BATCH_" + case["id"]
    changed = rt.graph_differences(case["graph"], graph)
    need(set(changed) == {"100.inputs.image", "101.inputs.image", "10.inputs.filename_prefix"}, "Mutation beyond image/save names: " + str(changed))
    need(graph["5"]["inputs"]["prompt"] == rt.checked(case["promptPath"], case["promptSHA256"]).decode(), "Native prompt changed before enqueue")
    rt.save(folder / "graph.json", graph, exclusive=True)
    rt.save(folder / "references.json", refs, exclusive=True)
    rt.save(folder / "graph-diff-proof.json", {"frozenGraph": receipt(case["graphPath"]), "actualDifferences": changed, "promptAndSamplingUnchanged": True}, exclusive=True)
    enqueue_at = time.monotonic()
    queued = owner.call("/prompt", {"prompt": graph, "client_id": "nf-owned-native-batch", "extra_data": {"qa_job": case["id"]}})
    rt.save(folder / "queued.json", queued, exclusive=True)
    need(queued.get("prompt_id") and not queued.get("node_errors"), "Actual graph validation failed: " + json.dumps(queued))
    prompt_id = queued["prompt_id"]
    history, _ = rt.wait_history(owner, guard, prompt_id, timeout, folder)
    completed_at = time.monotonic()
    rt.save(folder / "history.json", history, exclusive=True)
    item = history[prompt_id]
    need(item["prompt"][2] == graph, "Actual history differs from submitted graph")
    images = item.get("outputs", {}).get("10", {}).get("images", [])
    need(len(images) == 1 and images[0].get("type") == "output", "Expected exactly one completed native output")
    image = images[0]
    server_output = rt.resolve_under(rt.BASE / "output", image.get("subfolder", ""), image["filename"])
    query = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": "output"})
    data = owner.call("/view?" + query, raw=True, timeout=30)
    need(server_output.read_bytes() == data, "HTTP image differs from server bytes")
    output = folder / "output.png"
    with output.open("xb") as file:
        file.write(data)
    with Image.open(output) as image:
        need(image.size == (1280, 960), "Actual output canvas changed")
        rgba_sha = rt.digest(image.convert("RGBA").tobytes())
    released = rt.release_between_jobs(owner, guard, idle_vram)
    rt.save(folder / "release.json", released, exclusive=True)
    for name, offset in offsets.items():
        with (rt.HERE / name).open("rb") as file:
            file.seek(offset)
            text = file.read().decode("utf-8", errors="replace")
        (folder / name).write_text(text, encoding="utf-8")
        need("Qwen21StyleKeyLayerWindow audit=" not in text, "Unexpected experimental attention wrapper")
    result = {"ok": True, "job": case["id"], "promptId": prompt_id, "nativeOnly": True, "experimentalLayerNodePresent": False,
        "newAIAnalysis": False, "additionalAIAnalysisSeconds": 0, "originalAnalysisRecord": case["analysisResultPath"],
        "originalAnalysisTotalSecondsForTraceOnly": case["originalAnalysisTotalSeconds"], "nativePromptPath": case["promptPath"], "nativePromptSHA256": case["promptSHA256"],
        "analysisTimingScope": case["analysisTimingScope"], "originalAnalysisRequestSecondsForTraceOnly": case["originalAnalysisRequestSeconds"],
        "sharedAnalysisTimingProvenance": case["sharedAnalysisTimingProvenance"],
        "graphSHA256": rt.digest((folder / "graph.json").read_bytes()), "output": {"path": str(output), "isolatedServerOutput": str(server_output),
        "sha256": rt.digest(data), "decodedRGBA_SHA256": rgba_sha, "width": 1280, "height": 960},
        "uploadSeconds": enqueue_at - started, "enqueueToSuccessfulHistorySeconds": completed_at - enqueue_at,
        "individualJobFullSeconds": time.monotonic() - started, "includesUploadDownloadAndFree": True,
        "timingIsControlledSpeedEvidence": False, "coldWarmEffectsNotControlled": True, "qualityAccepted": False, "referenceStyleAccepted": False, "formalDefaultChanged": False}
    rt.save(folder / "result.json", result, exclusive=True)
    rt.emit("job-complete", job=case["id"], promptId=prompt_id, seconds=result["individualJobFullSeconds"], outputSHA256=rt.digest(data))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--freeze-plan", type=Path, nargs="+", metavar="FORMAL_CASE_DIR", help="CPU-only: freeze two to eight complete formal cases")
    parser.add_argument("--plan-out", type=Path, help="New work-only plan file; never overwritten")
    parser.add_argument("--plan", type=Path, help="Previously frozen plan")
    parser.add_argument("--run-root", type=Path, help="Separate fresh work-only run directory")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preflight-only", action="store_true")
    mode.add_argument("--run", action="store_true", help="Explicitly start owned8192 and generate sequential jobs")
    parser.add_argument("--job-timeout", type=int, default=1200)
    parser.add_argument("--startup-timeout", type=int, default=150)
    options = parser.parse_args()
    # These successful fast-disk follow-up guard limits are fixed for this harness.
    options.min_ram_gib, options.min_vram_free_mib, options.low_headroom_seconds = 4.0, 768, 2.0
    if options.freeze_plan:
        need(options.plan_out and not options.run and not options.plan and not options.run_root, "Freeze mode accepts only formal folders and --plan-out")
        freeze_plan(options.freeze_plan, options.plan_out)
        return 0
    need(options.plan and options.run_root, "Provide --plan and a separate fresh --run-root")
    need(options.job_timeout > 0 and options.startup_timeout > 0, "Timeouts must be positive")
    report, cases = preflight(options.plan, options.run_root)
    rt.emit("preflight-complete", serverStarted=False, GPUInferenceStarted=False, jobOrder=report["jobOrder"])
    if not options.run:
        return 0
    import psutil
    owner = rt.OwnedServer(psutil, report["command"])
    guard = rt.ResourceGuard(psutil, report["nvidiaSmi"], owner, options)
    result = {"ok": False, "plan": report["plan"], "jobs": [], "nativeOnly": True, "newAIAnalysis": False,
              "experimentalLayerNodePresent": False, "formalDefaultChanged": False, "qualityAccepted": False,
              "timingIsControlledSpeedEvidence": False, "startedAt": time.time()}
    started = time.monotonic()
    try:
        guard.thread.start()
        deadline = time.monotonic() + 10
        while guard.latest is None and time.monotonic() < deadline:
            guard.check()
            time.sleep(0.1)
        guard.check()
        need(guard.latest is not None, "No resource sample; server not started")
        owner.start()
        deadline = time.monotonic() + options.startup_timeout
        catalog = None
        while time.monotonic() < deadline:
            guard.check()
            owner.assert_owned()
            if rt.port_open(8192):
                catalog = owner.call("/object_info", timeout=20)
                break
            time.sleep(0.5)
        need(catalog is not None, "Owned8192 startup timed out")
        validate_catalog(catalog, cases)
        rt.save(rt.HERE / "object-info.json", catalog, exclusive=True)
        rt.save(rt.HERE / "load.json", {**rt.read(rt.HERE / "load.json"), "ready": True, "readyAfterSeconds": time.monotonic() - started,
            "objectInfoSHA256": rt.digest((rt.HERE / "object-info.json").read_bytes()), "nativeCatalogAndModelsVerified": True})
        idle_vram = guard.latest["vramUsedMiB"]
        for case in cases:
            guard.check()
            result["jobs"].append(run_job(owner, guard, case, idle_vram, options.job_timeout))
        result["ok"] = True
    except BaseException as exc:
        result.update(error=str(exc), exceptionType=type(exc).__name__, traceback=traceback.format_exc())
        rt.emit("qa-failed-no-retry", error=str(exc))
    finally:
        if owner.process and owner.process.poll() is None:
            try:
                owner.call("/interrupt", {}, timeout=3)
                owner.call("/free", {"unload_models": True, "free_memory": True}, timeout=3)
            except Exception as exc:
                result["finalHTTPReleaseError"] = str(exc)
        try:
            cleanup = owner.stop()
        except Exception as exc:
            cleanup = {"cleanupError": str(exc)}
            result["ok"] = False
        result["ownedProcessCleanup"] = cleanup
        guard.close()
        result["resourceAbortReason"] = guard.reason
        if guard.reason or cleanup.get("remainingOwnedIdentities"):
            result["ok"] = False
        for path, expected in report["protectedFiles"].items():
            try:
                rt.checked(path, expected)
            except Exception as exc:
                result["ok"] = False
                result.setdefault("protectedFileErrors", []).append(str(exc))
        for package in report["knownLoaderPythonFiles"]:
            for relative, expected in package["pythonFiles"].items():
                try:
                    rt.checked(Path(package["path"]) / relative, expected)
                except Exception as exc:
                    result["ok"] = False
                    result.setdefault("externalLoaderMutationErrors", []).append(str(exc))
        result.update(totalOwnedRunSeconds=time.monotonic() - started, endedAt=time.time(), existingServicesNeverMutated=True,
                      galleryChanged=False, productSourceChanged=False)
        rt.save(rt.HERE / "result.json", result, exclusive=True)
        rt.save(rt.HERE / "owned-stop.json", cleanup, exclusive=True)
        rt.emit("qa-finished", ok=result["ok"], completedJobs=len(result["jobs"]), resultPath=str(rt.HERE / "result.json"))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
