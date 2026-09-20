# 美工 · 绘图 教程录制器

驱动真实运行时录屏，不是截图拼接：用 Electron 打开 `http://127.0.0.1:4783/`，
通过 CDP `Page.startScreencast` 抓每一帧，页面上叠一层演示光标 + 字幕，
最后用 Runtime 自带的 ffmpeg 合成 MP4。生成等待按标记区间加速。

## 前置

- 4783 预览服务在跑（`npm run dev`）。
- ComfyUI 运行时在线（`http://127.0.0.1:8188`），否则录到的是失败提示。
- 演示素材已放在预览服务根目录下的 `tutorial-assets/`：
  `demo-scene.png`（含机器人的场景）、`demo-plate.png`（干净底图）、`demo-object.png`（参考物）。

## 录一条

```bash
particle-editor-desktop/node_modules/electron/dist/electron.exe tools/tutorial --scenario=cutout
```

输出 `docs/tutorials/<scenario>.mp4`。常用开关：

| 开关 | 作用 |
| --- | --- |
| `--scenario=<name>` | `scenarios/` 下的文件名，必填 |
| `--width` / `--height` | 录制窗口尺寸，默认 1440×900 |
| `--out=<dir>` | 输出目录，默认 `docs/tutorials` |
| `--keep-frames` | 保留中间帧，便于排查 |
| `--no-encode` | 只抓帧不合成 |

## 生成教程页

```bash
node tools/tutorial/build-index.js
```

读 `catalog.js`（功能说明、步骤、坑），扫描目录里已有的 MP4，
写出 `docs/tutorials/index.html`。没录到的功能仍然会显示文字部分。

本地预览：`.claude/launch.json` 里的 `novaflow-tutorials`（端口 4788）。

## 写一个新场景

`scenarios/<id>.js` 导出 `{ id, name, desc, outro, run(t) }`，`_common.js` 提供公共步骤。

```js
const C = require('./_common');
module.exports = {
  id: 'upscale', name: '高清放大', desc: '…', outro: '…',
  async run(t) {
    await C.enterArtDraw(t);
    await C.openGroup(t, '增强');
    await C.loadDemo(t);
    await C.clickAction(t, 'imageUpscale');   // 按 action id 点，别按文字
    await C.waitForRun(t, { timeout: 600000 });
  }
};
```

`t` 的常用方法：`say(主字幕, 副字幕)`、`step(角标)`、`clickAction`、`clickText`、
`clickSel`、`drag(点集)`、`type`、`waitFor`、`spot(矩形)`、`ffStart/ffEnd`、`loadImage`。

### 两个已经踩过的坑

- **别用按钮文字定位。** 工具按钮的文字会随状态变（`智能抠图` → `执行抠图` → `智能抠图中…`）。
  用 `C.clickAction(t, 'cutout')`，它按运行时自带的 `data-novaflow-spine-split-control-action` 取元素。
- **别用各自的"处理中"文案判断忙碌。** 每个工具措辞不同（`局部编辑处理中...` / `正在执行万物迁移...`）。
  `C.BUSY_PROBE` 统一看进度弹窗里的 `已用时`，外加按钮尾部的 `…中`。
