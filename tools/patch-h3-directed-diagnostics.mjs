import fs from 'node:fs';
const files = ['supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs', 'particle-editor-desktop/admin-server/server.js'];
for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  const replace = (before, after) => {
    if (source.includes(after)) return;
    if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw Error('Missing/ambiguous anchor: '+before);
    source = source.replace(before, after);
  };
  replace('function buildMiniMaxH3RepairBody(body, errorCode = "h3_contract_invalid") {', 'function buildMiniMaxH3RepairBody(body, errorCode = "h3_contract_invalid", validationError = null) {');
  replace('`Failed gate: ${String(errorCode || "h3_contract_invalid").slice(0, 80)}.`,', '`Failed gate: ${String(errorCode || "h3_contract_invalid").slice(0, 80)}.`,\n    `具体失败项：${h3PromptEnhance.validationIssue(validationError).message}。请针对这一项修正，同时保留原提示词事实、完整原台词和用户补充要求。`,');
  replace('buildMiniMaxH3RepairBody(body, error?.errorCode);', 'buildMiniMaxH3RepairBody(body, error?.errorCode, error);');
  replace('const message = failureCategory === "provider_content_policy"', 'const issue = h3PromptEnhance.validationIssue(error?.minimaxH3SafeError === true ? error : null);\n  const message = failureCategory === "provider_content_policy"');
  replace('? "Grok 返回内容未通过 H3 协议校验"', '? (issue.reason === "contract_invalid" ? "Grok 返回内容未通过 H3 协议校验" : `Grok 优化失败：${issue.message}。原提示词未修改。`)');
  replace('const h3RetryCount = error?.h3ContractRepairUsed === true', 'const h3RetryCount = error?.h3ContractRepairUsed === true || error?.grokVisualContractRetryUsed === true');
  replace(': failureCategory === "timeout" ? "provider_timeout" : failureCategory === "provider_http" ? "provider_unavailable" : "contract_invalid");', ': failureCategory === "timeout" ? "provider_timeout" : failureCategory === "provider_http" ? "provider_unavailable" : issue.reason);');
  fs.writeFileSync(file, source);
}
