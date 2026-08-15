#!/usr/bin/env python3
"""AIFX_AUTO_PROMPT_BUILDER validation helper.

The builder analyzes a style reference image and turns visual evidence into a
strong VFX prompt for video-to-video experiments. It does not call ComfyUI and
does not modify NovaFlow product code.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


PIPELINE = "AIFX_AUTO_PROMPT_BUILDER"
SUPPORTED_EFFECT_TYPES = {
    "fire",
    "lightning",
    "ice",
    "water",
    "poison",
    "dark",
    "holy",
    "magic",
    "metal",
    "energy",
    "smoke",
    "crystal",
}

NEGATIVE_PROMPT = (
    "person, human, face, body, hand, character, object, weapon, scene, room, "
    "landscape, text, logo, realistic background, camera footage"
)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rgb_to_hsv_array(rgb: np.ndarray) -> np.ndarray:
    rgb_f = rgb.astype(np.float32) / 255.0
    return cv2.cvtColor(rgb_f, cv2.COLOR_RGB2HSV)


def load_rgb(path: str | Path, size: int = 256) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(image, ((size - image.width) // 2, (size - image.height) // 2))
    return np.asarray(canvas)


def describe_color(hue_deg: float, saturation: float, brightness: float, rgb: tuple[float, float, float]) -> str:
    r, g, b = rgb
    if brightness < 0.18:
        return "deep black, smoky gray, and muted shadow tones"
    if saturation < 0.18:
        if brightness > 0.72:
            return "silver white and pale gray highlights"
        return "neutral gray and desaturated metallic tones"
    if hue_deg < 25 or hue_deg >= 345:
        return "red crimson core and hot scarlet glow"
    if hue_deg < 55:
        return "orange gold flame palette with yellow highlights"
    if hue_deg < 85:
        return "gold white radiance with warm yellow highlights"
    if hue_deg < 165:
        return "toxic green glow and acid emerald energy"
    if hue_deg < 205:
        return "cyan blue transparent glow and watery highlights"
    if hue_deg < 255:
        return "electric blue and white luminous highlights"
    if hue_deg < 300:
        return "violet purple arcane glow and dark blue shadows"
    return "magenta red-violet energy and dark purple shadows"


def classify_texture(edge_sharpness: float, contrast: float, saturation: float, brightness: float) -> str:
    if edge_sharpness > 0.28 and contrast > 0.24:
        return "sharp branching streaks and crisp high-frequency energy filaments"
    if contrast > 0.28 and saturation < 0.28:
        return "hard reflective facets and metallic specular cuts"
    if brightness < 0.25 and contrast < 0.2:
        return "soft smoky gradients and shadowy vapor texture"
    if saturation > 0.5 and contrast > 0.18:
        return "flowing luminous texture with visible internal energy veins"
    return "layered glowing texture with subtle noise and soft internal gradients"


def material_for_effect(effect_type: str) -> str:
    return {
        "fire": "hot flame material, molten edges, ember-like glow",
        "lightning": "electric plasma material, jagged arcs, bright white-blue cores",
        "ice": "frosted crystal material, cold translucent glow, sharp icy edges",
        "water": "fluid water material, translucent blue flow, liquid refraction",
        "poison": "toxic liquid material, acidic glow, viscous green energy",
        "dark": "shadow smoke material, dark mist, violet-black magical energy",
        "holy": "holy light material, gold-white radiance, clean luminous aura",
        "magic": "arcane magic material, saturated glow, mystical particles",
        "metal": "reflective metal material, silver facets, hard specular highlights",
        "energy": "pure energy material, bright core, glowing aura",
        "smoke": "smoky vapor material, soft turbulence, diffuse shadow edges",
        "crystal": "crystal material, faceted refraction, sharp reflective highlights",
    }.get(effect_type, "pure energy material, bright core, glowing aura")


def analyze_style_reference(style_reference_image: str | Path) -> dict[str, Any]:
    rgb = load_rgb(style_reference_image)
    hsv = rgb_to_hsv_array(rgb)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0

    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    weights = (saturation + 0.08) * (value + 0.08)
    weight_sum = float(weights.sum()) or 1.0
    hue_rad = hsv[:, :, 0] / 360.0 * math.tau
    sin_h = float((np.sin(hue_rad) * weights).sum() / weight_sum)
    cos_h = float((np.cos(hue_rad) * weights).sum() / weight_sum)
    hue_deg = (math.degrees(math.atan2(sin_h, cos_h)) + 360.0) % 360.0

    dominant_rgb = tuple(float(v) for v in (rgb.astype(np.float32) * weights[:, :, None]).sum(axis=(0, 1)) / weight_sum)
    brightness = float(gray.mean())
    contrast = float(gray.std())
    saturation_mean = float(saturation.mean())
    bright_fraction = float((gray > 0.72).mean())
    dark_fraction = float((gray < 0.18).mean())

    sobel_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    edge_mag = np.sqrt(sobel_x * sobel_x + sobel_y * sobel_y)
    edge_sharpness = float(clamp(float(np.percentile(edge_mag, 92)), 0.0, 1.0))
    edge_density = float((edge_mag > 0.18).mean())

    _, bright_mask = cv2.threshold((gray * 255).astype(np.uint8), 180, 255, cv2.THRESH_BINARY)
    labels, _, stats, _ = cv2.connectedComponentsWithStats(bright_mask, connectivity=8)
    small_bright_components = 0
    for index in range(1, labels):
        area = int(stats[index, cv2.CC_STAT_AREA])
        if 3 <= area <= 260:
            small_bright_components += 1
    particle_density = float(clamp(small_bright_components / 80.0, 0.0, 1.0))

    glow_level = float(clamp(bright_fraction * 3.5 + contrast * 0.8, 0.0, 1.0))
    texture_description = classify_texture(edge_sharpness, contrast, saturation_mean, brightness)
    color_description = describe_color(hue_deg, saturation_mean, brightness, dominant_rgb)

    return {
        "dominantRgb": dominant_rgb,
        "dominantHueDegrees": hue_deg,
        "brightness": brightness,
        "contrast": contrast,
        "saturation": saturation_mean,
        "brightFraction": bright_fraction,
        "darkFraction": dark_fraction,
        "edgeSharpness": edge_sharpness,
        "edgeDensity": edge_density,
        "particleDensity": particle_density,
        "glowLevel": glow_level,
        "colorDescription": color_description,
        "textureDescription": texture_description,
    }


def infer_effect_type(features: dict[str, Any], user_effect_type: str | None = None) -> tuple[str, float, list[str]]:
    if user_effect_type and user_effect_type in SUPPORTED_EFFECT_TYPES:
        return user_effect_type, 0.98, ["user_override", user_effect_type]

    hue = float(features["dominantHueDegrees"])
    sat = float(features["saturation"])
    brightness = float(features["brightness"])
    contrast = float(features["contrast"])
    edge = float(features["edgeSharpness"])
    glow = float(features["glowLevel"])
    dark = float(features["darkFraction"])
    rgb = features["dominantRgb"]
    r, g, b = rgb

    tags: list[str] = []
    effect = "energy"
    confidence = 0.55

    if sat < 0.22 and brightness > 0.48 and contrast > 0.18:
        effect, confidence = "metal", 0.72
        tags += ["low_saturation", "reflective_gray", "hard_highlights"]
    elif dark > 0.68 and brightness < 0.28:
        effect, confidence = ("dark", 0.82) if hue < 250 or hue > 285 else ("dark", 0.88)
        tags += ["low_brightness", "shadow", "smoke"]
    elif r > 155 and g > 130 and b < 115 and brightness > 0.45:
        effect, confidence = "holy", 0.76
        tags += ["gold_white", "high_brightness", "holy_light"]
    elif hue < 25 or hue >= 345 or (r > g * 1.25 and r > b * 1.25):
        effect, confidence = "fire", 0.9 if glow > 0.25 else 0.78
        tags += ["red_orange", "warm_glow", "flowing_energy"]
    elif 25 <= hue < 65:
        effect, confidence = "fire", 0.78
        tags += ["orange_gold", "warm_highlights"]
    elif 75 <= hue < 165 or (g > r * 1.15 and g > b * 1.08):
        effect, confidence = ("poison", 0.88) if sat > 0.3 else ("energy", 0.62)
        tags += ["green", "toxic", "acid_glow"]
    elif 165 <= hue < 205:
        effect, confidence = "water", 0.74
        tags += ["cyan_blue", "fluid", "transparent"]
    elif 205 <= hue < 255 or (b > r * 1.15 and b > g * 1.08):
        if edge > 0.26 and contrast > 0.18:
            effect, confidence = "lightning", 0.84
            tags += ["blue_white", "sharp_edges", "electric"]
        elif brightness > 0.52 and sat < 0.45:
            effect, confidence = "ice", 0.78
            tags += ["blue_white", "cold", "frost"]
        else:
            effect, confidence = "water", 0.68
            tags += ["blue", "fluid", "cool"]
    elif 255 <= hue < 315:
        effect, confidence = "magic", 0.74 if brightness > 0.26 else 0.66
        tags += ["purple", "arcane", "mystic"]

    if glow > 0.5:
        tags.append("strong_glow")
    if edge > 0.28:
        tags.append("sharp_edge_detail")
    if contrast > 0.24:
        tags.append("high_contrast")
    if float(features["particleDensity"]) > 0.2:
        tags.append("particle_sparks")

    return effect, float(clamp(confidence, 0.0, 1.0)), sorted(set(tags))


def build_aifx_auto_prompt(
    style_reference_image: str | Path,
    user_effect_type: str | None = None,
    template_video_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    features = analyze_style_reference(style_reference_image)
    effect_type, confidence, tags = infer_effect_type(features, user_effect_type)
    color_description = features["colorDescription"]
    texture_description = features["textureDescription"]
    material_description = material_for_effect(effect_type)
    frame_count = None
    fps = None
    if template_video_info:
        frame_count = template_video_info.get("used_frame_count") or template_video_info.get("frame_count")
        fps = template_video_info.get("fps")
    timing = ""
    if frame_count:
        timing = f" Preserve the input video's timing across {frame_count} frames"
        if fps:
            timing += f" at {fps} FPS"
        timing += "."

    positive = (
        f"A {effect_type} game VFX effect following the motion of the input video, "
        f"with {color_description}, {material_description}, {texture_description}, "
        "strong glow, dynamic particles, high contrast highlights, "
        "black background, VFX only, "
        "no character, no human, no object, no scene."
        f"{timing}"
    )

    return {
        "pipeline": PIPELINE,
        "positivePrompt": positive,
        "negativePrompt": NEGATIVE_PROMPT,
        "inferredEffectType": effect_type,
        "confidence": confidence,
        "styleTags": tags,
        "analysis": features,
    }


def make_prompt_test_images(out_dir: Path, size: int = 256) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    refs = {
        "red": Image.new("RGB", (size, size), (245, 42, 12)),
        "blue": Image.new("RGB", (size, size), (30, 100, 255)),
        "green": Image.new("RGB", (size, size), (28, 230, 86)),
        "dark": Image.new("RGB", (size, size), (9, 6, 18)),
    }

    draw = ImageDraw.Draw(refs["dark"], "RGBA")
    for radius, alpha in [(110, 35), (70, 50), (30, 120)]:
        draw.ellipse((128 - radius, 128 - radius, 128 + radius, 128 + radius), fill=(70, 20, 120, alpha))
    refs["dark"] = refs["dark"].filter(ImageFilter.GaussianBlur(1.8))

    paths: dict[str, Path] = {}
    for name, image in refs.items():
        path = out_dir / f"prompt_test_{name}.png"
        image.save(path)
        paths[name] = path
    return paths


def run_prompt_builder_selftest(out_dir: Path) -> dict[str, Any]:
    refs = make_prompt_test_images(out_dir / "prompt_test_refs")
    results = {
        name: build_aifx_auto_prompt(path, template_video_info={"used_frame_count": 9, "fps": 12})
        for name, path in refs.items()
    }
    checks = {
        "red_not_energy": results["red"]["inferredEffectType"] != "energy",
        "blue_is_lightning_ice_or_water": results["blue"]["inferredEffectType"] in {"lightning", "ice", "water"},
        "green_is_poison_or_energy": results["green"]["inferredEffectType"] in {"poison", "energy"},
        "dark_is_dark_or_smoke": results["dark"]["inferredEffectType"] in {"dark", "smoke"},
    }
    report = {
        "pipeline": PIPELINE,
        "status": "pass" if all(checks.values()) else "failed",
        "checks": checks,
        "references": {name: str(path) for name, path in refs.items()},
        "results": results,
    }
    (out_dir / "prompt_test_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AIFX_AUTO_PROMPT_BUILDER selftest.")
    parser.add_argument("--out-dir", type=Path, default=Path("debug-output") / "aifx-auto-prompt-builder")
    parser.add_argument("--image", type=Path)
    parser.add_argument("--effect-type", choices=sorted(SUPPORTED_EFFECT_TYPES))
    args = parser.parse_args()

    if args.image:
        result = build_aifx_auto_prompt(args.image, user_effect_type=args.effect_type)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    args.out_dir.mkdir(parents=True, exist_ok=True)
    report = run_prompt_builder_selftest(args.out_dir)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
