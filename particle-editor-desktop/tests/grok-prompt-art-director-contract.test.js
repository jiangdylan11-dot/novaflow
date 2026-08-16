const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const desktopSource = fs.readFileSync(path.join(root, "particle-editor-desktop/admin-server/server.js"), "utf8");
const cloudSource = fs.readFileSync(path.join(root, "supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs"), "utf8");

function ordinaryPatchBlock(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const start = normalized.indexOf("function ordinaryArtPromptPatchBlocks(");
  const end = normalized.indexOf("function buildGrokVisualSemanticDegradedResult(", start);
  assert.ok(start >= 0 && end > start, "ordinary Art deterministic patch block must exist");
  return normalized.slice(start, end);
}

function structuredTomlQuoter(source) {
  const match = source.match(/function ordinaryArtStructuredPromptTomlValue\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, "structured TOML string quoter must exist");
  return Function(`"use strict"; return (${match[0]});`)();
}

function structuredAdultRestoreBlock(source) {
  const start = source.indexOf("function ordinaryArtStructuredPromptRestoreSourceAdultIdentity(");
  const end = source.indexOf("function ordinaryArtStructuredPromptSourcePreserved(", start);
  assert.ok(start >= 0 && end > start, "structured source-adult restoration helper must exist");
  return source.slice(start, end);
}

function structuredRequirementClauseSpecs(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const start = normalized.indexOf("function ordinaryArtStructuredPromptRequirementClauseSpecs(");
  const end = normalized.indexOf("function ordinaryArtStructuredPromptRequirementClauses(", start);
  assert.ok(start >= 0 && end > start, "structured requirement-clause parser must exist");
  const block = normalized.slice(start, end);
  return Function(
    "ordinaryArtStructuredPromptLine",
    "ordinaryArtPromptPatchCompact",
    `"use strict"; ${block}; return ordinaryArtStructuredPromptRequirementClauseSpecs;`
  )(
    (value, maxLength) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength),
    (value) => String(value ?? "").toLowerCase().replace(/\s+/gu, "").trim()
  );
}

function structuredCriticalAnchorsPreserved(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const numberStart = normalized.indexOf("function ordinaryArtStructuredPromptManifestNumber(");
  const numberEnd = normalized.indexOf("function ordinaryArtStructuredPromptSourceSentences(", numberStart);
  const criticalStart = normalized.indexOf("function ordinaryArtStructuredPromptCriticalAnchorsPreserved(");
  const criticalEnd = normalized.indexOf("function ordinaryArtStructuredPromptHardBlocksPreserved(", criticalStart);
  assert.ok(numberStart >= 0 && numberEnd > numberStart, "structured manifest-number helper must exist");
  assert.ok(criticalStart >= 0 && criticalEnd > criticalStart, "structured critical-anchor helper must exist");
  return Function(
    "ordinaryArtPromptPatchCompact",
    `"use strict"; ${normalized.slice(numberStart, numberEnd)}\n${normalized.slice(criticalStart, criticalEnd)}; return ordinaryArtStructuredPromptCriticalAnchorsPreserved;`
  )((value) => String(value ?? "").toLowerCase().replace(/\s+/gu, "").trim());
}

function simpleQualityClosure(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const start = normalized.indexOf("function ordinaryArtPromptPatchRawUserInstruction(");
  const end = normalized.indexOf("function ordinaryArtStructuredPromptUserInstruction(", start);
  assert.ok(start >= 0 && end > start, "simple quality closure helpers must exist");
  const block = normalized.slice(start, end);
  return Function(
    "normalizeSmartAiText",
    `"use strict"; ${block}; return {
      domains: ordinaryArtPromptSimpleQualityClosureDomains,
      close: ordinaryArtPromptApplySimpleQualityClosure
    };`
  )((value, limit = 20000) => String(value || "").replace(/\r\n/g, "\n").trim().slice(0, limit));
}

assert.equal(
  ordinaryPatchBlock(desktopSource),
  ordinaryPatchBlock(cloudSource),
  "desktop and cloud must use the same deterministic merge validator"
);

for (const [name, source] of [["desktop", desktopSource], ["cloud", cloudSource]]) {
  const quoteTomlValue = structuredTomlQuoter(source);
  const requirementClauseSpecs = structuredRequirementClauseSpecs(source);
  const criticalAnchorsPreserved = structuredCriticalAnchorsPreserved(source);
  const qualityClosure = simpleQualityClosure(source);
  const simpleSource = "一名成年女战士站在山谷中，电影级光影，细节清晰。";
  const qualityInstruction = "增强材质、光影层次和画面质感";
  assert.deepEqual(
    qualityClosure.domains(simpleSource, qualityInstruction),
    ["material", "lighting", "quality"],
    `${name} must classify the exact allowlisted three-domain request`
  );
  const discardedProviderDelta = qualityClosure.close(
    simpleSource,
    qualityInstruction,
    "一名成年女战士站在海边，背景增加飞鸟，夕阳为红色。"
  );
  assert.ok(discardedProviderDelta.startsWith(simpleSource), `${name} closure must rebuild from the trusted source`);
  assert.doesNotMatch(discardedProviderDelta, /海边|飞鸟|红色/u, `${name} closure must discard an unproven provider delta`);
  for (const phrase of [
    "材质与纹理细腻清晰",
    "光影层次丰富，高光与阴影过渡自然",
    "画面质感精致，细节清晰，完成度高"
  ]) {
    assert.match(discardedProviderDelta, new RegExp(phrase, "u"), `${name} must close every requested missing domain`);
  }
  const partialSource = "一名成年女战士站在山谷中，材质与纹理细腻清晰，光影层次丰富。";
  const partialClosed = qualityClosure.close(partialSource, qualityInstruction, "provider changed background");
  assert.equal((partialClosed.match(/材质与纹理细腻清晰/gu) || []).length, 1, `${name} must not duplicate material closure`);
  assert.equal((partialClosed.match(/光影层次丰富/gu) || []).length, 1, `${name} must not duplicate lighting closure`);
  assert.match(partialClosed, /画面质感精致，细节清晰，完成度高/u, `${name} must append only the missing quality closure`);
  for (const instruction of [
    "增强背景质感",
    "增强材质并保持构图",
    "不要增强材质",
    "把材质改得更清晰",
    "增强红色材质",
    "增加细节",
    "材质、光影层次和画面质感"
  ]) {
    assert.deepEqual(qualityClosure.domains(simpleSource, instruction), [], `${name} must abstain for ${instruction}`);
  }
  assert.deepEqual(
    qualityClosure.domains("一名女战士使用 __NOVAFLOW_IMAGE_1__ 作为参考。", qualityInstruction),
    [],
    `${name} must not close resource-bearing prompts`
  );
  assert.deepEqual(
    qualityClosure.domains("[风格设定]\n媒介=数字绘画", qualityInstruction),
    [],
    `${name} must not close structured prompts`
  );
  assert.deepEqual(
    qualityClosure.domains(simpleSource, qualityInstruction, { promptSchema: "nf.art.prompt.v1" }),
    [],
    `${name} must not close a schema-bearing request`
  );
  const exactWhitespaceCandidate = "  first line\r\nsecond line  \n";
  assert.equal(
    qualityClosure.close(simpleSource, "增强背景质感", exactWhitespaceCandidate),
    exactWhitespaceCandidate,
    `${name} must preserve every noneligible candidate byte`
  );
  assert.deepEqual(
    requirementClauseSpecs("增强材质、光影层次和画面质感，保持主体与构图。"),
    [{ clause: "材质、光影层次和画面质感", direction: "increase" }],
    `${name} must not count a terminal generic preservation clause as a new edit fact`
  );
  assert.deepEqual(
    requirementClauseSpecs("enhance material detail, keep the subject and composition unchanged"),
    [{ clause: "material detail", direction: "increase" }],
    `${name} must preserve the same terminal generic-preservation behavior in English`
  );
  for (const [sourceText, candidateText, instruction, expected, label] of [
    ["一个物体", "一件物体", "", true, "one compatible classifier"],
    ["两个物体", "一件物体", "", false, "two-to-one loss"],
    ["一个物体", "11件物体", "", false, "one must not match eleven"],
    ["两个物体", "12件物体", "", false, "two must not match twelve"],
    ["4个物体", "4件物体", "", true, "arbitrary numeric count"],
    ["12个物体", "12件物体", "", true, "two-digit numeric count"],
    ["两个物体", "一件物体", "把两个物体改为一个物体", true, "explicit count edit"]
  ]) {
    assert.equal(
      criticalAnchorsPreserved(sourceText, candidateText, instruction),
      expected,
      `${name} must handle ${label}`
    );
  }
  for (const [instruction, expected, label] of [
    ["增强材质，同时保持主体与构图", [{ clause: "材质", direction: "increase" }], "connector"],
    ["保持主体与构图，增强材质", [{ clause: "材质", direction: "increase" }], "leading"],
    ["增强材质，保持主体与构图，提高光影层次", [
      { clause: "材质", direction: "increase" },
      { clause: "光影层次", direction: "increase" }
    ], "middle"],
    ["enhance material detail and keep the subject and composition unchanged", [
      { clause: "material detail", direction: "increase" }
    ], "english connector"],
    ["保持主体；维持整体构图不变", [
      { clause: "保持主体", direction: "target" },
      { clause: "维持整体构图不变", direction: "target" }
    ], "pure preservation"]
  ]) {
    assert.deepEqual(
      requirementClauseSpecs(instruction),
      expected,
      `${name} must preserve ${label} generic-preservation semantics`
    );
  }
  assert.deepEqual(
    requirementClauseSpecs("增强材质，保留蓝色发饰"),
    [
      { clause: "材质", direction: "increase" },
      { clause: "保留蓝色发饰", direction: "target" }
    ],
    `${name} must keep named preservation constraints in the edit ledger`
  );
  const allC0 = Array.from({ length: 32 }, (_value, index) => String.fromCharCode(index)).join("");
  const dangerousValue = `prefix\"quote\\backslash/forward-slash${allC0}suffix`;
  const encodedValue = quoteTomlValue(dangerousValue);
  assert.equal(JSON.parse(encodedValue), dangerousValue, `${name} renderer JSON parser must recover the full value`);
  assert.doesNotMatch(encodedValue, /[\u0000-\u001f]/u, `${name} quoted value must not contain raw C0 controls`);
  const tomlProbe = `[风格设定]\n完成质感 = ${encodedValue}\n`;
  assert.doesNotMatch(tomlProbe, /[\u0000-\u0009\u000b-\u001f]/u, `${name} output may use structural LF only`);
  assert.equal(
    JSON.parse(tomlProbe.split(" = ", 2)[1].trim()),
    dangerousValue,
    `${name} renderer-style assignment parser must accept the compiled string`
  );
  assert.match(source, /function ordinaryArtStructuredPromptTomlValue\(value\) \{\s*return JSON\.stringify\(String\(value \?\? ""\)\);\s*\}/, `${name} must use complete JSON string escaping`);
  assert.match(source, /资深游戏美术总监兼生成模型提示词编译器/, `${name} must use the art-director system role`);
  assert.match(source, /先在内部完成美术导演分析，再编译最终提示词/, `${name} must use the two-stage image prompt protocol`);
  assert.match(source, /不得为了画面丰富擅自换题、加角色、改用途或覆盖用户设定/, `${name} must preserve user hard constraints`);
  assert.match(source, /角色设计要落实身份轮廓[\s\S]*?游戏 UI 要落实信息层级[\s\S]*?特效概念要落实核心形状/, `${name} must include asset-specific art direction`);
  assert.match(source, /若目标风格是智能匹配[\s\S]*?线条、造型、上色方法、材质、配色、光影和渲染完成度/, `${name} must turn smart style into visible decisions`);
  assert.match(source, /通常控制在约 220 至 520 个中文字符/, `${name} must constrain prompt density`);
  assert.match(source, /提示词优化不得按固定字数压缩原文/, `${name} must not compress ordinary optimize prompts to the create length`);
  assert.match(source, /约 12 至 28 个中文短词/, `${name} must require targeted concise negatives`);
  assert.match(source, /temperature:\s*isAnimation \? 0\.4 : \(isCreate \? 0\.5 : 0\.3\)/, `${name} must separate creation and optimization sampling`);
  assert.match(source, /novaflow_art_prompt_patch_v1/, `${name} must request strict ordinary Art patches`);
  assert.match(source, /block\.text\.indexOf\(targetQuote[\s\S]*block\.text\.indexOf\(targetQuote, localStart \+ targetQuote\.length\)/, `${name} must require one exact occurrence inside the selected block`);
  assert.match(source, /不得按逗号、顿号、分号或短语机械拆/, `${name} must keep the change request unified`);
  assert.match(source, /replacement 不需要与 target_quote 有词面重合/, `${name} must allow conflict replacement without lexical overlap`);
  assert.match(source, /ORDINARY_ART_PROMPT_PATCH_MAX_ITEMS = 4/, `${name} must bound one unified edit to four patches`);
  assert.match(source, /Grok ordinary Art patch targets overlap/, `${name} must reject overlapping spans atomically`);
  assert.match(source, /Grok ordinary Art patch collapses target content/, `${name} must reject destructive target collapse`);
  assert.match(source, /Grok ordinary Art patch damages a resource token/, `${name} must preserve protected resource tokens`);
  assert.match(source, /Grok ordinary Art merged prompt drops a named hard-constraint block/, `${name} must preserve named hard-constraint blocks`);
  assert.match(source, /ordinaryArtPromptApplySimpleQualityClosure\([\s\S]*ordinaryArtPromptPatchResourceTokens\(mergedPrompt\)[\s\S]*ordinaryArtPromptPatchNamedHardBlocksPreserved\(source, mergedPrompt[\s\S]*ordinaryArtPromptCoreRedefinitionFailure\(/, `${name} must run resource, retention, and core gates after deterministic quality closure`);
  assert.match(source, /retained \/ blockBigrams\.size < 0\.6/, `${name} must retain named hard-block content, not only its label`);
  assert.match(source, /若统一变更要求确实与整个短 Prompt 冲突，可以替换全部受影响内容/, `${name} must allow legitimate fully conflicting short edits`);
  assert.match(source, /operation === "append"[\s\S]*ordinaryArtPromptPatchReplacementIsMetaInstruction\(replacement\)/, `${name} must reject append operation instructions`);
  assert.ok(source.includes('(?:^|[。！？!?；;，,\\r\\n])\\s*'), `${name} must detect operation instructions at sentence and comma boundaries`);
  assert.match(source, /ordinaryArtPromptPatchCompact\(mergedPrompt\) === ordinaryArtPromptPatchCompact\(source\)/, `${name} must reject normalized merged no-ops`);
  assert.match(source, /ordinaryArtPromptPatchNamedBlockBody\(block\.text\)[\s\S]*ordinaryArtPromptPatchNamedBlockBody\(mergedBlock\.text\)/, `${name} must measure hard-block body retention without label inflation`);
  assert.match(source, /ordinaryArtPromptPatchShortHardBodyExplicitlyChanged\(block, requirements\)/, `${name} must protect short hard-block bodies unless the user explicitly changes them`);
  assert.match(source, /ordinaryArtPromptCoreRedefinitionFailure\([\s\S]*core-redefinition-incomplete:stale-female-group/, `${name} must reject incomplete closed-slot subject redefinitions`);
  assert.match(source, /ORDINARY_ART_PROMPT_CORE_RECONCILE_MAX_UNITS = 8/, `${name} must bound deterministic closure to eight real prompt units`);
  assert.match(source, /ordinaryArtPromptCoreMixedAdultReconciliationEnabled\(rawPrompt, requirements, candidate\)[\s\S]*ordinaryArtPromptCoreAffirmativeMinorPresent\(instruction\)[\s\S]*ordinaryArtPromptCoreAffirmativeMinorPresent\(candidate\)/, `${name} must reject minor instructions and candidates before deterministic closure`);
  assert.match(source, /ORDINARY_ART_PROMPT_CORE_MINOR_NEGATED_PREFIX_PATTERN[\s\S]*ORDINARY_ART_PROMPT_CORE_MINOR_NEGATED_SUFFIX_PATTERN[\s\S]*function ordinaryArtPromptCoreMinorMentionIsNegated\(source, index, length\)[\s\S]*source\.slice\(Math\.max\(0, index - 80\), index\)[\s\S]*source\.slice\(index \+ length, index \+ length \+ 64\)/, `${name} must classify each minor mention from bounded local context`);
  assert.match(source, /for \(const match of text\.matchAll\(pattern\)\)[\s\S]*!ordinaryArtPromptCoreMinorMentionIsNegated\(text, match\.index, match\[0\]\.length\)/, `${name} must reject a later affirmative minor even when another mention in the same block is negated`);
  assert.match(source, /from\\s\+appearing\|from\\s\+being\\s\+\(\?:shown\|included\|added\|present\)\|to\\s\+appear\|to\\s\+be\\s\+\(\?:shown\|included\|added\|present\)/, `${name} must treat an English suffix as negated only when it bans the minor entity itself, not one of its attributes or poses`);
  assert.match(source, /hasExplicitSideMapping[\s\S]*if \(!hasExplicitSideMapping && \(rawHasPairedFemaleSides \|\| rawHasPairedMaleSides\)\)/, `${name} must not neutralize an explicit left\/right gender mapping`);
  assert.match(source, /ordinaryArtPromptCoreSupplementLowerBodyFraming\([\s\S]*ordinaryArtPromptCoreAffirmativeMinorPresent\(instruction\)[\s\S]*requestedNudity[\s\S]*targetBlock[\s\S]*取景要求/, `${name} must deterministically supplement only a safe explicit lower-body framing slot`);
  assert.match(source, /mixedAdultCoreReconciliationRequested[\s\S]*ignoredNamedHardSpans[\s\S]*ordinaryArtPromptPatchNamedHardBlocks\(block\.text\)[\s\S]*effectiveOrderedSpans/, `${name} must ignore model spans on named hard blocks during mixed-adult reconciliation`);
  assert.match(source, /oneOfTwoReplacement[\s\S]*!ordinaryArtPromptCoreExactMixedPairPresent\(next\)[\s\S]*next = rawBlock/, `${name} must deterministically canonicalize a model-expanded one-of-two block before signing it`);
  assert.match(source, /ignoredNamedHardSpans\.some[\s\S]*ordinaryArtPromptPatchExplicitlyEditsNamedHardBlock[\s\S]*cannot ignore an explicitly requested hard-constraint edit/, `${name} must fail closed instead of silently swallowing an explicit non-core hard-block edit`);
  assert.match(source, /function ordinaryArtPromptPatchRawUserInstruction\(requirements\)[\s\S]*firstLine\.match\([\s\S]*用户本次修改要求\\s\*\[（\(\]最高优先级\[）\)\][\s\S]*return marked \? normalizeSmartAiText\(marked\[1\], 4000\) : text/, `${name} must isolate the renderer-marked first-line user instruction while preserving unmarked direct-call compatibility`);
  assert.match(source, /function ordinaryArtPromptPatchExplicitlyEditsNamedHardBlock\(block, requirements\) \{\s*const instruction = ordinaryArtPromptPatchRawUserInstruction\(requirements\)/, `${name} must classify hard-block edits from raw user intent instead of appended renderer policy`);
  const hardGroupPredicate = '(?:are(?:\\s+required\\s+to\\s+be)?|(?:must|should)(?:\\s+(?:be|remain))?|need\\s+to\\s+(?:be|remain)|remain)';
  assert.ok(source.split(hardGroupPredicate).length >= 4, `${name} must recognize common English hard-group predicates in both stale detection and deterministic closure`);
  assert.match(source, /preliminaryCoreReconciliationEligible[\s\S]*ordinaryArtPromptCoreReconcileMixedAdultClosedSlots\([\s\S]*effectiveOrderedSpans[\s\S]*postClosedSlotCoreFailure === "core-redefinition-incomplete:missing-lower-body-framing"[\s\S]*ordinaryArtPromptCoreSupplementLowerBodyFraming/, `${name} must close mixed-adult slots before supplementing the sole residual framing slot`);
  assert.doesNotMatch(ordinaryPatchBlock(source), /const preReconciliationCoreFailure\b/, `${name} must not keep the obsolete pre-reconciliation failure variable`);
  assert.match(source, /mixedAdultCoreReconciliationRequested[\s\S]*ordinaryArtPromptCoreAffirmativeMinorPresent\(mergedPrompt\)[\s\S]*core-redefinition-incomplete:affirmative-minor/, `${name} must reject affirmative minors before signing a mixed-adult deterministic merge`);
  assert.match(source, /replacement 只写明确成年的最终画面终态；禁止在任何 replacement 中输出未成年人、儿童、17岁、minor、underage、17-year-old/, `${name} must tell the model to emit only the adult final state without minor safety prose`);
  assert.match(source, /totalTargetLength \+ reconciliation\.targetChars[\s\S]*ORDINARY_ART_PROMPT_PATCH_MAX_TOTAL_TARGET_LENGTH/, `${name} must share the 320-character target budget across model and deterministic patches`);
  assert.match(source, /ordinaryArtPromptCorePositiveMentionPresent[\s\S]*ORDINARY_ART_PROMPT_CORE_ACTOR_NEGATED_MENTION_PREFIX_PATTERN[\s\S]*ORDINARY_ART_PROMPT_CORE_ACTOR_CONTEXT_SUFFIX_PATTERN/, `${name} must distinguish direct actor negation from audience\/POV gender mentions`);
  assert.match(source, /ORDINARY_ART_PROMPT_CORE_THREE_OR_MORE_PEOPLE_PATTERN[\s\S]*ordinaryArtPromptCoreExactMixedPairPresent[\s\S]*core-redefinition-incomplete:one-of-two-composition/, `${name} must enforce the closed mixed-pair replacement without accepting a third person`);
  assert.match(source, /\(\?:one\|an\?\)[^\n]+adult/, `${name} must accept English a\/an and one as a single member of the mixed pair`);
  assert.match(source, /必须扫描全部 block[\s\S]*未被新要求否定或替换的旧动作可以保留/, `${name} must request cross-block cleanup without deleting unmentioned actions`);
  assert.doesNotMatch(ordinaryPatchBlock(source), /stale-action-/, `${name} must not reject unmentioned legacy actions`);
  assert.match(source, /payload\?\.nsfw === true[\s\S]*成人内容上下文：用户已开启 NSFW[\s\S]*性别、成年身份、裸体状态、身体姿势与人物关系[\s\S]*任何未成年人相关内容仍然禁止/, `${name} must add adult NSFW context only for an explicit true switch`);
  assert.match(source, /isOrdinaryArtPromptOptimizePayload\(payload\)/, `${name} must isolate ordinary Art optimize from UI and reverse purposes`);
  assert.match(source, /ordinaryArtPromptPatch:\s*true/, `${name} must route ordinary Art optimize through deterministic merge`);
  assert.match(source, /editContract:\s*ORDINARY_ART_PROMPT_EDIT_CONTRACT/, `${name} must mark only a validated deterministic merge`);
  assert.match(source, /ORDINARY_ART_STRUCTURED_PROMPT_SCHEMA = "nf\.art\.prompt\.v1"/, `${name} must define the exact structured Art capability`);
  assert.match(source, /String\(payload\?\.promptSchema \|\| ""\) === ORDINARY_ART_STRUCTURED_PROMPT_SCHEMA/, `${name} must require the exact promptSchema capability without aliases`);
  assert.match(source, /hasStructuredCurrentPrompt = typeof payload\?\.currentPrompt === "string"[\s\S]*Boolean\(normalizeSmartAiText\(payload\.currentPrompt, 20000\)\)/, `${name} must require an explicit nonempty currentPrompt for the new contract`);
  assert.match(source, /usesStructuredArtPrompt = isOrdinaryArtOptimize[\s\S]*payload\?\.surface === "art"[\s\S]*payload\?\.purpose === "optimize"[\s\S]*hasStructuredCurrentPrompt[\s\S]*!ordinaryArtStructuredPromptHasReferenceCarrier\(payload\)[\s\S]*String\(payload\?\.promptSchema/, `${name} must isolate the new contract by exact surface, purpose, currentPrompt, reference-free input, and schema`);
  assert.match(source, /function ordinaryArtStructuredPromptHasReferenceCarrier\(payload\)[\s\S]*"images"[\s\S]*"referenceImages"[\s\S]*"imageAttachments"[\s\S]*"referenceImageIds"/, `${name} must keep image and reference carriers out of text-only structured recompile`);
  assert.match(source, /name: "novaflow_art_prompt_v1"[\s\S]*strict: true/, `${name} must request strict structured Art IR`);
  assert.ok(source.includes('"schema", "subject_count", "style", "subjects", "relations", "environment"'), `${name} must use the fixed Local-compatible top-level semantic keys`);
  assert.ok(source.includes('"name", "count", "appearance", "pose", "action", "materials", "colors", "details"'), `${name} must use the fixed Local-compatible subject keys`);
  assert.match(source, /style: exactObject\(ORDINARY_ART_STRUCTURED_STYLE_KEYS[\s\S]*subjects:[\s\S]*items: exactObject\(ORDINARY_ART_STRUCTURED_SUBJECT_KEYS[\s\S]*environment: exactObject\(ORDINARY_ART_STRUCTURED_ENVIRONMENT_KEYS[\s\S]*lighting_color: exactObject\(ORDINARY_ART_STRUCTURED_LIGHTING_KEYS[\s\S]*camera: exactObject\(ORDINARY_ART_STRUCTURED_CAMERA_KEYS/, `${name} must expose only fixed nested semantic objects`);
  assert.match(source, /ordinaryArtStructuredPromptExactObject\([\s\S]*ORDINARY_ART_STRUCTURED_TOP_LEVEL_KEYS[\s\S]*ordinaryArtStructuredPromptEnsureUniqueVisualValues\(visualValues\)[\s\S]*ordinaryArtStructuredPromptEnsureMinimumFacts\(style, subjects, environment, lightingColor, camera\)[\s\S]*ordinaryArtStructuredPromptEnsureObjectPersonConsistency\(subjects, camera\)/, `${name} must validate exact keys, independent detail, duplicate facts, and object-person consistency`);
  assert.match(source, /`媒介 = \$\{q\(style\.medium\)\}`[\s\S]*`主体数量 = \$\{subjectCount\}`[\s\S]*`环境 = \$\{q\(environment\.setting\)\}`[\s\S]*`光源方向 = \$\{q\(lightingColor\.light_direction\)\}`[\s\S]*`景别 = \$\{q\(camera\.shot\)\}`[\s\S]*`要求\$\{index \+ 1\} = \$\{q\(constraint\)\}`/, `${name} must compile deterministic fixed-key six-section TOML`);
  assert.match(source, /applied_requirements:\s*\{[\s\S]*?type:\s*"array"[\s\S]*?minItems:\s*0[\s\S]*?maxItems:\s*16[\s\S]*?逐字等于前五个视觉分区中的一个完整scalar值/, `${name} must keep the optional ledger array while describing exact front-scalar grounding`);
  assert.match(source, /function ordinaryArtStructuredPromptUserInstruction\(requirements\)[\s\S]*提示词编辑模式[\s\S]*return ""/, `${name} must distinguish renderer policy from a real optional user instruction`);
  assert.match(source, /function ordinaryArtStructuredPromptRequirementClauseSpecs[\s\S]*并且\|同时\|以及\|然后[\s\S]*\{ clause, direction \}/, `${name} must preserve direction for every separated user requirement clause`);
  assert.match(source, /appliedRequirements\.length !== clauseSpecs\.length[\s\S]*clauseByFact[\s\S]*assignClause/, `${name} must assign exactly one distinct signed ledger fact per requirement clause`);
  assert.match(source, /increase\|make\|use\|set[\s\S]*empty, too long, or meta text/, `${name} must reject English imperative echoes at value boundaries`);
  assert.match(source, /const exactOverlap = compactFact\.includes\(compactClause\)/, `${name} must not let a short fact masquerade as a longer requirement clause`);
  assert.match(source, /function ordinaryArtStructuredPromptSemanticComponents[\s\S]*const han[\s\S]*const english[\s\S]*return \{ han, english \}/, `${name} must derive language-specific distinctive anchors`);
  assert.match(source, /return chineseAnchorMatch && englishAnchorMatch/, `${name} must require both Han and English anchors for mixed-language clauses`);
  assert.match(source, /ordinaryArtStructuredPromptSemanticSegments[\s\S]*clausePositive[\s\S]*factPositive[\s\S]*sameNegativeObject[\s\S]*clauseNegative[\s\S]*factNegative/, `${name} must enforce object-scoped polarity for every compound subclause`);
  assert.match(source, /const groundedExact = groundedLedgerParsed && groundedDistinct[\s\S]*appliedRequirements\.every\(\(fact\) => frontValues\.includes\(fact\)\)[\s\S]*ordinaryArtStructuredPromptRebuildRequirementLedger/, `${name} must exact-ground model ledgers and use strict deterministic fallback`);
  assert.match(source, /function ordinaryArtStructuredPromptCanonicalSafeIntentSlot\(clause, direction\)[\s\S]*direction !== "increase" && direction !== "target"[\s\S]*return "finish"[\s\S]*return "render_language"[\s\S]*return "atmosphere"/, `${name} must classify only the three explicit positive aesthetic closure intents`);
  assert.match(source, /function ordinaryArtStructuredPromptApplySimpleQualityClosure[\s\S]*材质、光影层次和画面质感[\s\S]*material\\u0000lighting\\u0000quality[\s\S]*style\.finish[\s\S]*ordinaryArtStructuredPromptRequirementCoverage/, `${name} must close only the exact three-domain compound quality bundle into one grounded finish scalar`);
  assert.ok(source.includes('finish: "画面质感细腻丰富"'), `${name} must use the fixed finish-quality canonical fact`);
  assert.ok(source.includes('render_language: "人物造型性感且成年比例明确"'), `${name} must use the fixed sensual-character canonical fact`);
  assert.ok(source.includes('atmosphere: "偏成人向的成熟审美氛围"'), `${name} must use the fixed adult-atmosphere canonical fact`);
  assert.ok(source.includes('finish: "image quality is refined with rich material detail"'), `${name} must use the Local-equivalent English finish canonical fact`);
  assert.ok(source.includes('render_language: "character design is sensual with clearly adult proportions"'), `${name} must use the Local-equivalent English sensual-character canonical fact`);
  assert.ok(source.includes('atmosphere: "mature adult-oriented aesthetic atmosphere"'), `${name} must use the Local-equivalent English adult-atmosphere canonical fact`);
  assert.ok(source.includes('const hanCount = (clause.match(/[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]/gu) || []).length;'), `${name} must count the Local Han ranges for per-clause canonical language selection`);
  assert.ok(source.includes('const englishWordCount = (clause.match(/[a-z]{2,}/giu) || []).length;'), `${name} must count English words for per-clause canonical language selection`);
  assert.ok(source.includes('englishWordCount > 0 && (hanCount === 0 || englishWordCount * 2 > hanCount)'), `${name} must use the Local primary-language threshold`);
  assert.match(source, /assignments\.push\(\{ clause, direction, slot, language \}\)[\s\S]*additions\[language\]\?\.\[slot\]/, `${name} must carry the per-clause language into canonical compilation and source-no-op checks`);
  assert.match(source, /usedSlots\.has\(slot\)[\s\S]*slot === "render_language" \|\| slot === "atmosphere"[\s\S]*!hasPersonSubject/, `${name} must fail closed on slot conflicts and require a person only for character sensuality or adult atmosphere`);
  assert.match(source, /hasPersonSubject = subjects\.some\(\(subject\) => \([\s\S]*PERSON_SUBJECT_PATTERN\.test\(subject\.name\)/, `${name} must prove a person from the subject identity rather than appearance leakage`);
  assert.match(source, /function ordinaryArtStructuredPromptCanonicalSlotHasOpposite\(slot, value\)[\s\S]*slot === "finish"[\s\S]*低劣\|粗糙[\s\S]*slot === "render_language"[\s\S]*不性感[\s\S]*非性感[\s\S]*保守[\s\S]*slot === "atmosphere"[\s\S]*不成人向[\s\S]*非成人向[\s\S]*return true/, `${name} must reject explicit opposite target scalars without demanding prior positive evidence`);
  assert.match(source, /!baseValue \|\| !addition[\s\S]*ordinaryArtStructuredPromptCanonicalSlotHasOpposite\(slot, baseValue\)/, `${name} must apply the opposite-scalar gate before canonical append`);
  assert.ok(source.includes('ordinaryArtStructuredPromptScalar(`${baseValue}，${addition}`, path)'), `${name} must append rather than replace the provider style scalar`);
  assert.match(source, /const canonicalAliases = \[additions\.zh\?\.\[slot\], additions\.en\?\.\[slot\]\][\s\S]*canonicalAliases\.some\(\(candidate\) => \([\s\S]*sourceCompact\.includes\(ordinaryArtPromptPatchCompact\(candidate\)\)[\s\S]*ordinaryArtPromptPatchCompact\(baseValue\)\.includes\(ordinaryArtPromptPatchCompact\(addition\)\)/, `${name} must reject same- and cross-language canonical no-ops in the source plus selected-language no-ops in the target slot`);
  assert.match(source, /ordinaryArtStructuredPromptRebuildRequirementLedger\(rawInstruction, frontValues\)[\s\S]*!ordinaryArtStructuredPromptRequirementCoverage\(rawInstruction, appliedRequirements\)[\s\S]*ordinaryArtStructuredPromptApplyCanonicalSafeClosure/, `${name} must invoke canonical closure only after grounded and deterministic ledger reconstruction fail`);
  assert.match(source, /if \(rawInstruction && appliedRequirements\.some\(\(fact\) => \([\s\S]*ordinaryArtPromptPatchCompact\(source\)\.includes\(ordinaryArtPromptPatchCompact\(fact\)\)/, `${name} must require every final signed ledger fact to be source-new`);
  const adultRestore = structuredAdultRestoreBlock(source);
  assert.match(adultRestore, /ADULT_RESTORE_INSTRUCTION_PATTERN[\s\S]*ordinaryArtPromptCoreAffirmativeMinorPresent\(source\)[\s\S]*subjectCount < 1 \|\| subjectCount > 12[\s\S]*subjects\.length !== subjectCount/, `${name} must refuse source-adult restoration across identity edits, minors, or count ambiguity`);
  assert.match(adultRestore, /chineseGroup[\s\S]*englishGroup[\s\S]*parsedCount\(match\.groups\?\.count\) !== subjectCount[\s\S]*evidenceSignatures\.size !== 1/, `${name} must require one affirmative all-person source group with an exact subject count`);
  assert.match(adultRestore, /AMBIGUOUS_OBJECT_SUBJECT_PATTERN[\s\S]*gender === "female"[\s\S]*femaleNamePattern[\s\S]*gender === "male"[\s\S]*maleNamePattern/, `${name} must reject object and gender-mapping ambiguity`);
  assert.match(adultRestore, /ordinaryArtStructuredPromptHasExplicitAdultIdentity\(JSON\.stringify\(subject\)\)[\s\S]*ageValue[\s\S]*岁[\s\S]*成年角色[\s\S]*adult character[\s\S]*visualEntry\.value = value/, `${name} must restore only omitted per-subject adult identity and update the compiled visual scalar`);
  assert.doesNotMatch(adultRestore, /\bnsfw\b|SENSUAL_CONTEXT|ADULT_CONTEXT_PATTERN|appliedRequirements/, `${name} must not infer adult identity from NSFW or aesthetic context and must not mutate the requirement ledger`);
  assert.match(source, /ordinaryArtStructuredPromptRestoreSourceAdultIdentity\([\s\S]*frontValues = visualValues\.map[\s\S]*const q = \(value\) => ordinaryArtStructuredPromptTomlValue/, `${name} must restore source-proven identities after ledger closure and before deterministic compilation`);
  assert.match(source, /function ordinaryArtStructuredPromptValidatePositiveTypedAtom\([\s\S]*pose[\s\S]*action[\s\S]*environment[\s\S]*lighting[\s\S]*camera[\s\S]*style/, `${name} must ground positive source atoms in their typed front-section slots`);
  assert.match(source, /function ordinaryArtStructuredPromptValidateSourceVisibleManifest\([\s\S]*let activeScope = locator\(sentence\)[\s\S]*if \(explicitScope\) activeScope = explicitScope/, `${name} must carry a subject locator only across comma segments in the same source sentence`);
  assert.match(source, /segmentColorTargeted[\s\S]*segmentMaterialTargeted[\s\S]*segmentObjectTargeted[\s\S]*locallyPaired/, `${name} must preserve subject colour, material, and clothing independently with local object binding`);
  assert.match(source, /lightDirectionTargeted[\s\S]*lightQualityTargeted[\s\S]*lightColorTargeted[\s\S]*fieldTargeted/, `${name} must grant source-fact edit exceptions at attribute level instead of whole-domain level`);
  assert.match(source, /ordinaryArtStructuredPromptAssertBodyRewriteMatchesSource\(source, rawInstruction\)[\s\S]*ordinaryArtStructuredPromptRestoreSourceAdultIdentity/, `${name} must reject mismatched body-count rewrites before source identity restoration`);
  assert.match(source, /const frontSubjectFacts = \(\) => \[[\s\S]*subject\.appearance[\s\S]*subject\.details[\s\S]*contradictoryRelation/, `${name} must detect body-count contradictions across every subject fact, not only restored relations`);
  assert.match(source, /ordinaryArtStructuredPromptValidateSourceVisibleManifest\(source, rawInstruction, visualValues\)/, `${name} must run ordinary visible-fact retention before signing the structured result`);
  assert.match(source, /function ordinaryArtStructuredPromptCriticalAnchorsPreserved[\s\S]*sourceCountPattern[\s\S]*compiledCountPattern[\s\S]*位\|名\|个\|条\|只\|头\|匹\|辆\|件\|把\|架\|艘[\s\S]*compiledCounts/, `${name} must preserve source cardinality while allowing compatible Chinese classifier normalization`);
  assert.doesNotMatch(source, /const categories = \[\s*\{\s*sourcePattern: \/\(\?:\\d\+\|一\|两\|二\|三\)\\s\*\(\?:位\|名\|个\)\/gu/, `${name} must not require the source classifier token to survive verbatim`);
  assert.match(source, /Grok ordinary Art structured response damages a resource token/, `${name} must preserve resource tokens during structured recompile`);
  assert.match(source, /Grok ordinary Art structured response drops a named hard-constraint block/, `${name} must preserve hard constraints during structured recompile`);
  assert.match(source, /ordinaryArtStructuredPromptInlineHardSentences[\s\S]*must\|required\|only\|keep\|never\|avoid\|prohibit\|forbid[\s\S]*ordinaryArtStructuredPromptInlineHardConstraintsPreserved/, `${name} must preserve unnamed inline hard constraints`);
  assert.match(source, /Grok ordinary Art structured response contains affirmative minor content/, `${name} must reject affirmative minors in sensitive structured results`);
  assert.match(source, /ordinaryArtStructuredPrompt:\s*true[\s\S]*promptSchema:\s*ORDINARY_ART_STRUCTURED_PROMPT_SCHEMA/, `${name} must return internal structured result options only for the capability path`);
  assert.match(source, /editContract:\s*ORDINARY_ART_STRUCTURED_EDIT_CONTRACT,[\s\S]*promptSchema:\s*ORDINARY_ART_STRUCTURED_PROMPT_SCHEMA/, `${name} must sign only a validated structured recompile`);
  assert.match(source, /max_output_tokens:\s*usesStructuredArtPrompt \? 6144 : \(isOrdinaryArtOptimize \? 4096 : 2048\)/, `${name} must reserve a larger structured-IR budget while preserving legacy budgets`);
}

assert.match(
  desktopSource,
  /grok\.data\.editContract === ORDINARY_ART_PROMPT_EDIT_CONTRACT[\s\S]*?\{ editContract: ORDINARY_ART_PROMPT_EDIT_CONTRACT \}/,
  "desktop admin response must whitelist the deterministic merge marker"
);
assert.match(
  desktopSource,
  /grok\.data\.editContract === ORDINARY_ART_STRUCTURED_EDIT_CONTRACT[\s\S]*grok\.data\.promptSchema === ORDINARY_ART_STRUCTURED_PROMPT_SCHEMA[\s\S]*editContract: ORDINARY_ART_STRUCTURED_EDIT_CONTRACT[\s\S]*promptSchema: ORDINARY_ART_STRUCTURED_PROMPT_SCHEMA/,
  "desktop admin response must whitelist the structured marker only together with its exact schema"
);
assert.doesNotMatch(desktopSource, /editContract:\s*grok\.data\.editContract/);
assert.doesNotMatch(desktopSource, /promptSchema:\s*grok\.data\.promptSchema/);

assert.doesNotMatch(
  desktopSource.slice(desktopSource.indexOf("function buildGrokImageReverseRequest")),
  /smartAiImageArtDirectorRules/,
  "image reverse and role-reference behavior must remain unchanged"
);

console.log("grok prompt art director contract tests passed");
