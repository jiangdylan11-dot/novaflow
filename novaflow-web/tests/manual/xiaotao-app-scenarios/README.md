# 小桃全软件调用场景测试（手动）

Loads the real Foart site build (web-dist/editor.html) in headless Chromium and lets 小桃 drive it.
Only the backend is fake: the planner replies are scripted the way an online model (DeepSeek / 豆包) answers
`nf.foart.tool-plan.v1`, and each plan goes through the server's own `readFoartPlan` before 小桃 sees it.
The prompt optimizer, uploads and compute stop at a stub. Everything between them (小桃's controller,
Foart tools, page capture, native fields, mode switches, uploads, receipts) is the real code.

    # copy the changed renderer/*.js into a web-dist copy, then serve it (big vendor models are not needed)
    python -m http.server 4893 -d <web-dist copy>
    cd novaflow-web/tests/manual/xiaotao-app-scenarios
    sh mkassets.sh                      # test picture, clip, tone (needs ffmpeg)
    node mkcfg.mjs > cfg.json
    node run.cjs                        # scenarios.cjs (美工)
    SC=./scen-media.cjs node run.cjs    # 视频 / 音频
    SC=./scen-misc.cjs node run.cjs     # 反推 / 追问回答 / 工具 / 特效
    SC=./scen-multi.cjs node run.cjs    # 多步任务 / 改图
    SC=./scen-more.cjs node run.cjs     # 动画 / UI / 画布 / 粒子 / JPG
    SC=./scen-edit.cjs node run.cjs     # 抠图 / 扩图 / 拆图 / 角度 / 局部编辑 / 视频剪辑 / 音频编辑
    SC=./scen-rest.cjs node run.cjs     # 切开变速 / 帧编辑 / MP4 / 格式转换 / 去黑 / 姿势 / 万物迁移 / AI 特效 / 序列导出
    SC=./scen-video-submit.cjs node run.cjs  # 附图的视频生成请求：图生视频 + 直接提交；"继续生成" 不重写提示词
    node run.cjs count3                 # one scenario by name

FOART_URL overrides the page (default http://localhost:4893/editor.html); FOART_SHARED points at
packages/shared/src/foart-tool-plan.mjs when the folder is not next to this repo.

Needs `playwright` with a Chromium. A scenario that stops at the real generation call
("未找到 MiniMax H3 Runtime", "音频算力接口尚未就绪", "当前无可用生图节点", ffmpeg 组件 not bundled in the test copy)
counts as a pass: everything before compute ran.
