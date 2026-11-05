# 本地 Qwen3.5 9B 能否操控 Foart（评估，非产品代码）

和 ../xiaotao-app-scenarios 同一套真实页面测试，只把"假在线模型"换成本地 9B：
同样的 FOART_TOOL_SYSTEM、同样的 currentFoart 页面数据、同样的计划格式（foartPlanResponseFormat）、
同样的服务器校验 readFoartPlan，再由真实的小桃控制器和 Foart 工具执行。产品里本地大脑仍然不调用工具。

    # 1. 启动 llama-server（同一个 GGUF；生产只开 8192 上下文，装不下工具说明，所以这里开 32768）
    llama-server -m Qwen3.5-9B-Ultra-Uncensored-Heretic-Q4_K_M.gguf -ngl 99 --ctx-size 32768 --parallel 1 --jinja --host 127.0.0.1 --port 8090
    # 2. 网页同 xiaotao-app-scenarios：web-dist 拷贝 + python -m http.server 4893，cfg.json / 测试素材在那个目录里
    # 3.
    GRAMMAR=1 node run-local.cjs     # 用 JSON schema 约束输出（最好情况）
    GRAMMAR=0 node run-local.cjs     # 不约束，只靠提示词
结果：results-*.json（每个场景）、calls-*.jsonl（每次规划调用的原始输出、耗时、token 数、校验结果）。

共 13 个场景。offtopic 由小桃的对话分流处理，不调用规划器。
GRAMMAR=1 发给 llama-server 前会去掉 media fade 那条只含 required 的 anyOf：llama.cpp 把它当成"任意值"，
整个操作项的约束都会失效。这只影响语法，readFoartPlan 的校验不变。
没有 node playwright 时：把 NODE_PATH 指向外部安装，并用 CHROME_CHANNEL=chrome 使用本机 Chrome。
