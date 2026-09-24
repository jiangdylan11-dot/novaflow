NovaFlow AI Runtime

Install:
1. Double-click setup.exe.
2. Keep the default Runtime directory, or choose another directory.
3. Keep the default assets directory, or choose another directory.
4. Click Install.

Defaults:
- Runtime: C:\ProgramData\NovaFlow\AI-Runtime
- Assets: D:\NovaFlow

Assets:
- Put checkpoint models in models\checkpoints.
- Put LoRA models in models\loras.
- Put VAE models in models\vae.
- Put ControlNet models in models\controlnet.
- Put rembg models in models\rembg.
- Put custom nodes in custom_nodes.

Updating an existing Runtime:
- Quit NovaFlow first. setup.exe moves the installed engine to engine.previous and installs the new
  one; to go back, delete engine and rename engine.previous to engine.

Qwen-Image-2.1 (drawing and UI design):
- This Runtime (ComfyUI 0.37) runs Qwen-Image-2.1. It also needs the separate
  NovaFlow-Qwen21-Assets pack: extract it into the assets directory (the one chosen above), so that
  custom_nodes\ComfyUI-GGUF-leejet and the three model files under models\ are in place.
- Without that pack NovaFlow keeps the earlier drawing and UI routes.

NovaFlow will manage the Runtime after installation. You do not need to start the Runtime manually.
