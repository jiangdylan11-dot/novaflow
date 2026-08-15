# NovaFlow Runtime Single Source

## 目标

`particle-editor/novaflow-brand-runtime.js` 是 NovaFlow runtime 的唯一维护源。

以下文件只能由同步脚本生成，禁止人工维护：

- `particle-editor-desktop/renderer/novaflow-brand-runtime.js`
- `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js`

## 唯一可编辑文件

只允许直接编辑：

```text
particle-editor/novaflow-brand-runtime.js
```

不要直接编辑 desktop renderer 或 `win-unpacked` renderer 里的 runtime 副本。任何业务逻辑、UI、AI 或 runtime shell 修改都必须先落在 source runtime，再由脚本同步。

## Runtime 修改流程

每次 runtime 修改必须按顺序执行：

```powershell
# 1. 修改唯一 source runtime
# particle-editor/novaflow-brand-runtime.js

# 2. 同步生成副本
npm run sync:runtime

# 3. 校验三份 SHA256 完全一致
npm run check:runtime

# 4. 检查三份 runtime 语法
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor-desktop/renderer/novaflow-brand-runtime.js
node --check particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js

# 5. 提交
npm run auto-commit
git status
```

## 同步脚本

同步入口：

```powershell
npm run sync:runtime
```

脚本读取：

```text
particle-editor/novaflow-brand-runtime.js
```

并覆盖生成：

```text
particle-editor-desktop/renderer/novaflow-brand-runtime.js
particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js
```

脚本要求：

- 使用 UTF-8 runtime 内容
- 按 source runtime 字节写入，保留换行格式
- 覆盖后保留目标文件权限
- 覆盖前输出目标路径
- 完成后输出同步 SHA256

## 校验脚本

校验入口：

```powershell
npm run check:runtime
```

校验结果必须为：

```text
PASS
```

如果出现 `FAIL`，说明存在未同步副本或缺失文件，必须先执行 `npm run sync:runtime` 并重新校验。
