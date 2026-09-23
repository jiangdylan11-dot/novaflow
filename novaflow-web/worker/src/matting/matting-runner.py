"""Run BiRefNet on the exact PNG frames captured by the Web renderer.

Frame packs contain repeated little-endian u32 index, u32 length, PNG bytes.
No second video decode: alpha belongs to the same pixel snapshot the editor
uses for compositing. Output mask packs use the same header and zlib planes.
"""

import argparse
import json
import os
import struct
import subprocess
import sys
import threading
import time
import zlib

def emit(event, **fields):
    fields["event"] = event
    # ensure_ascii on purpose. These lines carry Chinese progress text and are
    # read off a pipe by Node, which decodes UTF-8; Python on Windows writes
    # stdout in the console codepage, so unescaped text arrives as mojibake and
    # the user reads garbage where the progress note should be. Escaping keeps
    # the wire pure ASCII and JSON.parse restores the characters exactly.
    print(json.dumps(fields, ensure_ascii=True), flush=True)


def progress(percent, note):
    emit("progress", percent=percent, note=note)


def fail(message):
    emit("result", ok=False, error=message)
    sys.exit(1)


def unpack_frames(paths, out_dir, width, height, count):
    from PIL import Image
    from io import BytesIO
    os.makedirs(out_dir, exist_ok=True)
    names = []
    for path in paths:
        with open(path, "rb") as handle:
            while True:
                header = handle.read(8)
                if not header:
                    break
                if len(header) != 8:
                    fail("视频帧包头不完整")
                index, size = struct.unpack("<II", header)
                if index != len(names) or index >= count or not 0 < size <= 64 * 1024 * 1024:
                    fail("视频帧包序号或长度无效")
                data = handle.read(size)
                if len(data) != size or not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    fail("视频帧 PNG 数据不完整")
                with Image.open(BytesIO(data)) as image:
                    if image.format != "PNG" or image.size != (width, height):
                        fail("视频帧尺寸与浏览器不一致")
                    image.verify()
                name = "f_%06d.png" % index
                with open(os.path.join(out_dir, name), "wb") as output:
                    output.write(data)
                names.append(name)
    if len(names) != count:
        fail("视频帧包数量不匹配：%d/%d" % (len(names), count))
    return names


def run_birefnet(runner, python, python_args, frames_dir, masks_dir, model_id, local_only, total):
    """Use the existing BiRefNet transform without changing alpha semantics."""
    os.makedirs(masks_dir, exist_ok=True)
    args = [python, *(python_args or []), "-W", "ignore::FutureWarning", runner,
            "--mode", "folder", "--input", frames_dir, "--output", masks_dir,
            "--model_id", model_id]
    if local_only:
        args.append("--local_files_only")

    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    stop = threading.Event()

    # birefnet-runner.py reports its own start and finish but not per-frame
    # counts, so progress comes from the output directory filling up - the
    # same signal the desktop polls.
    def watch():
        while not stop.wait(1.0):
            try:
                done = len([n for n in os.listdir(masks_dir) if n.endswith(".png")])
            except OSError:
                continue
            progress(20 + int(60 * done / max(1, total)), "AI 分割中… %d/%d" % (done, total))

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    out, err = child.communicate()
    stop.set()
    watcher.join(timeout=2)

    if child.returncode != 0:
        tail = (err or out or "").strip()[-520:]
        fail("BiRefNet 运行失败：%s" % (tail or ("退出码 %s" % child.returncode)))


def pack_masks(masks_dir, names, width, height, out_path):
    """One file: u32 index, u32 length, deflate(width*height alpha bytes)."""
    from PIL import Image

    stride = width * height
    written = 0
    with open(out_path, "wb") as handle:
        for index, name in enumerate(names):
            path = os.path.join(masks_dir, name)
            if not os.path.exists(path):
                fail("第 %d 帧没有生成遮罩" % index)
            with Image.open(path) as source:
                alpha = source.convert("RGBA").getchannel("A")
                if alpha.size != (width, height):
                    fail("第 %d 帧遮罩尺寸异常" % index)
                raw = alpha.tobytes()
            if len(raw) != stride:
                fail("第 %d 帧遮罩长度异常：%d ≠ %d" % (index, len(raw), stride))
            block = zlib.compress(raw, 6)
            handle.write(struct.pack("<II", index, len(block)))
            handle.write(block)
            written += 1
            if index % 25 == 0:
                progress(82 + int(8 * index / max(1, len(names))), "正在打包遮罩… %d/%d" % (index + 1, len(names)))
    return written


def encode_webm(masks_dir, names, fps, out_path):
    """VP9 with alpha, the same encode the desktop writes.

    Optional by design: the panel requires the mattes and only reads a video
    if one is offered, so a machine without a usable ffmpeg still completes
    the job.
    """
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as error:  # noqa: BLE001 - any import/lookup failure is the same answer
        emit("note", message="跳过 WebM 编码：找不到 ffmpeg（%s）" % str(error)[:160])
        return None

    listing = os.path.join(masks_dir, "frames.txt")
    with open(listing, "w", encoding="utf-8") as handle:
        for name in names:
            handle.write("file '%s'\n" % name.replace("'", "'\\''"))
            handle.write("duration %.6f\n" % (1.0 / max(1.0, float(fps or 24))))

    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-i", listing,
            "-vf", "format=yuva420p",
            "-c:v", "libvpx-vp9", "-row-mt", "1", "-threads", "4",
            "-auto-alt-ref", "0", "-pix_fmt", "yuva420p",
            "-metadata:s:v:0", "alpha_mode=1", "-b:v", "0", "-crf", "30",
            out_path]
    done = subprocess.run(args, cwd=masks_dir, capture_output=True, text=True)
    if done.returncode != 0:
        emit("note", message="WebM 编码失败，已跳过：%s" % (done.stderr or "")[-240:])
        return None
    return os.path.basename(out_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    args = parser.parse_args()

    with open(args.job, "r", encoding="utf-8") as handle:
        job = json.load(handle)

    width = int(job.get("width") or 0)
    height = int(job.get("height") or 0)
    if not width or not height:
        fail("任务没有提供画面尺寸")

    count = int(job.get("frame_count") or 0)
    if job.get("input_encoding") != "png-frames-v1" or not 1 <= count <= 300:
        fail("视频帧任务格式无效")

    work_dir = job["work_dir"]
    out_dir = job["out_dir"]
    frames_dir = os.path.join(work_dir, "matting-in")
    masks_dir = os.path.join(work_dir, "matting-out")
    stem = os.path.basename(work_dir)[:8] or "job"

    started = time.perf_counter()
    progress(10, "正在读取浏览器捕获帧 %d" % count)
    names = unpack_frames(job.get("frame_packs") or [], frames_dir, width, height, count)
    emit("decoded", frames=len(names), source="renderer-png")

    progress(20, "正在加载 BiRefNet")
    run_birefnet(job["runner"], job.get("inference_python") or sys.executable,
                 job.get("inference_python_args") or [],
                 frames_dir, masks_dir, job.get("model_id"),
                 bool(job.get("local_files_only")), len(names))

    progress(82, "正在打包遮罩")
    mask_name = "mask-%s.bin" % stem
    pack_masks(masks_dir, names, width, height, os.path.join(out_dir, mask_name))
    files = [mask_name]

    if not job.get("return_mask_only", True):
        progress(92, "正在编码 WebM")
        webm = encode_webm(masks_dir, names, job.get("fps"), os.path.join(out_dir, "cutout-%s.webm" % stem))
        if webm:
            files.append(webm)

    with open(os.path.join(out_dir, "matting-result.json"), "w", encoding="utf-8") as handle:
        json.dump({"files": files, "frames": len(names), "width": width, "height": height}, handle)

    progress(99, "抠图完成")
    emit("result", ok=True, files=files, seconds=round(time.perf_counter() - started, 2))


if __name__ == "__main__":
    main()
