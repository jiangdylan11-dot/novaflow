NovaFlow AI Runtime

这是 NovaFlow 唯一需要安装的 AI 运行环境（ComfyUI 0.37，端口 8188）。
生图、美工（扩图 / 局部编辑 / 智能补图 / 角度调整 / 万物迁移 / 拆图 / 抠图 / 放大 / 去除物体）
和视频（AI 序列动画 / AI 特效，MiniMax H3）都在这一个环境里运行，不再需要单独的 H3 视频环境。

安装：
1. 先退出 NovaFlow。
2. 双击 setup.exe。
3. Runtime 目录保持默认，或自选。
4. 资源目录（放模型和插件的地方）保持默认，或自选。
5. 点击安装。

默认位置：
- Runtime：C:\ProgramData\NovaFlow\AI-Runtime
- 资源目录：D:\NovaFlow（没有 D 盘时为 C:\ProgramData\NovaFlow）

安装包已经自带：
- Python 3.12 + PyTorch 2.10（CUDA 13）+ ComfyUI 0.37；
- 所有需要的插件（custom_nodes），安装时自动放进资源目录的 custom_nodes，
  包括 Qwen-Image-2.1 用的 GGUF 加载器、抠图、拆图、放大、H3 视频插件等；
- H3 视频加速依赖（SageAttention、Triton）。

模型不在安装包里，需要另外放入资源目录下的 models 文件夹。
需要哪些文件、放在哪个子目录、各自用于什么功能，见同目录的 MODELS.txt。
Qwen-Image-2.1 的三个文件是必需的：扩图、局部编辑、智能补图、角度调整、绘图都只用 2.1，
缺少时这些功能会直接提示"缺少 Qwen-Image-2.1 所需的模型"。

升级已有的 Runtime：
- 先退出 NovaFlow。setup.exe 会把旧的 engine 挪到 engine.previous，再装新的；
  想退回旧版时，删掉 engine，把 engine.previous 改名为 engine 即可。
- 资源目录里已有的模型和你自己加的插件不会被删除。

以前装过单独的 H3 视频环境（C:\ProgramData\NovaFlow\AI-Runtime-H3）的，装完新版 NovaFlow 助手后
可以删除那个文件夹；它和这个环境共用同一批模型，删了不会丢模型。

安装后由 NovaFlow 自动启动和管理 Runtime，不需要手动启动。
