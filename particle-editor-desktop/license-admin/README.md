# NovaFlow 授权管理工具（离线、绑定机器）

本目录提供用于“签发机器绑定授权文件”的离线工具。应用端使用 Ed25519 公钥验证授权文件签名；管理员侧持有私钥并签发授权。

## 1) 生成密钥对（仅做一次）

建议在安全环境生成，并妥善保管私钥（不要放进仓库/安装包）。

不想使用命令行的话，可以直接使用可视化工具：`npm run license:gui`（见 `license-admin-gui`）。

```bash
node ./license-admin/generate-keypair.mjs --publicOut ./license-public-key.b64 --privateOut ./.secrets/license-private-key.pem
```

## 2) 获取机器码

在 NovaFlow 桌面端的“需要授权”弹窗里复制机器码即可。

## 3) 签发授权文件

```bash
node ./license-admin/issue-license.mjs \
  --machineId <机器码> \
  --privateKey ./.secrets/license-private-key.pem \
  --expiresAt 2027-12-31 \
  --featuresFile ./features.json \
  --out ./license.nfl
```

Windows（CMD）示例：

```bat
node .\license-admin\issue-license.mjs ^
  --machineId <机器码> ^
  --privateKey .\.secrets\license-private-key.pem ^
  --expiresAt 2027-12-31 ^
  --featuresFile .\features.json ^
  --out .\license.nfl
```

将生成的 `license.nfl` 发给用户导入即可完成绑定。

示例 `features.json`：

```json
{ "export": true }
```

## 4) 校验授权文件（可选）

```bash
node ./license-admin/verify-license.mjs --license ./license.nfl --publicKeyB64 ./license-public-key.b64 --machineId <机器码>
```
