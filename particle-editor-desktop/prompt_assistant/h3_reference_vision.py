"""Conservative timing observations for a stationary disc on a flat background."""
import numpy as np
from scipy.ndimage import label


def flat_background_fact(tensor):
    """Name only a visibly uniform color, never infer a physical backdrop."""
    image = tensor[0].cpu().numpy()
    border = np.concatenate((image[0], image[-1], image[:, 0], image[:, -1]))
    color = np.median(border, axis=0)
    if (np.mean(np.max(abs(border-color), axis=-1) < .06) < .99
            or np.mean(np.max(abs(image-color), axis=-1) < .06) < .4):
        return None
    if color[1] > .6 and max(color[0], color[2]) < .35:
        return '平整的纯绿色背景'
    if color[2] > .6 and max(color[0], color[1]) < .35:
        return '平整的纯蓝色背景'
    if max(color) < .08:
        return '平整的纯黑色背景'
    if min(color) > .92:
        return '平整的纯白色背景'
    return None


def disc_timing(frames, tensors):
    samples = []
    backgrounds = []
    for item, tensor in zip(frames, tensors):
        if not item['label'].startswith('<Video '):
            continue
        image = tensor[0].cpu().numpy()
        h, w = image.shape[:2]
        border = np.concatenate((image[0], image[-1], image[:, 0], image[:, -1]))
        background = np.median(border, axis=0)
        if np.mean(np.max(abs(border-background), axis=-1) < .06) < .99:
            return None
        backgrounds.append(background)
        mask = np.max(abs(image-background), axis=-1) > .12
        components, _ = label(mask)
        sizes = np.bincount(components.ravel())[1:]
        if not len(sizes) or sizes.max()/sizes.sum() < .98:
            return None
        yy, xx = np.nonzero(mask)
        if min(xx) < 2 or min(yy) < 2 or max(xx) >= w-2 or max(yy) >= h-2:
            return None
        samples.append((item['timeSeconds'], (max(xx)-min(xx)+1)/w,
                        (max(yy)-min(yy)+1)/h, (max(xx)+min(xx))/w/2,
                        (max(yy)+min(yy))/h/2, (max(xx)-min(xx)+1)/(max(yy)-min(yy)+1)))
    if len(samples) < 5:
        return None
    values = np.asarray(samples)
    widths, heights = values[:, 1], values[:, 2]
    edge = int(widths.argmin())
    if (edge in (0, len(samples)-1) or np.ptp(values[:, 3:5], axis=0).max() > .015
            or np.ptp(heights) > .025 or not .8 < values[0, 5] < 1.2
            or abs(widths[-1]-widths[0]) > .025 or widths[edge]/widths[0] > .25
            or np.any(np.diff(widths[:edge+1]) > .02) or np.any(np.diff(widths[edge:]) < -.02)):
        return None
    start, middle, end = (float(values[i, 0]) for i in (0, edge, -1))
    background = np.median(backgrounds, axis=0)
    green = (np.max(np.abs(np.asarray(backgrounds)-background)) < .04
             and background[1] > .7 and max(background[0], background[2]) < .3)
    centered = np.max(abs(values[:, 3:5]-.5)) < .05
    background_zh = '绿色纯色背景' if green else '源视频的纯色背景'
    background_en = 'green screen background' if green else 'source flat background'
    position_zh = '画面中央' if centered else '源视频中的位置'
    position_en = 'the center' if centered else 'the source position'
    return {
        'video_zh': f'在{background_zh}上旋转的圆盘状物体源视频',
        'video_en': f'source video of a spinning disc on a {background_en}',
        'zh': f'<Subject 1>在{background_zh}的{position_zh}旋转，遵循源视频的运动路径：{start:.3f}秒从正面开始，{middle:.3f}秒到达最窄侧面，{end:.3f}秒回到正面。',
        'en': f'<Subject 1> spins and flips in {position_en} of a {background_en}, following the motion path from the source video, starting face-on at {start:.3f}s, rotating to show its edge at {middle:.3f}s, and returning face-on by {end:.3f}s.'
    }
