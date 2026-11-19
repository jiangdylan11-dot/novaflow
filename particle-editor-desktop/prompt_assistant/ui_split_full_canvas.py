"""Full-canvas Qwen 2.1 passes used to generate UI, backgrounds and isolated material."""
import json
from pathlib import Path

GRAPH = Path(__file__).with_name("ui_split_full_canvas.json")
POSITION = "严格保持原图的画布、物体位置、比例、姿势、相机取景和透视。"


def render_pass(client, reference, prompt, seed, *, detail_pass=False):
    graph = json.loads(GRAPH.read_bytes())
    graph["100"]["inputs"]["image"] = client.upload(reference.convert("RGB"), "full_canvas_original")
    graph["5"]["inputs"]["prompt"] = prompt + "\n" + POSITION
    graph["7"]["inputs"]["noise_seed"] = seed
    # Whole canvas passes snap each side to the model grid. Detail passes in
    # the accepted workflow use a reduced pixel budget for the reference crop.
    width, height = reference.size
    scale = (1100000 / (width * height)) ** 0.5 if detail_pass else min(1, (1253376 / (width * height)) ** 0.5)
    graph["200"]["inputs"].update(width=max(64, round(width * scale / 32) * 32),
                                  height=max(64, round(height * scale / 32) * 32))
    graph["9"]["inputs"].update(width=width, height=height)
    return client.result(client.queue(graph), "10", mode=None)
