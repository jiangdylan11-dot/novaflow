from pathlib import Path
import runpy


service_path = Path("particle-editor-desktop/prompt-assistant-service.py")
service = runpy.run_path(str(service_path))
assistant = service["PromptAssistant"]()

optimize_prompts = []


def fake_optimize(prompt, **_kwargs):
    optimize_prompts.append(prompt)
    return "正向：东方幻想风银色长剑，精细金属纹理，蓝色月光\n负向：低质量, 模糊"


assistant.generate = fake_optimize
assistant.optimize_prompt({
    "prompt": "石台上的银色长剑",
    "requirements": "增加精细金属纹理和蓝色月光",
})
assert "增加精细金属纹理和蓝色月光" in optimize_prompts[0]
assert "视频生成 Prompt 设计助手" not in optimize_prompts[0]

assistant.optimize_prompt({"prompt": "石台上的银色长剑"})
assert "用户附加要求" not in optimize_prompts[1]

assistant.optimize_prompt({
    "prompt": "白衣剑客站在竹林中",
    "surface": "animation",
    "purpose": "video_prompt",
    "currentPrompt": "白衣剑客站在竹林中",
    "requirements": "人物缓慢拔剑，镜头轻微推进",
})
animation_optimize_prompt = optimize_prompts[2]
for token in [
    "视频生成 Prompt 设计助手",
    "动作开始状态",
    "连续动作过程",
    "动作结束状态",
    "速度与节奏",
    "约5秒",
    "单一连贯运镜",
    "背景、构图、光线和主体位置关系保持稳定",
    "白衣剑客站在竹林中",
    "人物缓慢拔剑，镜头轻微推进",
]:
    assert token in animation_optimize_prompt, f"missing animation optimize contract: {token}"

for purpose in ["video", "video_prompt", "image_to_video", "video_reverse"]:
    assert service["is_animation_prompt_payload"]({"purpose": purpose})
assert service["current_prompt_from_payload"]({"currentPrompt": "A", "current_prompt": "B", "prompt": "C"}) == "A"
assert service["current_prompt_from_payload"]({"current_prompt": "B", "prompt": "C"}) == "B"
assert service["current_prompt_from_payload"]({"prompt": "C"}) == "C"

assistant.reverse_image_prompt.__globals__["data_url_to_tensor"] = lambda _value: object()
reverse_prompts = []


def fake_reverse(prompt, **_kwargs):
    reverse_prompts.append(prompt)
    return "东方幻想风格的银色长剑，精细金属纹理，蓝色月光"


assistant.generate = fake_reverse
assistant.reverse_image_prompt({
    "images": [{"dataUrl": "data:image/png;base64,test"}],
    "requirements": "改为东方幻想风格并增加蓝色月光",
})
assert "改为东方幻想风格并增加蓝色月光" in reverse_prompts[0]
assert "图生视频 Prompt 设计助手" not in reverse_prompts[0]

assistant.reverse_image_prompt({
    "images": [{"dataUrl": "data:image/png;base64,test", "role": "first_frame"}],
    "surface": "animation",
    "purpose": "image_to_video",
    "currentPrompt": "人物保持正面并缓慢转身",
    "requirements": "镜头缓慢推进",
})
animation_reverse_prompt = reverse_prompts[1]
for token in [
    "图生视频 Prompt 设计助手",
    "视为视频首帧",
    "连续动作过程",
    "结束状态",
    "约5秒",
    "单一连贯运镜",
    "当前已有视频提示",
    "人物保持正面并缓慢转身",
    "镜头缓慢推进",
]:
    assert token in animation_reverse_prompt, f"missing animation reverse contract: {token}"

# The first/last-frame route must remain the established two-stage analysis -> final
# workflow, while current prompt and requirements are merged only into the final prompt.
pair_prompts = []


def fake_pair(prompt, **_kwargs):
    pair_prompts.append(prompt)
    if len(pair_prompts) == 1:
        return "人物从静止到缓慢抬剑，背景不变，镜头固定"
    return "人物从静止开始缓慢抬剑，最后稳定持剑，镜头固定，背景保持不变"


assistant.generate = fake_pair
assistant.reverse_image_prompt.__globals__["is_first_last_action_prompt_quality_ok"] = lambda _value: True
assistant.reverse_image_prompt({
    "images": [
        {"dataUrl": "data:image/png;base64,first", "role": "first_frame", "slotType": "first_frame"},
        {"dataUrl": "data:image/png;base64,last", "role": "last_frame", "slotType": "last_frame"},
    ],
    "surface": "animation",
    "purpose": "video_reverse",
    "currentPrompt": "角色先观察前方再抬剑",
    "requirements": "保持服装和面部一致",
})
assert len(pair_prompts) == 2, "first/last-frame reverse must keep the two-stage inference path"
assert "图片1（首帧）" in pair_prompts[0]
assert "图片2（尾帧）" in pair_prompts[0]
assert "角色先观察前方再抬剑" not in pair_prompts[0]
assert "角色先观察前方再抬剑" in pair_prompts[1]
assert "保持服装和面部一致" in pair_prompts[1]

print("local requirements and animation prompt contract passed")
