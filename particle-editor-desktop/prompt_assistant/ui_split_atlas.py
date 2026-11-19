"""Generate UI assets in separate atlas cells, then register them in source coordinates."""
import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .ui_layer_split import Comfy, SplitError, _png, normalize_regions

BATCH = 6
METHOD = "qwen21-rgba-atlas-v1"


def generate(comfy, reference, prompt, seed):
    # The native Qwen image VAE returns alpha when asked for a transparent image.
    scale = math.sqrt(1100000 / (reference.width * reference.height))
    width, height = (max(64, 32 * round(n * scale / 32)) for n in reference.size)
    graph = json.loads(Path(__file__).with_name("ui_split_qwen21.json").read_bytes())
    graph["100"]["inputs"]["image"] = comfy.upload(reference, "ui_reference")
    graph["200"]["inputs"].update(width=width, height=height)
    graph["5"]["inputs"]["prompt"] = prompt + "。严格保持原图的物体位置、比例、姿势、相机取景和透视。"
    graph["7"]["inputs"]["noise_seed"] = seed
    graph["9"]["inputs"].update(width=reference.width, height=reference.height)
    return comfy.result(comfy.queue(graph), "10", mode=None)


def description(row, rows):
    left, top, right, bottom = row["box"]
    children = [other["name"] for other in rows if other is not row and
                (other["parent"] == row["id"] or (row["kind"] == "panel" and
                 left <= other["box"][0] and top <= other["box"][1] and
                 right >= other["box"][2] and bottom >= other["box"][3] and other["box"] != row["box"]))]
    label = row["name"]
    if row["text"]:
        label += "，原字样「" + row["text"] + "」"
    if children:
        label += "。独立绘制完整底层，移除其上的" + "、".join(children) + "并补全遮挡部分"
    return label


def sprites(comfy, source, batch, seed, isolated=None):
    cols = math.ceil(math.sqrt(len(batch)))
    rows = math.ceil(len(batch) / cols)
    ratios = [(r["box"][2] - r["box"][0]) / (r["box"][3] - r["box"][1]) for r in batch]
    ratio = float(np.clip(np.median(ratios), .25, 6))
    cell_w, cell_h = round(384 * math.sqrt(ratio)), round(384 / math.sqrt(ratio))
    atlas = Image.new("RGB", (cols * cell_w, rows * cell_h), "#999999")
    for index, row in enumerate(batch):
        crop = source.crop(row["box"])
        if isolated is not None and row["kind"] != "prop":
            separated = isolated.crop(row["box"])
            matte = separated.getchannel("A")
            values = np.asarray(matte)
            solid = values > 210
            if solid.mean() > .10 and (values < 30).mean() > .08:
                rgb = np.asarray(separated.convert("RGB"), np.float32)
                difference = np.abs(rgb[solid] - np.asarray(crop)[solid]).mean()
                if difference < 30:
                    crop = Image.composite(crop, Image.new("RGB", crop.size, "#999999"), matte)
        scale = .82 * min(cell_w / crop.width, cell_h / crop.height)
        crop = crop.resize(tuple(max(1, round(v * scale)) for v in crop.size), Image.Resampling.LANCZOS)
        atlas.paste(crop, (index % cols * cell_w + (cell_w - crop.width) // 2,
                           index // cols * cell_h + (cell_h - crop.height) // 2))
    prompt = (f"把参考图逐格生成为透明通道的独立游戏素材图集，保持原图{rows}行{cols}列布局。"
              "每格只保留指定对象，位置、大小、轮廓比例、色彩、文字、边框造型与原图一致。"
              "保留角色配件、细节和半透明材质。补齐被遮住的部位，"
              "去掉每个对象周围的截图背景、格子和相邻物体。格间留透明空隙。按从左到右顺序："
              + "；".join(r["description"] for r in batch))
    result = generate(comfy, atlas, prompt, seed)
    if "A" not in result.getbands():
        return [None] * len(batch)
    result = result.convert("RGBA")
    cells = []
    for index in range(len(batch)):
        x, y = index % cols, index // cols
        tile = result.crop((x * result.width // cols, y * result.height // rows,
                            (x + 1) * result.width // cols, (y + 1) * result.height // rows))
        alpha = tile.getchannel("A")
        values = np.asarray(alpha)
        if (values < 12).mean() < .025 or (values > 40).sum() < 12:
            cells.append(None)
            continue
        bounds = alpha.point(lambda a: 255 if a >= 8 else 0).getbbox()
        cells.append(tile.crop(bounds))
    return cells


def register(sprite, crop):
    """Fit the generated silhouette against visible reference pixels at native resolution."""
    source = np.asarray(crop.convert("RGB"))
    width, height = crop.size
    best = None
    for scale in (1., .96, .90, .83, .75, .65):
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        tile = sprite.resize(size, Image.Resampling.LANCZOS)
        pixels = np.asarray(tile)
        mask = np.uint8(pixels[:, :, 3] > 160)
        if mask.sum() < 12:
            continue
        errors = cv2.matchTemplate(source, pixels[:, :, :3].copy(), cv2.TM_SQDIFF, mask=mask)
        error, _, offset, _ = cv2.minMaxLoc(errors)
        score = math.sqrt(max(0, error) / (3 * mask.sum())) + (1 - scale) * 5
        if best is None or score < best[0]:
            best = (score, offset, tile)
    if best is None:
        return (0, 0), sprite.resize(crop.size, Image.Resampling.LANCZOS)
    return best[1], best[2]


def single_instance(tile):
    alpha = np.asarray(tile.getchannel("A"))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(np.uint8(alpha > 48))
    if count < 4:
        return tile
    largest = np.max(stats[1:, 4])
    major = [s for s in stats[1:] if s[4] > largest * .65]
    if len(major) < 3 or sum(s[4] for s in major) < (alpha > 48).sum() * .85:
        return tile
    samples = []
    for x, y, w, h, area in major:
        sample = tile.crop((x, y, x+w, y+h))
        samples.append(np.asarray(sample.resize((24, 24)), np.float32))
    if np.mean([np.abs(sample - samples[0]).mean() for sample in samples[1:]]) > 27:
        return tile
    x, y, w, h, _ = max(major, key=lambda s: s[4])
    return tile.crop((max(0, x-2), max(0, y-2), min(tile.width, x+w+2), min(tile.height, y+h+2)))


def panel_paint(comfy, source, row, rows, silhouette, seed):
    l, t, r, b = row["box"]
    crop = source.crop(row["box"])
    children = [c for c in rows if c is not row and l <= c["box"][0] and t <= c["box"][1]
                and r >= c["box"][2] and b >= c["box"][3] and c["box"] != row["box"]]
    if not children or any(word in row["name"].lower() for word in ("translucent", "glass", "transparent", "半透", "玻璃", "镂空")):
        return silhouette
    guide_mask = np.zeros((crop.height, crop.width), np.uint8)
    for c in children:
        x0, y0, x1, y1 = c["box"]
        guide_mask[y0-t:y1-t, x0-l:x1-l] = 255
    donor = generate(comfy, crop, "这是单独的界面底板。删除前景符号、图标和文字，露出它们遮住的底面。"
                     "必须保留整块底面、边框、铆钉、材质、阴影和原来的尺寸。把空白底板画满原画布。"
                     + row["name"], seed).convert("RGB").resize(crop.size, Image.Resampling.LANCZOS)
    mask = cv2.GaussianBlur(cv2.dilate(guide_mask, np.ones((5, 5), np.uint8)), (0, 0), 1)
    paint = Image.composite(donor, crop, Image.fromarray(mask)).convert("RGBA")
    alpha = np.array(silhouette.getchannel("A"))
    # A reel board is the physical backing beneath its symbols. A model can
    # return just the frame or the symbols when asked for its silhouette.
    # Reconstruct the continuous interior from the confirmed board bounds.
    board = any(term in row["name"].casefold() for term in
                ("reel board", "reel panel", "reel grid", "转轴面板", "转轴底板", "卷轴面板", "棋盘"))
    if board:
        yy, xx = np.ogrid[:crop.height, :crop.width]
        radius = max(1, round(min(crop.size) * .035))
        dx = np.maximum(np.maximum(radius - xx, xx - (crop.width - 1 - radius)), 0)
        dy = np.maximum(np.maximum(radius - yy, yy - (crop.height - 1 - radius)), 0)
        coverage = np.clip(radius + .5 - np.hypot(dx, dy), 0, 1)
        alpha = np.maximum(alpha, np.uint8(coverage * 255))
    contours, _ = cv2.findContours(np.uint8(alpha > 56), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        outline = max(contours, key=cv2.contourArea)
        if cv2.contourArea(outline) > .45 * alpha.size:
            solid = np.zeros_like(alpha)
            cv2.drawContours(solid, [outline], -1, 255, cv2.FILLED)
            alpha = np.maximum(alpha, cv2.GaussianBlur(solid, (0, 0), .65))
    paint.putalpha(Image.fromarray(alpha))
    return paint


def scene_background(comfy, source, rows, seed, scene):
    rgb = np.asarray(source)
    height, width = rgb.shape[:2]
    mask = np.zeros((height, width), np.uint8)
    for row in rows:
        l, t, r, b = row["box"]
        mask[t:b, l:r] = 255
    # Solid and gradient UI canvases can be recovered from visible samples.
    # Accept the fitted paint only when it also predicts held-out pixels.
    yy, xx = np.indices(mask.shape, dtype=np.float32)
    step = max(1, math.ceil(max(width, height) / 180))
    yy, xx = yy[::step, ::step], xx[::step, ::step]
    valid = mask[::step, ::step] == 0
    points = np.column_stack((xx[valid]/width, yy[valid]/height, np.ones(valid.sum())))
    samples = rgb[::step, ::step][valid]
    if len(samples) >= 40:
        train = np.arange(len(points)) % 3 != 0
        coeff, _, rank, _ = np.linalg.lstsq(points[train], samples[train], rcond=None)
        if rank == 3 and np.quantile(abs(points[~train] @ coeff - samples[~train]), .995) < 2:
            x = np.arange(width, dtype=np.float32)[None, :, None] / width
            y = np.arange(height, dtype=np.float32)[:, None, None] / height
            fill = np.uint8(np.clip(np.rint(x * coeff[0] + y * coeff[1] + coeff[2]), 0, 255))
            return Image.composite(Image.fromarray(fill), source, Image.fromarray(mask))
    donor = generate(comfy, source, "把图中这些前景都去掉，只保留其后的完整场景背景：" +
                     "、".join(r["name"] for r in rows) + "。背景场景：" + scene +
                     "。填补遮挡区域。保持其余原图构图和光照。", seed)
    alpha_ok = "A" not in donor.getbands() or np.percentile(np.asarray(donor.getchannel("A")), 1) >= 250
    donor = donor.convert("RGB").resize(source.size, Image.Resampling.LANCZOS)
    edges = cv2.Canny(rgb, 70, 140) > 0
    donor_edges = cv2.dilate(cv2.Canny(np.asarray(donor), 70, 140), np.ones((3, 3), np.uint8))
    retained = False
    for row in rows:
        l, t, r, b = row["box"]
        strokes = edges[t:b, l:r]
        if strokes.sum() >= 24 and (donor_edges[t:b, l:r][strokes] > 0).mean() > .72:
            retained = True
            break
    large_panel = any(row["kind"] == "panel" and
                      (row["box"][2]-row["box"][0]) * (row["box"][3]-row["box"][1]) > .20*width*height
                      for row in rows)
    if not alpha_ok or retained or large_panel:
        # Remove the misleading visual reference before a second generative pass.
        # The coarse guide is conditioning only; it is never exported as finished art.
        size = tuple(max(8, round(v * min(1, 180 / max(source.size)))) for v in source.size)
        guide_mask = cv2.resize(mask, size, interpolation=cv2.INTER_AREA)
        guide_rgb = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
        guide_rgb = cv2.inpaint(guide_rgb, np.uint8(guide_mask > 0), 3, cv2.INPAINT_TELEA)
        guide = Image.composite(Image.fromarray(guide_rgb).resize(source.size, Image.Resampling.BICUBIC),
                                source, Image.fromarray(mask))
        donor = generate(comfy, guide, "根据现有场景，把遮挡留下的平涂区域绘制为完整的场景背景。" +
                         scene + "。沿现有建筑轮廓、透视、照明和纹理延伸。只画场景，不添加游戏物件或新面板。"
                         "保持整体比例、机位和光线。输出完整不透明场景插画。", seed + 311)
        if "A" in donor.getbands() and np.percentile(np.asarray(donor.getchannel("A")), 1) < 225:
            raise SplitError("背景补全返回了透明空洞，请调整背景描述后重试")
        donor = donor.convert("RGB").resize(source.size, Image.Resampling.LANCZOS)
    blend = cv2.GaussianBlur(cv2.dilate(mask, np.ones((5, 5), np.uint8)), (0, 0), 1.)
    return Image.composite(donor, source, Image.fromarray(blend))


def align_visible_edges(tile, observed, backdrop):
    """Refine donor geometry without resampling the source or hardening soft alpha."""
    rgba = np.asarray(tile, np.float32)
    if min(tile.size) < 16:
        return tile
    alpha = rgba[:, :, 3:] / 255
    premultiplied = np.dstack((rgba[:, :, :3] * alpha, rgba[:, :, 3]))
    preview = np.uint8(np.clip(premultiplied[:, :, :3] + backdrop * (1 - alpha), 0, 255))
    gray = lambda rgb: cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    flow = cv2.calcOpticalFlowFarneback(gray(observed), gray(preview), None, .5, 3, 15, 3, 5, 1.1, 0)
    flow = np.clip(cv2.GaussianBlur(flow, (0, 0), .8), -4, 4)
    yy, xx = np.indices(alpha.shape[:2], dtype=np.float32)
    warped = cv2.remap(premultiplied, xx + flow[:, :, 0], yy + flow[:, :, 1], cv2.INTER_LINEAR)
    warped_alpha = warped[:, :, 3:] / 255
    after = warped[:, :, :3] + backdrop * (1 - warped_alpha)
    if np.abs(after - observed).mean() >= np.abs(preview.astype(float) - observed).mean():
        return tile
    warped[:, :, :3] /= np.maximum(warped_alpha, 1 / 255)
    return Image.fromarray(np.uint8(np.clip(warped, 0, 255).round()))


def split_generated(image, regions, comfy_url, seed=None, progress=None, scene=""):
    source = image.convert("RGB")
    width, height = source.size
    rows = normalize_regions(regions, width, height)
    if len(rows) != sum(r.get("kind") != "group" for r in regions):
        raise SplitError("选区重复、过小或类型无效，请检查识别框")
    for row in rows:
        row["box"] = tuple(int(v) for v in (math.floor(row["box"][0]), math.floor(row["box"][1]),
                                           math.ceil(row["box"][2]), math.ceil(row["box"][3])))
    for row in rows:
        row["description"] = description(row, rows)
    def stack(row):
        l, t, r, b = row["box"]
        is_shadow = any(s in row["name"].lower() for s in ("shadow", "reflection", "投影", "倒影"))
        return ("prop panel element text".split().index(row["kind"]), not is_shadow, -(r-l)*(b-t))
    rows.sort(key=stack)
    # A shadow or a foreground prop on a panel has to be emitted above its parent.
    ordered, emitted = [], set()
    pending = {row["id"]: row for row in rows}
    def emit(row, visiting):
        if row["id"] in emitted:
            return
        if row["id"] in visiting:
            raise SplitError("素材之间存在循环父子关系，请检查选区分组")
        if row["parent"] in pending:
            emit(pending[row["parent"]], visiting | {row["id"]})
        ordered.append(row)
        emitted.add(row["id"])
    for row in rows:
        emit(row, set())
    rows = ordered
    started = time.monotonic()
    seed = int(seed if seed is not None else time.time()) % (2 ** 31)
    comfy = Comfy(comfy_url)
    if progress:
        progress("生成独立背景，补全选区背后的场景")
    plate = scene_background(comfy, source, rows, seed, scene)
    background_time = time.monotonic() - started
    isolated = None
    if len(rows) > BATCH:
        if progress:
            progress("按整图原位置分离 UI，校准透明素材参考")
        reference = generate(comfy, source, "把场景背景和角色去掉改成透明通道，只保留所有原位的UI、"
                             "控件、带框图标、文字和按钮。保留原图位置、尺寸、轮廓和半透明材质。", seed + 997)
        if "A" in reference.getbands():
            isolated = reference.convert("RGBA").resize(source.size, Image.Resampling.LANCZOS)
    buckets = {}
    for row in rows:
        l, t, r, b = row["box"]
        ratio = (r - l) / (b - t)
        shape = "wide" if ratio > 2 else "tall" if ratio < .5 else "square"
        buckets.setdefault((row["kind"], shape), []).append(row)
    batches = [items[start:start + BATCH] for items in buckets.values() for start in range(0, len(items), BATCH)]
    placements = {}
    for number, batch in enumerate(batches, 1):
        if progress:
            progress(f"生成透明图集 {number}/{len(batches)}")
        tiles = sprites(comfy, source, batch, seed + number, isolated)
        for i, (row, tile) in enumerate(zip(batch, tiles)):
            if tile is None:
                tile = sprites(comfy, source, [row], seed + len(batches) + number * BATCH + i)[0]
            if tile is None:
                raise SplitError("未生成有效透明素材：" + row["name"] + "，请调整该选区后重试")
            box = row["box"]
            if row["kind"] == "panel":
                dx, dy = 0, 0
                tile = tile.resize((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
                tile = panel_paint(comfy, source, row, rows, tile, seed + 500 + number * BATCH + i)
            else:
                if row["kind"] == "element" and not any(s in row["name"].lower() for s in ("pile", "cluster", "堆", "簇")):
                    tile = single_instance(tile)
                (dx, dy), tile = register(tile, source.crop(box))
            x, y = box[0] + dx, box[1] + dy
            placements[row["id"]] = (x, y, tile)
    layers = [dict(id="background", name="背景", group="background", x=0, y=0,
                   width=width, height=height, png=_png(np.asarray(plate)))]
    underlay = plate.convert("RGBA")
    for row in rows:
        x, y, tile = placements[row["id"]]
        bounds = (x, y, x + tile.width, y + tile.height)
        if row["kind"] != "panel":
            tile = align_visible_edges(tile, np.asarray(source.crop(bounds)), np.asarray(underlay.crop(bounds).convert("RGB")))
            placements[row["id"]] = x, y, tile
        underlay.alpha_composite(tile, (x, y))
    # Retain generated paint under occlusions. Restore the observed finish only
    # inside solid, colour-matched, visible material, without baking in children.
    above = np.zeros((height, width), np.uint8)
    source_rgb = np.asarray(source)
    assets = []
    for row in reversed(rows):
        x, y, tile = placements[row["id"]]
        rgba = np.array(tile)
        # VAE noise outside the antialiased contour can carry saturated RGB.
        alpha = rgba[:, :, 3]
        alpha[alpha < 5] = 0
        rgba[alpha == 0] = 0
        h, w = rgba.shape[:2]
        rect = np.s_[y:y+h, x:x+w]
        observed = source_rgb[rect]
        delta = np.max(np.abs(rgba[:, :, :3].astype(np.int16) - observed), axis=2)
        weight = (np.clip((85. - delta) / 40., 0, 1) * (rgba[:, :, 3] / 255.) ** 4
                  * (1 - above[rect] / 255.))[:, :, None]
        if row["kind"] == "panel":
            # Keep original bevels and paint, including unselected artwork attached to the panel.
            # Only selected children expose a reconstructed underpaint when moved.
            visible = np.ones((h, w), np.float32)
            for child in rows:
                if child is row:
                    continue
                l, t, r, b = child["box"]
                if x <= l and y <= t and r <= x+w and b <= y+h:
                    visible[t-y:b-y, l-x:r-x] = 0
            weight = np.maximum(weight, (visible * (rgba[:, :, 3] / 255.) ** 3
                                         * (1 - above[rect] / 255.))[:, :, None])
        rgba[:, :, :3] = np.rint(observed * weight + rgba[:, :, :3] * (1 - weight)).astype(np.uint8)
        np.maximum(above[rect], rgba[:, :, 3], out=above[rect])
        assets.append(dict(id=row["id"], name=row["name"], group=row["kind"], parentId=row["parent"],
                           text=row["text"], x=x, y=y, width=w, height=h, png=_png(rgba)))
    layers.extend(reversed(assets))
    return dict(width=width, height=height, seed=seed, method=METHOD, layers=layers,
                timing={"background": round(background_time, 2), "total": round(time.monotonic() - started, 2)})
