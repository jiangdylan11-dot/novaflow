# Foart 笔刷品牌素材

以用户最终选定的扁平笔刷 Foart 为当前品牌：Fo 白色、art 珊瑚红 `#ff5c35`。主程序 Icon 只取 F 并使用珊瑚红；后台 Icon 和字标均为白色。软件显示名称为 **Foart / Foart 后台管理**。

- `foart-brush-reference.png`：用户提供的原始设计参考，原样保留。
- `foart-flat-wordmark-master.svg` / `foart-flat-f-master.svg`：从用户批准的设计稿转换的轮廓母版，保留字形并统一平面色。
- `foart-brush-wordmark.png` / `foart-brush-f.png`：由轮廓母版渲染的透明底兼容素材。处理记录见 `brush-provenance.json`。
- `foart-logo-dark.svg` / `foart-logo-light.svg`：深浅背景用的字标包装，嵌入透明 PNG。它们保留位图纹理，无字体依赖，并非纯矢量描边。
- `foart-mark.svg`：透明底独立 F。`foart-app-icon.svg`：深灰圆角底、橙红 F。`foart-admin-icon.svg`：同一 F 轮廓，使用 SVG 色彩矩阵输出白色，保留透明度和笔刷边缘。
- `foart-admin-logo.svg`：同一字标的全白版本，用于后台管理。
- 同名兼容 PNG 和 ICO；ICO 包含 16、24、32、48、64、96、128、256 像素。
- `foart-contact.svg`：新笔刷标题和原始二维码，二维码数据不重绘。

`node novaflow-web/tools/sync-brand-assets.mjs` 同步网页、启动助手、后台和 React 入口，`--check` 验证副本；网页和后台构建自动同步。旧资源别名继续提供当前画稿。网页资源使用笔刷修订查询参数或新图标文件名，避免命中旧图标缓存。

为了保留用户数据，原有 appId、授权载荷产品标识、`novaflow:` 协议、`.nfproj`、用户数据目录、环境变量和内部 API 不改名。
