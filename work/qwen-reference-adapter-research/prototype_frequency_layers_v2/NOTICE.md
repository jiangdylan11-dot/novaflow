# Attribution and boundaries

- New layer-window code and CPU tests are self-authored NovaFlow work prototypes (2026). Local helper code is copied from our own `prototype_frequency_keys`; `ORIGIN.json` records those exact original source hashes. No Eric, Capitan or other candidate-node implementation is copied.
- The inherited spatial K-amplitude idea was motivated by **Untwisting RoPE: Frequency Control for Shared Attention in DiTs**, Aryan Mikaeili et al., arXiv:2602.05013, equations9/10. The paper's method/model evaluation is not evidence that this Qwen2.1 adaptation or layer window is effective.
- Native ComfyUI interfaces and source are imported from the installed runtime for tests, not bundled here. That external dependency is GPL-3.0 licensed; its own copyright/license remain applicable to it. The package's MIT license covers only this self-authored prototype and copied first-party helper code, not ComfyUI, Torch, model weights, the whole NovaFlow project or third-party components.
- No paper/code reproduction or model-quality claim is made. No third-party model or package was downloaded for this task.
