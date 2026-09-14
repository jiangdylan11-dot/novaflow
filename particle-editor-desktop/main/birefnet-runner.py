import argparse, os, warnings, json, time
from concurrent.futures import ThreadPoolExecutor
warnings.filterwarnings("ignore", category=FutureWarning)
import torch
import torchvision.transforms as T
from PIL import Image
from transformers import AutoModelForImageSegmentation

def load_model(model_id, device, local_files_only):
    model = AutoModelForImageSegmentation.from_pretrained(model_id, trust_remote_code=True, local_files_only=local_files_only)
    model.eval()
    if device == "cuda" and torch.cuda.is_available():
        model = model.cuda()
        try:
            torch.set_float32_matmul_precision("high")
        except Exception:
            pass
        return model, "cuda"
    return model, "cpu"

def select_prediction(raw):
    if isinstance(raw, (list, tuple)):
        return raw[-1]
    if isinstance(raw, dict):
        for key in ("pred", "preds", "logits", "out"):
            if key in raw:
                return raw[key]
        return list(raw.values())[-1]
    return raw

def run_prediction(model, device, inp):
    with torch.inference_mode():
        return select_prediction(model(inp)).sigmoid().cpu()

def retry_on_cpu(model, inp):
    model = model.cpu()
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass
    return model, "cpu", run_prediction(model, "cpu", inp.cpu())

TRANSFORM = T.Compose([T.Resize((1024, 1024)), T.ToTensor(), T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

def prepare_image(in_path):
    with Image.open(in_path) as source:
        img = source.convert("RGB")
    return img, TRANSFORM(img)

def save_prediction(img, pred, out_path):
    mask_pil = T.ToPILImage()(pred.squeeze()).resize(img.size)
    out = img.convert("RGBA")
    out.putalpha(mask_pil)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pending = out_path + ".pending"
    out.save(pending, format="PNG", compress_level=1)
    os.replace(pending, out_path)

def process_image(model, device, in_path, out_path):
    img, tensor = prepare_image(in_path)
    inp = tensor.unsqueeze(0).to(device)
    try:
        preds = run_prediction(model, device, inp)
    except Exception:
        if device != "cuda":
            raise
        model, device, preds = retry_on_cpu(model, inp)
    save_prediction(img, preds[0], out_path)
    return model, device

def process_folder(model, device, input_dir, output_dir, names, batch_size):
    # Only one prepared batch and two pending PNG writes are retained.
    def prepare(batch):
        values = [prepare_image(os.path.join(input_dir, n)) for n in batch]
        return batch, [v[0] for v in values], torch.stack([v[1] for v in values])
    with ThreadPoolExecutor(max_workers=1) as reader, ThreadPoolExecutor(max_workers=2) as writer:
        cursor = 0
        pending = reader.submit(prepare, names[:batch_size])
        writes = []
        while cursor < len(names):
            batch, images, tensor = pending.result()
            cursor += len(batch)
            if cursor < len(names):
                pending = reader.submit(prepare, names[cursor:cursor+batch_size])
            inp = tensor.to(device)
            try:
                preds = run_prediction(model, device, inp)
            except Exception as error:
                if device != "cuda":
                    raise
                if isinstance(error, torch.cuda.OutOfMemoryError) and len(batch) > 1:
                    del inp
                    torch.cuda.empty_cache()
                    try:
                        preds = torch.cat([run_prediction(model, device, t.unsqueeze(0).to(device)) for t in tensor])
                        batch_size = 1
                        print(json.dumps({"event":"batch-reduced", "device":device, "batchSize":1}), flush=True)
                    except Exception:
                        model, device, preds = retry_on_cpu(model, tensor)
                else:
                    model, device, preds = retry_on_cpu(model, tensor)
                if device == "cpu":
                    print(json.dumps({"event":"cpu-fallback", "reason":str(error)[:240]}), flush=True)
            for name, img, pred in zip(batch, images, preds):
                if len(writes) >= 2:
                    writes.pop(0).result()
                writes.append(writer.submit(save_prediction, img, pred, os.path.join(output_dir, name)))
        for future in writes:
            future.result()
    return model, device

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["image","folder"], required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--model_id", default="ZhengPeng7/BiRefNet")
    ap.add_argument("--local_files_only", action="store_true")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--batch-size", type=int, default=0)
    ap.add_argument("--priority-file")
    args = ap.parse_args()
    dev = "cuda" if (args.device == "auto" and torch.cuda.is_available()) or args.device == "cuda" else "cpu"
    model, dev = load_model(args.model_id, dev, args.local_files_only)
    torch.set_num_threads(min(4, os.cpu_count() or 1) if dev == "cuda" else min(8, os.cpu_count() or 1))
    if args.mode == "image":
        process_image(model, dev, args.input, args.output)
        return
    names = [n for n in os.listdir(args.input) if n.lower().endswith(".png")]
    names.sort()
    if args.priority_file:
        priorities = json.load(open(args.priority_file, encoding="utf-8"))
        rank = {n:i for i,n in enumerate(priorities)}
        names.sort(key=lambda n:(rank.get(n, len(rank)),n))
    # This model's tested batch-2/4 kernels were slower and changed mask rounding.
    # Keep exact single-frame inference while overlapping preparation and writes.
    size = max(1, min(4, args.batch_size)) if args.batch_size else 1
    started = time.perf_counter()
    print(json.dumps({"event":"inference-start", "device":dev, "batchSize":size, "frames":len(names)}), flush=True)
    model, dev = process_folder(model, dev, args.input, args.output, names, size)
    print(json.dumps({"event":"inference-complete", "device":dev, "seconds":time.perf_counter()-started}), flush=True)

if __name__ == "__main__":
    main()
