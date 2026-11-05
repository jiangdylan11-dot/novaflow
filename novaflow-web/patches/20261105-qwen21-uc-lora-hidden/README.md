# 破限 LoRA 不进"添加兼容 LoRA"列表（后端冻结副本补丁）

原因：19db310f（11/4）把 uncensored LoRA 也交给破限开关自动加载，并让控制面把它标记为
`autoManaged: qwen21-uc-lora-v1`。但发版用的是 work\release-XXX 冻结副本，这半边后端改动
一直没移植进去（2.0.314 的 novaflow-web 和 novaflow-companion 只标记了 nsfw 那一个），
所以网页列表照常显示 qwen-image-2.1-uncensored-lora，破限开关也会因缺少 qwen21_uc_lora 而拒绝。

发版线程：复制新的冻结副本后运行一次（可重复运行，目标位置变化会直接报错）：

    node novaflow-web\patches\20261105-qwen21-uc-lora-hidden\apply.mjs work\release-XXX-YYYYMMDD

然后照常部署 novaflow-web 和 novaflow-companion。网页和算力助手端源码已经是对的。
