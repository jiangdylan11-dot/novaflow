# 小桃全软件调用场景测试（手动）

Loads the real Foart page (renderer/index.html) in headless Chromium and lets 小桃 drive it.
Only the backend is fake: the planner replies are scripted the way an online model (DeepSeek / 豆包) answers
`nf.foart.tool-plan.v1`, and the prompt optimizer, uploads and compute stop at a stub.
Everything between them — 小桃's controller, Foart tools, page capture, native fields, mode switches,
uploads, receipts — is the real code.

    python -m http.server 4892 -d novaflow-web/renderer      # big vendor models are not needed
    cd novaflow-web/tests/manual/xiaotao-app-scenarios
    node mkcfg.mjs > cfg.json
    node run.cjs                        # scenarios.cjs (美工)
    SC=./scen-media.cjs node run.cjs    # 视频 / 音频
    SC=./scen-misc.cjs node run.cjs     # 反推 / 追问回答 / 工具 / 特效
    SC=./scen-multi.cjs node run.cjs    # 多步任务 / 改图
    node run.cjs count3                 # one scenario by name

Needs `playwright` with a Chromium. A video or audio scenario that stops at
"未找到 MiniMax H3 Runtime" / "音频算力接口尚未就绪" has reached the real generation call; that counts as a pass.
