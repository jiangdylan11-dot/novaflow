# 代码保护（防泄露 / 防破解）

分三层，越往后越彻底。第一、二层已实现。

## 第一层：发布时整体混淆（已生效，无需额外操作）

打正式包时（`npm run package:site`、`npm run worker:build`）自动对网页里**全部
自有脚本**做混淆：去掉全部注释、打乱变量名和函数名、压缩（约 12.5MB→7.2MB）。
开发构建（`build:renderer` / `sync:runtime`）不混淆，保持可读便于调试。

- 混淆器：`tools/minify-web-dist.mjs`，不动属性名/顶层名/文件名，不动第三方 vendor。
- 单文件失败只保留原文件并告警，不会中断发布。

## 第二层：登录才下发代码（已实现，需在 Cloudflare 开启一次）

公开网址只放登录壳（`index.html` + 登录所需的 runtime/account 脚本 + 主题 CSS +
logo）。其余所有代码、React 包、worker、wasm、模型和模板数据，**只有登录后、浏览器
带着有效会话 cookie 时才发**。没登录的人（竞争对手、路人）打开网址只拿到登录页，
**一个功能文件都下载不到**。

实现方式：Cloudflare Pages 高级模式的 `deploy/_worker.js`。它随站点 zip 一起上传
（打包时自动复制到 zip 根目录），**你的上传流程完全不变**。它在边缘用和后端相同的
算法（`packages/shared/src/tokens.mjs`）验证 `nfs_` 会话 token，验不过就对受保护
文件返回 403。网页端 `novaflow-web-runtime.js` 在登录/退出时把 token 同步进
`nf_sess` cookie（脚本和 worker 请求带不了 Authorization 头，但会带同源 cookie）。

更细的校验（会话是否被挤下线、账号是否停用/到期）仍在控制面每次 API 调用时执行；
cookie 只决定"能不能下载代码"。

### 开启（一次性）

1. 正常 `npm run package:site ...` 打包，照常把 zip 传到 Cloudflare Pages。
   （zip 里已含 `_worker.js`。只传不设密钥 = 网关不生效，站点照常开放，不会打不开。）
2. Cloudflare 后台 → 该 Pages 项目 → Settings → Environment variables，新增：
   - `NOVAFLOW_SESSION_SECRET` = 和 Supabase 边缘函数里**同一个**
     `NOVAFLOW_SESSION_SECRET` 值（即签发登录 token 用的密钥）。
3. 重新部署（或触发一次构建）使环境变量生效。此后网关开启。

关闭：删掉该环境变量并重新部署即可恢复开放。

### 注意

- 过渡期：设密钥前已登录的用户，其 cookie/token 最长 24 小时有效；期间照常。
- 启动助手（本机运行）代码本就装在用户电脑里，第二层对它作用有限；靠第一层混淆
  加第三层上服务器，以及"安装包只发给客户"来保护。

## 第三层：核心算法上服务器（待做）

把"点一下算一次"的算法（自动骨架/蒙皮/权重、各类计算、特效扫光、视频抠图流程）
移到边缘函数或算力节点计算，只回结果，用户**永远拿不到算法本身**。实时拖动的编辑器
（骨骼拖动、帧编辑画笔、粒子预览）留本地，由前两层保护。服务器往返实测约 0.3 秒，
一次性计算可接受。
