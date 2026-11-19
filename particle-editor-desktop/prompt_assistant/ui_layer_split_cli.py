"""UI layer split as one process per request, for a compute node.

The editor supplies confirmed regions. This process generates layers via the local image service,
writes the answer to a file and exits.

stdin : {"payload": the 'ui-layer-split' request, "runtimeJson": path of the runtime's runtime.json, "result": output file}
stderr: one line per stage ("progress <text>")
file  : {"ok": true, "data": {...}} or {"ok": false, "error": "..."}
"""
import json
import os
import sys
from pathlib import Path

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")


def main():
    request = json.load(sys.stdin)
    target = Path(request["result"])
    try:
        payload = dict(request["payload"])
        if payload.get("visualSchema") != "nf.ui.layers.v1":
            raise ValueError("UI 拆图协议无效")
        config = json.loads(Path(request["runtimeJson"]).read_text(encoding="utf-8-sig"))
        install = Path(config.get("installPath") or Path(request["runtimeJson"]).parent)
        comfy_root = os.environ.get("NOVAFLOW_COMFY_ROOT") or str(install / "engine" / "ComfyUI")
        models_dir = config.get("modelsPath") or str(Path(config.get("assetsPath") or "") / "models")
        if not payload.get("comfyUrl"):
            payload["comfyUrl"] = "http://127.0.0.1:%d" % int(config.get("port") or 8188)
        from prompt_assistant.ui_layer_split import split_request
        data = split_request(payload, comfy_root, models_dir, progress=lambda text: print("progress " + str(text), file=sys.stderr, flush=True))
        answer = {"ok": True, "data": data}
    except Exception as error:  # the node shows this sentence to the user
        answer = {"ok": False, "error": str(error) or error.__class__.__name__}
    target.write_text(json.dumps(answer, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
