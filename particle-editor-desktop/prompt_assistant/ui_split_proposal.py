"""UI region proposals from the existing vision model; no segmentation claims."""
import json
import math
import os
import re

SCHEMA = "nf.ui.split.v1"
QUESTION = '''Look at the supplied UI screenshot and propose separately editable visible UI objects and panels. Return ONLY valid JSON:
{"schema":"nf.ui.split.v1","style":"brief description of rendering, palette, materials and lighting, not identities or layout","regions":[{"id":"r1","name":"short object name","kind":"object","box":[10,20,200,300],"uncertain":false}]}.
All coordinates are integers normalized to 0..1000 relative to this exact whole screenshot. Tight boxes must enclose the COMPLETE visible object or panel. Include visible character/mascot art, independent icons, important panels and buttons. Separate visually distinct repeated objects; do not invent a grid count or invisible objects. Avoid duplicating a whole-screen box and its contents. Use object/icon for a free silhouette, panel for a complete rectangular UI block and text for a text region. Propose at most 32 useful regions, not individual glyphs or tiny decoration specks. Mark uncertain boxes uncertain=true. This is a proposal the user will correct, not a final mask. Never infer hidden pixels. Do not redesign or generate an image. Do not return prose outside JSON.'''

def validate_proposal(raw):
    if isinstance(raw, str):
        raw = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
    if not isinstance(raw, dict) or raw.get("schema") != SCHEMA:
        raise ValueError("UI 识别结果格式无效，原图未修改")
    regions = raw.get("regions")
    if not isinstance(regions, list) or not 1 <= len(regions) <= 48:
        raise ValueError("UI 识别没有有效区域，原图未修改")
    used = set()
    for region in regions:
        if not isinstance(region, dict) or region.get("kind") not in {"object", "icon", "panel", "text", "button"}:
            raise ValueError("UI 区域类型无效")
        key = str(region.get("id") or "")
        box = region.get("box")
        if not key or key in used or not isinstance(box, list) or len(box) != 4:
            raise ValueError("UI 区域 ID 或坐标无效")
        used.add(key)
        if any(type(n) not in (int, float) or not math.isfinite(n) or n < 0 or n > 1000 for n in box) or box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError("UI 区域超出原图或为空")
        region["box"] = [round(n) for n in box]
        region["name"] = str(region.get("name") or key)[:120]
        region["uncertain"] = region.get("uncertain") is True
    return {"schema": SCHEMA, "style": str(raw.get("style") or "")[:1200], "regions": regions}

CHILD_QUESTION = '''This image is a crop of one previously identified UI group, with a small margin. Identify the INDEPENDENT visible targets inside that named group. Return the same nf.ui.split.v1 JSON with coordinates normalized to 0..1000 of this exact CROP, not the full screenshot.
Do not return the entire group, grid, toolbar or all its contents as one panel. Give one tight complete box for each separately editable symbol or button you can actually see, including repeated instances. Do not guess a grid count or fabricate objects. Pictorial letter-shaped game symbols are objects, not text glyphs. Real words, value readouts and labels are text regions. Separate words/labels from icon silhouettes; a label must not be lost to background removal. Keep complete button artwork as kind=button and place an outside caption in a separate text region. Use kind=object or icon only for isolated artwork without words; use panel/button for a complete rectangular pixel block; use text for complete text regions, never individual glyphs. Exclude surrounding scenery and partial objects outside the named group. Mark uncertainty. Return only JSON and do not infer hidden pixels. At most 32 regions.'''

def _generation_identity(assistant):
    """Read completed-call metadata only; never construct or load an adapter."""
    def text(value):
        return value.strip() if isinstance(value, str) and value.strip() else None

    profile = getattr(assistant, "last_generate_profile", None)
    profile = profile if isinstance(profile, dict) else {}
    diagnostics = profile.get("inferenceDiagnostics")
    diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
    adapter = getattr(assistant, "_qwen3_adapter", None)
    model = (text(diagnostics.get("modelId")) or text(profile.get("modelId"))
             or text(getattr(adapter, "model_id", None)))
    if model is None:
        path = getattr(adapter, "model_path", None)
        model = text(os.fspath(path)) if isinstance(path, (str, os.PathLike)) else None
        if model == ".":
            model = None
    provider = (text(profile.get("provider")) or text(diagnostics.get("provider"))
                or text(diagnostics.get("modelSource")) or text(profile.get("modelSource")))
    return {"model": model, "provider": provider}


def propose(assistant, tensors, context=None):
    if len(tensors) != 1:
        raise ValueError("智能拆图每次只识别一张原图")
    template = "<|im_start|>system\nYou locate visible UI regions. Return the requested JSON exactly.<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
    context = context if isinstance(context, dict) else {}
    children = context.get("uiSplitScope") == "children"
    group_name = str(context.get("uiSplitGroupName") or "selected UI group")[:120]
    question = QUESTION + ("\nNamed group: " + group_name + "\n" + CHILD_QUESTION if children else "")
    output = assistant.generate("<|vision_start|><|image_pad|><|vision_end|>\n" + question,
        images=tensors, llama_template=template, max_length=4096 if children else 3072, trace_label="uiSplitChildren" if children else "uiSplitProposal", do_sample=False)
    result = {"rawOutput": output, "visualSchema": SCHEMA, **_generation_identity(assistant), "maskProduced": False, "scope": "children" if children else "whole"}
    try:
        result["proposal"] = validate_proposal(output)
    except (ValueError, TypeError) as error:
        result["proposal"] = None
        result["validationError"] = str(error)
    return result
