import argparse, os, warnings
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
    with torch.no_grad():
        return select_prediction(model(inp)).sigmoid().cpu()

def retry_on_cpu(model, inp):
    model = model.cpu()
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass
    return model, "cpu", run_prediction(model, "cpu", inp.cpu())

def process_image(model, device, in_path, out_path):
    img = Image.open(in_path).convert("RGB")
    orig_size = img.size
    image_size = (1024, 1024)
    transform = T.Compose([
        T.Resize(image_size),
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    ])
    inp = transform(img).unsqueeze(0).to(device)
    try:
        preds = run_prediction(model, device, inp)
    except Exception:
        if device != "cuda":
            raise
        model, device, preds = retry_on_cpu(model, inp)
    pred = preds[0].squeeze()
    mask_pil = T.ToPILImage()(pred).resize(orig_size)
    out = img.convert("RGBA")
    out.putalpha(mask_pil)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save(out_path)
    return model, device

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["image","folder"], required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--model_id", default="ZhengPeng7/BiRefNet")
    ap.add_argument("--local_files_only", action="store_true")
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()
    dev = "cuda" if (args.device == "auto" and torch.cuda.is_available()) or args.device == "cuda" else "cpu"
    model, dev = load_model(args.model_id, dev, args.local_files_only)
    if args.mode == "image":
        process_image(model, dev, args.input, args.output)
        return
    names = [n for n in os.listdir(args.input) if n.lower().endswith(".png")]
    names.sort()
    for n in names:
        in_p = os.path.join(args.input, n)
        out_p = os.path.join(args.output, n)
        model, dev = process_image(model, dev, in_p, out_p)

if __name__ == "__main__":
    main()
