from __future__ import annotations

import argparse
import colorsys
import io
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from PIL import Image, ImageFilter


DEFAULT_PROXY_ORIGIN = "http://127.0.0.1:4783"
DEFAULT_PROXY_PREFIX = f"{DEFAULT_PROXY_ORIGIN}/__runtime_proxy"
DEFAULT_COMFY_BASE = "http://127.0.0.1:8188"
DEFAULT_TEMPLATE_ID = "slash_basic"
DEFAULT_STYLE_IMAGE = Path("D:/AI_APP/NovaFlow/particle-editor/aifx-v3/debug-assets/cloud/cloud.png")
DEFAULT_RENDERER_ROOT = Path(
    "D:/AI_APP/NovaFlow/particle-editor-desktop/dist/win-unpacked/resources/app/renderer"
)
HIDDEN_PROMPT_BASE = " ".join(
    [
        "Use the template sequence as motion guidance only.",
        "Preserve timing and rhythm.",
        "Preserve the core silhouette and energy distribution.",
        "Use style references for color, material, and surface treatment only.",
        "Generate a transparent VFX sequence.",
    ]
)
NEGATIVE_PROMPT = (
    "person, character, weapon, text, ui, background scene, opaque backdrop, watermark, frame border"
)


@dataclass
class UploadResult:
    name: str
    subfolder: str
    type: str


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def lerp(start: float, end: float, ratio: float) -> float:
    return start + (end - start) * ratio


def normalize_node_key(value: str) -> str:
    return "".join(ch.lower() for ch in str(value or "") if ch.isalnum())


def normalize_base_url(value: str) -> str:
    return str(value or "").strip().rstrip("/") or DEFAULT_COMFY_BASE


def sanitize_file_stem(value: str) -> str:
    text = Path(str(value or "")).stem
    safe = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in text).strip("_")
    return safe[:48] or "aifx"


def frame_name(index: int) -> str:
    return f"frame_{index:03d}.png"


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{int(clamp(r, 0, 255)):02x}{int(clamp(g, 0, 255)):02x}{int(clamp(b, 0, 255)):02x}"


def hex_to_rgb(value: str) -> dict[str, int] | None:
    raw = str(value or "").strip().replace("#", "")
    if len(raw) != 6:
        return None
    try:
        return {"r": int(raw[0:2], 16), "g": int(raw[2:4], 16), "b": int(raw[4:6], 16)}
    except ValueError:
        return None


def mix_rgb(left: dict[str, int], right: dict[str, int], ratio: float) -> dict[str, int]:
    return {
        "r": int(round(lerp(left["r"], right["r"], ratio))),
        "g": int(round(lerp(left["g"], right["g"], ratio))),
        "b": int(round(lerp(left["b"], right["b"], ratio))),
    }


def sample_palette_color(palette: list[dict[str, int]], ratio: float) -> dict[str, int]:
    if not palette:
        value = int(clamp(round(ratio * 255), 0, 255))
        return {"r": value, "g": value, "b": value}
    if len(palette) == 1:
        return palette[0]
    ratio = clamp(ratio, 0, 1)
    span = len(palette) - 1
    scaled = ratio * span
    index = min(span - 1, int(scaled))
    local = scaled - index
    return mix_rgb(palette[index], palette[index + 1], local)


def build_template_semantic_prompt(template_type: str) -> str:
    if str(template_type or "").strip().lower() == "slash":
        return " ".join(
            [
                "Render a non-representational slash VFX only.",
                "Preserve the template silhouette, motion arc, stroke breakup, fragment placement, and occupied area.",
                "Keep it as an energy trail, impact burst, sparks, shards, and glow rather than an object or creature.",
            ]
        )
    return "Render a non-representational VFX shape only and preserve the template silhouette, motion, and occupied area."


def build_template_negative_hints(template_type: str) -> str:
    if str(template_type or "").strip().lower() == "slash":
        return "feather, wing, bird, animal, creature, leaf, petal, cloth, armor, body part, face, eye, hand, object, illustration subject"
    return "creature, character, object, body part"


def describe_style_color(hue: float, saturation: float, lightness: float) -> str:
    if lightness >= 0.9 and saturation <= 0.18:
        return "bright white glow"
    if lightness <= 0.12:
        return "deep shadow"
    if saturation <= 0.16:
        return "soft silver highlight" if lightness >= 0.72 else "neutral gray core"
    prefix = "vivid" if saturation >= 0.7 and lightness >= 0.62 else "rich" if saturation >= 0.7 else "bright" if lightness >= 0.68 else "warm"
    hue = hue % 360
    if hue < 15 or hue >= 345:
        return f"{prefix} red"
    if hue < 40:
        return f"{prefix} orange"
    if hue < 62:
        return f"{prefix} gold"
    if hue < 90:
        return f"{prefix} lime"
    if hue < 150:
        return f"{prefix} green"
    if hue < 200:
        return f"{prefix} cyan"
    if hue < 255:
        return f"{prefix} blue"
    if hue < 290:
        return f"{prefix} violet"
    return f"{prefix} magenta"


def extract_style_reference_profile(style_path: Path) -> dict[str, Any]:
    image = Image.open(style_path).convert("RGBA")
    image.thumbnail((96, 96))
    bins: dict[tuple[int, int, int], dict[str, float]] = {}
    for red, green, blue, alpha_raw in image.getdata():
        alpha = alpha_raw / 255
        if alpha < 0.1:
            continue
        hue, lightness, saturation = colorsys.rgb_to_hls(red / 255, green / 255, blue / 255)
        if lightness < 0.06:
            continue
        if saturation < 0.12 and lightness < 0.78:
            continue
        key = (round(red / 32), round(green / 32), round(blue / 32))
        weight = alpha * (0.3 + saturation) * (0.38 + lightness)
        entry = bins.setdefault(key, {"r": red, "g": green, "b": blue, "weight": 0.0})
        entry["weight"] += weight

    swatches = sorted(bins.values(), key=lambda item: item["weight"], reverse=True)[:4]
    labels: list[str] = []
    hexes: list[str] = []
    for entry in swatches:
        hue, lightness, saturation = colorsys.rgb_to_hls(entry["r"] / 255, entry["g"] / 255, entry["b"] / 255)
        label = describe_style_color(hue * 360, saturation, lightness)
        if label and label not in labels:
            labels.append(label)
        hex_value = rgb_to_hex(entry["r"], entry["g"], entry["b"])
        if hex_value not in hexes:
            hexes.append(hex_value)

    warm_score = sum(1 for label in labels if any(token in label for token in ("red", "orange", "gold", "yellow")))
    cool_score = sum(1 for label in labels if any(token in label for token in ("green", "cyan", "blue", "violet", "magenta")))
    temperature = "warm" if warm_score > cool_score else "cool" if cool_score > warm_score else "neutral"
    temperature_hint = (
        "Keep the palette warm and avoid unrelated green, cyan, or blue accents."
        if temperature == "warm"
        else "Keep the palette cool and avoid unrelated orange, yellow, or red accents."
        if temperature == "cool"
        else ""
    )
    hexes = sorted(
        hexes[:3],
        key=lambda value: (
            (rgb := hex_to_rgb(value)) and (rgb["r"] * 0.2126 + rgb["g"] * 0.7152 + rgb["b"] * 0.0722)
        ) or 0,
    )
    prompt_hint = (
        f"Transfer the dominant style palette: {', '.join(labels[:3])}. Replace the template's original colors with this palette. {temperature_hint}".strip()
        if labels
        else f"Transfer the dominant colors from the style reference and do not preserve the template's original colors. {temperature_hint}".strip()
    )
    return {"promptHint": prompt_hint, "paletteHexes": hexes[:3], "temperature": temperature}


def preprocess_init_image_bytes(source_path: Path, width: int, height: int, mode: str) -> bytes:
    image = Image.open(source_path).convert("RGBA").resize((width, height))
    pixels = image.load()
    mix = 0.84 if mode == "weak_guide" else 1.0
    lift = 16 if mode == "weak_guide" else 10 if mode == "grayscale_blur" else 6
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha_raw = pixels[x, y]
            alpha = alpha_raw / 255
            if alpha <= 0:
                continue
            luminance = int(clamp(red * 0.2126 + green * 0.7152 + blue * 0.0722 + lift * alpha, 0, 255))
            pixels[x, y] = (
                int(round(red + (luminance - red) * mix)),
                int(round(green + (luminance - green) * mix)),
                int(round(blue + (luminance - blue) * mix)),
                alpha_raw,
            )
    if mode in {"weak_guide", "grayscale_blur"}:
        image = image.filter(ImageFilter.GaussianBlur(radius=1.5 if mode == "weak_guide" else 3))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def proxy_headers(base_url: str) -> dict[str, str]:
    return {
        "x-runtime-base": normalize_base_url(base_url),
        "Origin": DEFAULT_PROXY_ORIGIN,
        "Referer": f"{DEFAULT_PROXY_ORIGIN}/",
        "Accept": "application/json",
    }


def parse_json_response(response: requests.Response) -> dict[str, Any]:
    text = response.text or ""
    cleaned = text.lstrip("\ufeff").strip()
    if not cleaned:
        raise RuntimeError(f"Empty response (HTTP {response.status_code})")
    try:
        return response.json()
    except Exception as exc:  # pragma: no cover - debug only
        snippet = " ".join(cleaned.split())[:220]
        raise RuntimeError(f"Invalid JSON (HTTP {response.status_code}): {snippet}") from exc


def proxy_request_json(
    session: requests.Session,
    base_url: str,
    path: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_path = path if str(path).startswith("/") else f"/{path}"
    url = f"{DEFAULT_PROXY_PREFIX}{resolved_path}"
    headers = proxy_headers(base_url)
    kwargs: dict[str, Any] = {"headers": headers, "timeout": 30}
    if payload is not None:
        kwargs["json"] = payload
    response = session.request(method.upper(), url, **kwargs)
    if response.status_code == 404 and not resolved_path.startswith("/api/"):
        return proxy_request_json(session, base_url, f"/api{resolved_path}", method=method, payload=payload)
    response.raise_for_status()
    return parse_json_response(response)


def proxy_request_binary(session: requests.Session, base_url: str, path: str) -> bytes:
    resolved_path = path if str(path).startswith("/") else f"/{path}"
    url = f"{DEFAULT_PROXY_PREFIX}{resolved_path}"
    response = session.get(url, headers=proxy_headers(base_url), timeout=60)
    if response.status_code == 404 and not resolved_path.startswith("/api/"):
        return proxy_request_binary(session, base_url, f"/api{resolved_path}")
    response.raise_for_status()
    return response.content


def upload_image_bytes(
    session: requests.Session,
    base_url: str,
    file_name: str,
    data: bytes,
    mime_type: str = "image/png",
) -> UploadResult:
    def post(path: str) -> requests.Response:
        return session.post(
            f"{DEFAULT_PROXY_PREFIX}{path}",
            headers=proxy_headers(base_url),
            files={"image": (file_name, io.BytesIO(data), mime_type)},
            data={"type": "input", "subfolder": ""},
            timeout=60,
        )

    first = post("/upload/image")
    if first.status_code in (403, 404):
        second = post("/api/upload/image")
        if second.ok:
            data_json = parse_json_response(second)
            return UploadResult(
                name=str(data_json.get("name") or data_json.get("filename") or "").strip(),
                subfolder=str(data_json.get("subfolder") or "").strip(),
                type=str(data_json.get("type") or "input").strip() or "input",
            )
        if not first.ok:
            first = second
    first.raise_for_status()
    data_json = parse_json_response(first)
    return UploadResult(
        name=str(data_json.get("name") or data_json.get("filename") or "").strip(),
        subfolder=str(data_json.get("subfolder") or "").strip(),
        type=str(data_json.get("type") or "input").strip() or "input",
    )


def get_node_input_options(object_info: dict[str, Any], class_type: str, input_name: str) -> list[str]:
    entry = object_info.get(class_type) or {}
    raw = None
    if isinstance(entry, dict):
        inputs = entry.get("input") or {}
        required = inputs.get("required") or {}
        optional = inputs.get("optional") or {}
        raw = required.get(input_name) or optional.get(input_name)
    if not isinstance(raw, list):
        return []
    values = raw[0] if raw and isinstance(raw[0], list) else raw
    return [str(item or "").strip() for item in values if str(item or "").strip()]


def find_node_class_type(object_info: dict[str, Any], candidates: list[str]) -> str:
    for candidate in candidates:
        if candidate in object_info:
            return candidate
    wanted = {normalize_node_key(item) for item in candidates}
    for key in object_info:
        if normalize_node_key(key) in wanted:
            return key
    return ""


def pick_preferred_option(options: list[str], preferred: list[str]) -> str:
    normalized = [(raw, normalize_node_key(raw)) for raw in options]
    for wanted in preferred:
        wanted_key = normalize_node_key(wanted)
        for raw, key in normalized:
            if key == wanted_key:
                return raw
    return options[0] if options else ""


def pick_alternative_option(options: list[str], preferred: list[str], current: str) -> str:
    current_key = normalize_node_key(current)
    normalized = [(raw, normalize_node_key(raw)) for raw in options]
    for wanted in preferred:
        wanted_key = normalize_node_key(wanted)
        for raw, key in normalized:
            if key == wanted_key and key != current_key:
                return raw
    for raw, key in normalized:
        if key != current_key:
            return raw
    return ""


def get_ipadapter_preset_preference(control_level: str) -> list[str]:
    if control_level == "high":
        return [
            "PLUS (high strength)",
            "STANDARD (medium strength)",
            "VIT-G (medium strength)",
            "LIGHT - SD1.5 only (low strength)",
        ]
    if control_level == "low":
        return [
            "LIGHT - SD1.5 only (low strength)",
            "STANDARD (medium strength)",
            "VIT-G (medium strength)",
            "PLUS (high strength)",
        ]
    return [
        "STANDARD (medium strength)",
        "VIT-G (medium strength)",
        "LIGHT - SD1.5 only (low strength)",
        "PLUS (high strength)",
    ]


def resolve_ipadapter_plan(object_info: dict[str, Any], control_level: str) -> dict[str, Any] | None:
    unified_loader_class = find_node_class_type(object_info, ["IPAdapterUnifiedLoader", "IPAdapter Unified Loader"])
    advanced_class = find_node_class_type(object_info, ["IPAdapterAdvanced", "IPAdapter Advanced"])
    preset_preference = get_ipadapter_preset_preference(control_level)
    weight_type_preference = ["style transfer precise", "style transfer", "strong style transfer", "linear"]

    if unified_loader_class and advanced_class:
        preset = pick_preferred_option(get_node_input_options(object_info, unified_loader_class, "preset"), preset_preference)
        weight_type = pick_preferred_option(get_node_input_options(object_info, advanced_class, "weight_type"), weight_type_preference)
        combine_embeds = pick_preferred_option(get_node_input_options(object_info, advanced_class, "combine_embeds"), ["average", "concat"])
        embeds_scaling = pick_preferred_option(
            get_node_input_options(object_info, advanced_class, "embeds_scaling"),
            ["K+mean(V) w/ C penalty", "K+V w/ C penalty", "K+V", "V only"],
        )
        if preset and weight_type:
            return {
                "kind": "standard",
                "unifiedLoaderClass": unified_loader_class,
                "advancedClass": advanced_class,
                "preset": preset,
                "weightType": weight_type,
                "combineEmbeds": combine_embeds or "average",
                "embedsScaling": embeds_scaling or "K+mean(V) w/ C penalty",
            }

    easy_advanced_class = find_node_class_type(object_info, ["easy ipadapterApplyADV", "Easy Apply IPAdapter (Advanced)"])
    if not easy_advanced_class:
        return None

    preset = pick_preferred_option(get_node_input_options(object_info, easy_advanced_class, "preset"), preset_preference)
    provider = pick_preferred_option(get_node_input_options(object_info, easy_advanced_class, "provider"), ["CUDA", "DirectML", "ROCM", "OpenVINO", "CPU", "CoreML"])
    weight_type = pick_preferred_option(get_node_input_options(object_info, easy_advanced_class, "weight_type"), weight_type_preference)
    combine_embeds = pick_preferred_option(get_node_input_options(object_info, easy_advanced_class, "combine_embeds"), ["average", "concat"])
    embeds_scaling = pick_preferred_option(
        get_node_input_options(object_info, easy_advanced_class, "embeds_scaling"),
        ["K+mean(V) w/ C penalty", "K+V w/ C penalty", "K+V", "V only"],
    )
    cache_mode = pick_preferred_option(get_node_input_options(object_info, easy_advanced_class, "cache_mode"), ["all", "ipadapter only", "clip_vision only", "none"])
    if not (preset and provider and weight_type):
        return None
    return {
        "kind": "easy-use-advanced",
        "advancedClass": easy_advanced_class,
        "preset": preset,
        "provider": provider,
        "weightType": weight_type,
        "combineEmbeds": combine_embeds or "average",
        "embedsScaling": embeds_scaling or "K+mean(V) w/ C penalty",
        "cacheMode": cache_mode or "all",
        "loraStrength": 0.6,
    }


def resolve_fallback_ipadapter_plan(object_info: dict[str, Any], current_plan: dict[str, Any] | None) -> dict[str, Any] | None:
    if not current_plan:
        return None
    if current_plan["kind"] == "standard":
        preset_options = get_node_input_options(object_info, current_plan["unifiedLoaderClass"], "preset")
    else:
        preset_options = get_node_input_options(object_info, current_plan["advancedClass"], "preset")
    next_preset = pick_alternative_option(preset_options, get_ipadapter_preset_preference("medium"), current_plan["preset"])
    if not next_preset:
        return None
    updated = dict(current_plan)
    updated["preset"] = next_preset
    return updated


def resolve_controlnet_plan(object_info: dict[str, Any]) -> dict[str, Any] | None:
    loader_class = find_node_class_type(object_info, ["ControlNetLoader", "ControlNet Loader"])
    apply_class = find_node_class_type(
        object_info,
        ["ControlNetApplyAdvanced", "ControlNet Apply Advanced", "ControlNetApply", "ControlNet Apply"],
    )
    if not (loader_class and apply_class):
        return None
    model_name = pick_preferred_option(
        get_node_input_options(object_info, loader_class, "control_net_name"),
        [
            "control_v11p_sd15_lineart_fp16.safetensors",
            "control_v11p_sd15_scribble_fp16.safetensors",
            "control_v11f1e_sd15_tile_fp16.safetensors",
            "controlnet_union_promax.safetensors",
            "FLUX.1-dev-ControlNet-Union-Pro-2.0.safetensors",
        ],
    )
    if not model_name:
        return None
    union_type_class = find_node_class_type(object_info, ["SetUnionControlNetType"]) or None
    union_type = "canny/lineart/anime_lineart/mlsd" if "union" in model_name.lower() else None
    return {
        "loaderClass": loader_class,
        "applyClass": apply_class,
        "modelName": model_name,
        "unionTypeClass": union_type_class,
        "unionType": union_type,
    }


def map_redraw_strength_to_plan(redraw_strength: int) -> dict[str, Any]:
    ratio = clamp(float(redraw_strength or 55), 0, 100) / 100
    return {
        "controlLevel": "low" if ratio < 0.34 else "medium" if ratio < 0.67 else "high",
        "steps": round(24 + ratio * 8),
        "cfg": round(5.4 + ratio * 1.1, 2),
        "denoise": round(0.44 + ratio * 0.16, 2),
        "controlStrength": round(0.96 - ratio * 0.26, 2),
        "ipAdapterWeight": round(1.02 + ratio * 0.22, 2),
        "sourcePreprocess": "weak_guide" if ratio < 0.33 else "grayscale_blur" if ratio < 0.66 else "grayscale",
    }


def build_hidden_prompt(template_name: str, redraw_strength: int, style_profile: dict[str, Any] | None = None, template_type: str = "") -> str:
    style_profile = style_profile or {}
    return " ".join(
        [
            HIDDEN_PROMPT_BASE,
            build_template_semantic_prompt(template_type),
            str(style_profile.get("promptHint") or "Transfer the dominant colors from the style reference and do not preserve the template's original colors."),
            f"Template: {template_name}.",
            f"Redraw strength: {redraw_strength}/100.",
            "Style references: 1.",
            f"Palette anchors: {', '.join(style_profile.get('paletteHexes') or [])}." if style_profile.get("paletteHexes") else "",
        ]
    )


def build_negative_prompt(style_profile: dict[str, Any] | None = None, template_type: str = "") -> str:
    temperature = str((style_profile or {}).get("temperature") or "").strip().lower()
    template_hints = build_template_negative_hints(template_type)
    if temperature == "warm":
        return f"{NEGATIVE_PROMPT}, {template_hints}, green glow, cyan glow, blue glow, teal accents"
    if temperature == "cool":
        return f"{NEGATIVE_PROMPT}, {template_hints}, orange glow, yellow glow, red glow, amber accents"
    return f"{NEGATIVE_PROMPT}, {template_hints}"


def build_control_image_bytes(source_path: Path, mask_path: Path, width: int, height: int, redraw_strength: int) -> bytes:
    source = Image.open(source_path).convert("RGBA").resize((width, height))
    mask = Image.open(mask_path).convert("RGBA").resize((width, height))
    source_px = source.load()
    mask_px = mask.load()
    out = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    out_px = out.load()
    ratio = clamp(float(redraw_strength), 0, 100) / 100

    for y in range(height):
        for x in range(width):
            sr, sg, sb, _sa = source_px[x, y]
            mr, mg, mb, ma = mask_px[x, y]
            lum = round(sr * 0.2126 + sg * 0.7152 + sb * 0.0722)
            mask_value = max(mr, mg, mb, ma)
            guide = int(clamp(round(lum * lerp(0.35, 0.58, ratio) + mask_value * lerp(0.72, 0.42, ratio)), 0, 255))
            out_px[x, y] = (guide, guide, guide, 255)

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def apply_mask_alpha_bytes(
    rendered_bytes: bytes,
    source_path: Path,
    mask_path: Path,
    width: int,
    height: int,
    style_profile: dict[str, Any] | None,
    redraw_strength: int,
) -> bytes:
    rendered = Image.open(io.BytesIO(rendered_bytes)).convert("RGBA").resize((width, height))
    source = Image.open(source_path).convert("RGBA").resize((width, height))
    mask = Image.open(mask_path).convert("RGBA").resize((width, height))
    rendered_px = rendered.load()
    source_px = source.load()
    mask_px = mask.load()
    palette = sorted(
        [item for item in (hex_to_rgb(value) for value in (style_profile or {}).get("paletteHexes") or []) if item],
        key=lambda rgb: rgb["r"] * 0.2126 + rgb["g"] * 0.7152 + rgb["b"] * 0.0722,
    )
    redraw_ratio = clamp(float(redraw_strength or 55), 0, 100) / 100
    for y in range(height):
        for x in range(width):
            rr, rg, rb, ra = rendered_px[x, y]
            sr, sg, sb, _sa = source_px[x, y]
            mr, mg, mb, ma = mask_px[x, y]
            render_lum = (rr * 0.2126 + rg * 0.7152 + rb * 0.0722) / 255
            source_lum = (sr * 0.2126 + sg * 0.7152 + sb * 0.0722) / 255
            mask_alpha = max(mr, mg, mb, ma) / 255
            render_alpha = ra / 255
            source_presence = clamp(source_lum * 1.22 + mask_alpha * 0.1, 0, 1)
            structure = clamp(
                source_lum * lerp(0.84, 0.72, redraw_ratio) +
                render_lum * lerp(0.16, 0.28, redraw_ratio),
                0,
                1,
            )
            source_palette = sample_palette_color(palette, clamp(source_lum * 0.94 + render_lum * 0.06, 0, 1) ** 1.35)
            render_palette = sample_palette_color(palette, clamp(render_lum * 0.78 + source_lum * 0.22, 0, 1) ** 1.2)
            palette_color = mix_rgb(source_palette, render_palette, 0.34 + redraw_ratio * 0.22)
            brightness = clamp(0.18 + structure * 0.9, 0, 1.08)
            rendered_px[x, y] = (
                int(clamp(round(palette_color["r"] * brightness), 0, 255)),
                int(clamp(round(palette_color["g"] * brightness), 0, 255)),
                int(clamp(round(palette_color["b"] * brightness), 0, 255)),
                int(clamp(mask_alpha * max(source_presence, render_lum * 0.42, render_alpha * 0.35), 0, 1) * 255),
            )
    buf = io.BytesIO()
    rendered.save(buf, format="PNG")
    return buf.getvalue()


def build_workflow(args: dict[str, Any]) -> dict[str, Any]:
    workflow: dict[str, Any] = {
        "1": {"inputs": {"ckpt_name": args["checkpointName"]}, "class_type": "CheckpointLoaderSimple"},
        "2": {"inputs": {"image": args["initImageName"], "upload": "image"}, "class_type": "LoadImage"},
        "3": {"inputs": {"pixels": ["2", 0], "vae": ["1", 2]}, "class_type": "VAEEncode"},
        "4": {"inputs": {"text": args["prompt"], "clip": ["1", 1]}, "class_type": "CLIPTextEncode"},
        "5": {"inputs": {"text": args["negativePrompt"], "clip": ["1", 1]}, "class_type": "CLIPTextEncode"},
    }
    model_ref: list[Any] = ["1", 0]
    positive_ref: list[Any] = ["4", 0]
    negative_ref: list[Any] = ["5", 0]

    ip_plan = args.get("ipAdapterPlan")
    if args.get("styleImageName") and ip_plan:
        workflow["6"] = {"inputs": {"image": args["styleImageName"], "upload": "image"}, "class_type": "LoadImage"}
        if ip_plan["kind"] == "standard":
            workflow["7"] = {
                "inputs": {"model": ["1", 0], "preset": ip_plan["preset"]},
                "class_type": ip_plan["unifiedLoaderClass"],
            }
            workflow["8"] = {
                "inputs": {
                    "model": ["7", 0],
                    "ipadapter": ["7", 1],
                    "image": ["6", 0],
                    "weight": args["plan"]["ipAdapterWeight"],
                    "weight_type": ip_plan["weightType"],
                    "combine_embeds": ip_plan["combineEmbeds"],
                    "start_at": 0,
                    "end_at": 1,
                    "embeds_scaling": ip_plan["embedsScaling"],
                },
                "class_type": ip_plan["advancedClass"],
            }
        else:
            workflow["8"] = {
                "inputs": {
                    "model": ["1", 0],
                    "image": ["6", 0],
                    "preset": ip_plan["preset"],
                    "lora_strength": ip_plan["loraStrength"],
                    "provider": ip_plan["provider"],
                    "weight": args["plan"]["ipAdapterWeight"],
                    "weight_faceidv2": 1,
                    "weight_type": ip_plan["weightType"],
                    "combine_embeds": ip_plan["combineEmbeds"],
                    "start_at": 0,
                    "end_at": 1,
                    "embeds_scaling": ip_plan["embedsScaling"],
                    "cache_mode": ip_plan["cacheMode"],
                    "use_tiled": False,
                    "use_batch": False,
                    "sharpening": 0,
                },
                "class_type": ip_plan["advancedClass"],
            }
        model_ref = ["8", 0]

    control_plan = args.get("controlNetPlan")
    if control_plan and args.get("controlImageName"):
        workflow["20"] = {"inputs": {"image": args["controlImageName"], "upload": "image"}, "class_type": "LoadImage"}
        workflow["21"] = {
            "inputs": {"control_net_name": control_plan["modelName"]},
            "class_type": control_plan["loaderClass"],
        }
        control_ref: list[Any] = ["21", 0]
        if control_plan.get("unionTypeClass") and control_plan.get("unionType"):
            workflow["22"] = {
                "inputs": {"control_net": ["21", 0], "type": control_plan["unionType"]},
                "class_type": control_plan["unionTypeClass"],
            }
            control_ref = ["22", 0]

        if normalize_node_key(control_plan["applyClass"]) == normalize_node_key("ControlNetApplyAdvanced"):
            workflow["23"] = {
                "inputs": {
                    "positive": ["4", 0],
                    "negative": ["5", 0],
                    "control_net": control_ref,
                    "image": ["20", 0],
                    "strength": args["plan"]["controlStrength"],
                    "start_percent": 0,
                    "end_percent": 1,
                },
                "class_type": control_plan["applyClass"],
            }
            positive_ref = ["23", 0]
            negative_ref = ["23", 1]
        else:
            workflow["23"] = {
                "inputs": {
                    "conditioning": ["4", 0],
                    "control_net": control_ref,
                    "image": ["20", 0],
                    "strength": args["plan"]["controlStrength"],
                },
                "class_type": control_plan["applyClass"],
            }
            workflow["24"] = {
                "inputs": {
                    "conditioning": ["5", 0],
                    "control_net": control_ref,
                    "image": ["20", 0],
                    "strength": args["plan"]["controlStrength"],
                },
                "class_type": control_plan["applyClass"],
            }
            positive_ref = ["23", 0]
            negative_ref = ["24", 0]

    workflow["9"] = {
        "inputs": {
            "seed": max(0, round(args["seed"])),
            "steps": args["plan"]["steps"],
            "cfg": args["plan"]["cfg"],
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": args["plan"]["denoise"],
            "model": model_ref,
            "positive": positive_ref,
            "negative": negative_ref,
            "latent_image": ["3", 0],
        },
        "class_type": "KSampler",
    }
    workflow["10"] = {"inputs": {"samples": ["9", 0], "vae": ["1", 2]}, "class_type": "VAEDecode"}
    workflow["11"] = {"inputs": {"filename_prefix": args["filePrefix"], "images": ["10", 0]}, "class_type": "SaveImage"}
    return workflow


def extract_history_error_message(entry: dict[str, Any] | None) -> str:
    messages = entry.get("status", {}).get("messages", []) if isinstance(entry, dict) else []
    if not isinstance(messages, list):
        return ""
    for item in reversed(messages):
        if not isinstance(item, list) or len(item) < 2:
            continue
        payload = item[1] if isinstance(item[1], dict) else {}
        detail = str(payload.get("exception_message") or payload.get("error") or payload.get("message") or "").strip()
        node_type = str(payload.get("node_type") or "").strip()
        if detail and node_type:
            return f"{node_type}: {detail}"
        if detail:
            return detail
        if node_type:
            return f"{node_type} execution failed"
    return ""


def pick_output_image(entry: dict[str, Any] | None, preferred_node_id: str = "11") -> dict[str, Any] | None:
    outputs = entry.get("outputs") if isinstance(entry, dict) else None
    if not isinstance(outputs, dict):
        return None
    preferred = outputs.get(preferred_node_id, {}).get("images")
    if isinstance(preferred, list) and preferred and isinstance(preferred[0], dict) and preferred[0].get("filename"):
        return preferred[0]
    for value in outputs.values():
        images = value.get("images") if isinstance(value, dict) else None
        if isinstance(images, list) and images and isinstance(images[0], dict) and images[0].get("filename"):
            return images[0]
    return None


def prompt_and_wait(
    session: requests.Session,
    base_url: str,
    workflow: dict[str, Any],
    timeout_seconds: int = 180,
) -> tuple[str, dict[str, Any]]:
    queued = proxy_request_json(
        session,
        base_url,
        "/prompt",
        method="POST",
        payload={"client_id": "novaflow-aifx-runtime", "prompt": workflow},
    )
    prompt_id = str(queued.get("prompt_id") or (queued.get("data") or {}).get("prompt_id") or "").strip()
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {queued}")
    started = time.time()
    while time.time() - started < timeout_seconds:
        history = proxy_request_json(session, base_url, f"/history/{prompt_id}", method="GET")
        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if not entry and isinstance(history, dict) and history.get("outputs"):
            entry = history
        if isinstance(entry, dict):
            status = str(
                (entry.get("status") or {}).get("status_str")
                or (entry.get("status") or {}).get("status")
                or ""
            ).lower()
            if "error" in status:
                raise RuntimeError(extract_history_error_message(entry) or "ComfyUI workflow failed")
            image = pick_output_image(entry, "11")
            if image:
                return prompt_id, image
        time.sleep(1.2)
    raise RuntimeError("Timed out waiting for ComfyUI output")


def run_once(args: argparse.Namespace, ip_adapter_plan: dict[str, Any], object_info: dict[str, Any], checkpoint_name: str) -> dict[str, Any]:
    session = requests.Session()
    renderer_root = args.renderer_root.resolve()
    template_dir = renderer_root / "templates" / "vfx" / args.template_id
    manifest = json.loads((template_dir / "template.json").read_text(encoding="utf-8-sig"))
    template_type = str(manifest.get("type") or "")
    width = int(manifest.get("width") or 512)
    height = int(manifest.get("height") or 512)
    frame_index = max(0, min(int(args.frame_index), int(manifest.get("frameCount") or 1) - 1))
    source_path = template_dir / "source" / frame_name(frame_index)
    mask_path = template_dir / "mask" / frame_name(frame_index)
    style_path = args.style_image.resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"Template source frame not found: {source_path}")
    if not mask_path.is_file():
        raise FileNotFoundError(f"Template mask frame not found: {mask_path}")
    if not style_path.is_file():
        raise FileNotFoundError(f"Style image not found: {style_path}")

    redraw_strength = int(args.redraw_strength)
    plan = map_redraw_strength_to_plan(redraw_strength)
    control_plan = resolve_controlnet_plan(object_info)
    style_profile = extract_style_reference_profile(style_path)
    init_bytes = preprocess_init_image_bytes(source_path, width, height, str(plan.get("sourcePreprocess") or "grayscale_blur"))

    init_upload = upload_image_bytes(session, args.base_url, f"{sanitize_file_stem(args.template_id)}_{frame_name(frame_index)}", init_bytes)
    style_upload = upload_image_bytes(session, args.base_url, style_path.name, style_path.read_bytes(), mime_type="image/png")
    control_upload = None
    if control_plan:
        control_bytes = build_control_image_bytes(source_path, mask_path, width, height, redraw_strength)
        control_upload = upload_image_bytes(
            session,
            args.base_url,
            f"aifx_control_{sanitize_file_stem(args.template_id)}_{frame_name(frame_index)}",
            control_bytes,
        )

    workflow = build_workflow(
        {
            "checkpointName": checkpoint_name,
            "initImageName": init_upload.name,
            "styleImageName": style_upload.name,
            "controlImageName": control_upload.name if control_upload else "",
            "ipAdapterPlan": ip_adapter_plan,
            "controlNetPlan": control_plan,
            "plan": plan,
            "prompt": build_hidden_prompt(str(manifest.get("name") or args.template_id), redraw_strength, style_profile, template_type),
            "negativePrompt": build_negative_prompt(style_profile, template_type),
            "seed": int(time.time()) % 2147483647,
            "filePrefix": f"novaflow_aifx/{sanitize_file_stem(args.template_id)}/smoketest_{frame_index:03d}",
        }
    )

    prompt_id, output_image = prompt_and_wait(session, args.base_url, workflow, timeout_seconds=args.timeout)
    output_bytes = proxy_request_binary(
        session,
        args.base_url,
        f"/view?{urlencode({'filename': output_image['filename'], 'subfolder': output_image.get('subfolder', ''), 'type': output_image.get('type', 'output')})}",
    )
    rgba_bytes = apply_mask_alpha_bytes(output_bytes, source_path, mask_path, width, height, style_profile, redraw_strength)

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    rgb_path = output_dir / f"aifx_smoketest_rgb_{stamp}.png"
    rgba_path = output_dir / f"aifx_smoketest_rgba_{stamp}.png"
    report_path = output_dir / f"aifx_smoketest_report_{stamp}.json"
    rgb_path.write_bytes(output_bytes)
    rgba_path.write_bytes(rgba_bytes)

    report = {
        "ok": True,
        "prompt_id": prompt_id,
        "template_id": args.template_id,
        "frame_index": frame_index,
        "style_image": str(style_path),
        "style_profile": style_profile,
        "checkpoint": checkpoint_name,
        "ipadapter_plan": ip_adapter_plan,
        "controlnet_plan": control_plan,
        "redraw_strength": redraw_strength,
        "output_image": output_image,
        "rgb_path": str(rgb_path),
        "rgba_path": str(rgba_path),
        "report_path": str(report_path),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a full NovaFlow AI FX pipeline smoketest against the locked 4783 proxy.")
    parser.add_argument("--base-url", default=DEFAULT_COMFY_BASE)
    parser.add_argument("--renderer-root", type=Path, default=DEFAULT_RENDERER_ROOT)
    parser.add_argument("--template-id", default=DEFAULT_TEMPLATE_ID)
    parser.add_argument("--frame-index", type=int, default=0)
    parser.add_argument("--style-image", type=Path, default=DEFAULT_STYLE_IMAGE)
    parser.add_argument("--redraw-strength", type=int, default=55)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--output-dir", type=Path, default=Path("D:/AI_APP/NovaFlow/debug-output"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session = requests.Session()
    object_info = proxy_request_json(session, args.base_url, "/object_info", method="GET")
    raw_checkpoint = object_info.get("CheckpointLoaderSimple", {}).get("input", {}).get("required", {}).get("ckpt_name")
    checkpoint_options = raw_checkpoint[0] if isinstance(raw_checkpoint, list) and raw_checkpoint and isinstance(raw_checkpoint[0], list) else raw_checkpoint
    checkpoint_name = str(checkpoint_options[0] if checkpoint_options else "").strip()
    if not checkpoint_name:
        raise RuntimeError("No checkpoint was found in ComfyUI")

    redraw_plan = map_redraw_strength_to_plan(args.redraw_strength)
    ip_plan = resolve_ipadapter_plan(object_info, redraw_plan["controlLevel"])
    if not ip_plan:
        raise RuntimeError("ComfyUI IPAdapter nodes are unavailable")

    try:
        report = run_once(args, ip_plan, object_info, checkpoint_name)
    except RuntimeError as exc:
        message = str(exc)
        if "ipadapter model not found" not in message.lower():
            raise
        fallback = resolve_fallback_ipadapter_plan(object_info, ip_plan)
        if not fallback:
            raise
        report = run_once(args, fallback, object_info, checkpoint_name)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
