"""Publish only completed local QA files, byte for byte, to the work gallery."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROBE = ROOT / "layer-window-fastdisk-probe-20261025"
GALLERY = ROOT / "gallery-20261024"
REPORT = ROOT / "layer-window-fastdisk-analysis-20261025.json"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    trial = read(PROBE / "result.json")
    assert trial["ok"] and len(trial["jobs"]) == 4
    assert not trial["ownedProcessCleanup"]["remainingOwnedIdentities"]
    assert trial["resourceAbortReason"] is None
    assert REPORT.is_file()
    manifest_path = GALLERY / "manifest.json"
    manifest = read(manifest_path)
    main_before = json.dumps(manifest["latest"], sort_keys=True, ensure_ascii=False)
    decisions = {
        "schema": "nf.qa.layer-window.visual-review.v1",
        "scope": "Root actual-image review and independent agent review; not user acceptance",
        "newAIAnalysisCalls": 0,
        "node": "NovaFlowQwen21StyleKeyLayerWindowExperimental",
        "parameters": {"layers": [24, 31], "high_scale": 0.5, "low_scale": 1.5, "beta": 2},
        "bright": "No convincing image-quality or reference-style gain. Hair/face/cup simplified slightly; no strong gray or blue-violet veil. Content retained.",
        "dark": "Small local face-shape/skin-color variation. Overall drawing, lighting and material finish close to OFF; no convincing general gain. Content retained.",
        "adopted": False,
        "generalStyleTransferAccepted": False,
        "formalDefaultChanged": False,
        "replacesAcceptedDark": False,
        "preservesBrightQualityAcceptance": True,
        "oldBaselineAndNewOFFArePixelIdentical": False,
        "speedupClaim": False,
    }
    proof = {
        "schema": "nf.qa.layer-window.gallery-proof.v1",
        "trialResultPath": str(PROBE / "result.json"),
        "trialResultSHA256": sha(PROBE / "result.json"),
        "auditReportPath": str(REPORT), "auditReportSHA256": sha(REPORT),
        "resources": read(PROBE / "resource-summary.json"),
        "review": decisions, "jobs": trial["jobs"],
    }
    records = GALLERY / "records"
    proof_name = "layer-window-fastdisk-diagnostic-20261025-proof.json"
    (records / proof_name).write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (ROOT / "layer-window-visual-decision-20261025.json").write_text(json.dumps(decisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for style in ("bright", "dark"):
        variants = []
        for state in ("off", "on"):
            job = next(j for j in trial["jobs"] if j["job"] == f"{style}-{state}")
            output = Path(job["output"]["path"])
            output_sha = sha(output)
            assert output_sha == job["output"]["sha256"]
            image_id = f"layer-window-v2-{style}-{state}-diagnostic"
            relative = f"assets/{image_id}-{output_sha[:12]}.png"
            destination = GALLERY / relative
            if destination.exists():
                assert sha(destination) == output_sha
            else:
                shutil.copyfile(output, destination)
            assert sha(destination) == output_sha
            manifest["images"][image_id] = {
                "id": image_id, "path": relative, "originalPath": str(output),
                "sha256": output_sha, "bytes": output.stat().st_size, "width": 1280, "height": 960,
            }
            seconds = job["enqueueToSuccessfulHistorySeconds"]
            variants.append({"image": image_id, "label": f"{state.upper()} · 生图阶段 {seconds:.3f}秒", "role": "generated-diagnostic-output", "steps": 8, "cfg": 3, "seconds": seconds, "taskId": job["promptId"], "additionalAnalysisSeconds": 0})
        title = "明亮" if style == "bright" else "暗色"
        notes = ("明亮ON没有令人信服的整体画质或画风提升，发束、五官、杯子略简化，未出现明显蓝紫罩色。" if style == "bright" else "暗色ON脸部略圆润、肤色更粉净，可视为局部美感变体；整体光影、头发与材质完成度接近OFF，没有明显整体提升。")
        item = {
            "id": f"layer-window-v2-{style}-diagnostic",
            "title": f"{title} · 末8层风格Key节点 OFF／ON",
            "priority": "style-transfer-diagnostic", "displayGroup": "quality-diagnostics",
            "subtitle": "同一次隔离环境、同提示词、同参考、同种子 · 仅节点开关不同",
            "badge": "已完成实测 · 未采用", "style": f"style-{style}",
            "styleLabel": "实际风格参考（输入，非成图）", "variants": variants,
            "referenceInputCount": 1, "generatedOutputCount": 2,
            "notes": notes + "眨眼、单颗痣、举杯、条纹和机场均保留；两张尚无用户直接验收，不替换已认可暗色r10或明亮v3。",
            "conditions": "完整Flash原生提示词原样复用，本轮新增分析0次。Turbo8专用sigmas／CFG3／seed54792256／1280×960。ON仅在实际32层中的24–31层修改风格参考K的空间RoPE通道幅度，high=.5／low=1.5／beta=2；Q、V和prefix不改。两张ON均实际16次forward、128次K副本；正负分支首次prefix计算后缓存复用。新OFF与旧基线不逐像素相同，严格配对仅指本卡OFF／ON。使用fast-disk存储策略、BF16精度未改；单次耗时有冷热差异，不作速度提升结论。",
            "proof": f"records/{proof_name}", "proofLabel": "查看实际graph／history／节点命中／资源与SHA证明",
            "reviewSource": "Root and independent actual-image observations; no user acceptance inferred.",
            "qualityPassed": False, "pictureQualityRejected": False, "referenceStyleAccepted": False,
            "finalTaskAccepted": False, "generalStyleTransferAccepted": False,
            "productionPromotion": False, "formalDefaultChanged": False, "replacesAcceptedDark": False,
        }
        manifest["comparisons"] = [c for c in manifest["comparisons"] if c["id"] != item["id"]] + [item]
    assert json.dumps(manifest["latest"], sort_keys=True, ensure_ascii=False) == main_before
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (GALLERY / "data.js").write_text("window.NF_GALLERY_MANIFEST = " + json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(json.dumps({"ok": True, "newImages": 4, "comparisons": 2, "mainCardsUnchanged": True, "adopted": False, "proof": str(records / proof_name)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
