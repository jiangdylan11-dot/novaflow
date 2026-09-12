"""Apply the already-supported Rapid routes without changing ordinary txt2img."""
from pathlib import Path
import re

def edit(name, transform):
    p = Path(name)
    text = p.read_text(encoding='utf-8')
    result = transform(text)
    if result == text:
        raise RuntimeError('No changes: ' + name)
    p.write_text(result, encoding='utf-8', newline='\r\n')

def brand(s):
    # Retire the ordinary template, including stale internal callers that use its key.
    rapid = re.search(r'^    img2imgNsfw: (`.*`),?$', s, re.M).group(1)
    s = re.sub(r'^    img2img: `.*`,$', lambda m: '    img2img: ' + rapid + ',', s, flags=re.M)
    s = s.replace('    const state = arguments.length > 8 && arguments[8] && typeof arguments[8] === "object"\n      ? arguments[8]\n      : ART_GENERATE_STATE;',
      '    const requestedState = arguments.length > 8 && arguments[8] && typeof arguments[8] === "object"\n      ? arguments[8]\n      : ART_GENERATE_STATE;\n    const state = provider === "local" && mode === "img2img" ? { ...requestedState, nsfw: true } : requestedState;')
    s = s.replace('        nsfw: !!source.nsfw,', '        nsfw: provider === "local" && mode === "img2img" ? true : !!source.nsfw,')
    # Model choice in img2img is now fixed. Keep the ordinary txt2img toggle independent.
    s = s.replace('      renderArtGenerateToggleButton(ART_GENERATE_STATE.nsfw, "NSFW", () => {',
      '      ART_GENERATE_STATE.provider === "local" && ART_GENERATE_STATE.mode === "img2img"\n        ? createArtEl("span", { text: "Rapid", title: "图生图统一使用 Qwen Rapid AIO" })\n        : renderArtGenerateToggleButton(ART_GENERATE_STATE.nsfw, "NSFW", () => {')
    return s

def presets(s):
    s = s.replace("const familyKey = source.nsfw ? 'rapid' : 'standard'", "const familyKey = modeKey === 'img2img' || source.nsfw ? 'rapid' : 'standard'")
    s = s.replace("    const lightningToggles = source.nsfw ? [] : nodes.filter(isLightningToggle)\n    if (!source.nsfw && !lightningToggles.length)", "    const rapidFamily = normalizeMode(mode || source.mode) === 'img2img' || source.nsfw\n    const lightningToggles = rapidFamily ? [] : nodes.filter(isLightningToggle)\n    if (!rapidFamily && !lightningToggles.length)")
    return s

def split(s):
    # Old saved false/default values must not reintroduce the retired base.
    s = s.replace("    const rapidAioNsfwRequested = provider === true || provider === 'qwen-rapid-aio-nsfw-v20' || provider === 'rapid-aio-nsfw'", "    const rapidAioNsfwRequested = true // Local edit/completion now share the existing Rapid route.")
    s = s.replace("    return String(value || '') === STORYBOARD_MODEL_MODE_NSFW ? STORYBOARD_MODEL_MODE_NSFW : STORYBOARD_MODEL_MODE_DEFAULT", "    return STORYBOARD_MODEL_MODE_NSFW // Includes legacy persisted 'default' values.")
    s = s.replace('const inpaintNsfwEnabled = showInpaintNsfw && !!(state.selectionTool && state.selectionTool.inpaintNsfwEnabled)', 'const inpaintNsfwEnabled = showInpaintNsfw')
    s = s.replace("showInpaintNsfw ? button('NSFW', () => toggleSelectionInpaintNsfw(), inpaintNsfwEnabled, {", "showInpaintNsfw ? button('Rapid', () => {}, inpaintNsfwEnabled, {")
    s = s.replace("title: inpaintNsfwEnabled ? 'NSFW 已开启：使用 Qwen Rapid AIO NSFW V20' : 'NSFW 已关闭：使用当前默认修图模型',", "title: '局部编辑和智能补图统一使用 Qwen Rapid AIO NSFW V20',")
    return s

edit('particle-editor/novaflow-brand-runtime.js', brand)
edit('particle-editor/art-generate-model.resource.js', presets)
edit('particle-editor/spine-split-runtime.js', split)
edit('particle-editor/art-generate-lora.js', lambda s: s.replace('const request = { nsfw: !!record.options.state.nsfw }', "const request = { nsfw: record.options.state.mode === 'img2img' || !!record.options.state.nsfw }"))
edit('particle-editor-desktop/main/qwen-lora-catalog.js', lambda s: s.replace("edit: 'unet/qwen_image_edit_2511_fp8mixed.safetensors'", "edit: 'checkpoints/Qwen-Rapid-AIO-NSFW-v20.safetensors'"))
