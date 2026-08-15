# NovaFlow 桌面端安装包（Electron）

这个目录用于把 `../particle-editor`（Vite + React）打包成桌面应用安装包，技术栈为 Electron + electron-builder。

## 先决条件

- Node.js（已安装）

## 安装依赖

在 `particle-editor-desktop` 目录执行：

```bash
npm install
```

## 打包（Windows EXE/NSIS）

在 Windows 上执行：

```bash
npm run build:win
```

输出目录：

- `particle-editor-desktop/dist/`（NSIS 安装包 `.exe`）

## 打包（macOS DMG）

在 macOS 上执行（macOS 的安装包产物需要在 macOS 环境生成，Windows 无法直接生成 DMG；可用 CI 在 macOS Runner 上构建）：

```bash
npm run build:mac
```

输出目录：

- `particle-editor-desktop/dist/`（`.dmg`）

## 说明

- 构建会先构建 `../particle-editor`，再把其 `dist/` 拷贝到 `particle-editor-desktop/renderer/`，最后由 electron-builder 打包生成对应平台的安装产物。
