import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGrokImageReverseRequest,
  callGrokResponseWithVisualRetry,
  grokResponsesPublicResult,
  miniMaxH3FailureEnvelope,
  miniMaxH3ReversePreflightFailure
} from "./smart-ai-grok.workflow.mjs";

const image = { dataUrl: "data:image/png;base64,AA==", role: "first_frame", label: "first frame" };

function buildH3(overrides = {}) {
  return buildGrokImageReverseRequest({
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1",
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
    durationSeconds: 5,
    requirements: "required",
    userPrompt: "",
    userRequirements: "",
    images: [image],
    ...overrides
  }, "grok-contract-test");
}

function visualIr({ age = "adult", level = "none", sensitiveFacts = [] } = {}) {
  const minor = age === "minor";
  const youngLooking = age === "young_looking";
  const unverifiable = age === "age_unverifiable";
  return {
    schema: "nf.h3.visual.v1",
    mode: "I2VA",
    subjects: [{
      id: "subject_1",
      age_assessment: age,
      age_evidence: [minor
        ? "visible child proportions"
        : youngLooking
          ? "ambiguous youthful appearance"
        : unverifiable
          ? "visible details do not establish whether the person is an adult or minor"
          : "adult proportions"],
      visible_facts: [minor
        ? "child wearing a blue coat"
        : youngLooking
          ? "person wearing a blue coat"
        : unverifiable
          ? "person wearing a blue coat"
          : "adult wearing a blue coat"]
    }],
    frames: [{
      picture: "<Picture 1>",
      subject_ids: ["subject_1"],
      composition: "subject centered in a medium shot",
      environment: "quiet interior with a wooden wall",
      lighting: "soft side light",
      camera: "locked eye-level camera",
      visible_state: "the subject stands with one hand lowered"
    }],
    sensitive_content_level: level,
    sensitive_visible_facts: sensitiveFacts,
    motion_plan: {
      action_start: "one hand starts lowered",
      action_process: "the hand gradually raises",
      action_result: "the raised hand settles beside the face",
      camera_behavior: "locked camera throughout"
    },
    audio_plan: {
      diegetic_sound: "soft clothing movement",
      ambience: "quiet room tone",
      non_diegetic_music: "N/A"
    },
    uncertain: []
  };
}

function visualFactsV2({
  name = "白发猫耳角色",
  action = "右手自然下垂",
  environment = "日式房间",
  sensitive = false,
  explicitMinor = false
} = {}) {
  return {
    schema: "nf.visual.v2",
    asset_type: "角色插画",
    entities: [{
      name: explicitMinor ? "儿童" : name,
      count: "一名",
      appearance: ["银白色长发", "白色猫耳", "蓝色眼睛", "蓝色外套"],
      pose: "侧坐",
      action,
      materials: ["布料"],
      colors: ["白色", "蓝色"]
    }],
    relations: ["人物位于画面中央"],
    scene: {
      environment,
      background: "木质拉门与榻榻米",
      spatial_layers: ["中景人物", "远景木质拉门"]
    },
    look: {
      lighting: ["柔和侧光"],
      palette: ["暖色木质与冷蓝服装"],
      materials: ["自然布料与木材"],
      style: ["高完成度动漫插画"],
      atmosphere: "安静",
      finish: "细节清晰"
    },
    camera_cues: {
      shot: "中景",
      angle: "平视",
      composition: "主体居中",
      depth_of_field: "背景轻微虚化"
    },
    ocr: [],
    uncertain: [],
    content_safety: sensitive ? {
      level: "nudity",
      body_exposure: "full",
      interaction_category: "none",
      age_assessment: explicitMinor ? "young_or_minor_indicators" : "adult_appearing",
      visible_person_count: 1,
      signals: explicitMinor ? ["nudity", "age_ambiguous"] : ["nudity"],
      sensitive_visible_facts: [explicitMinor ? "儿童全身裸露直接可见" : "该人物乳头直接可见"]
    } : {
      level: "safe",
      body_exposure: "none",
      interaction_category: "none",
      age_assessment: explicitMinor ? "young_or_minor_indicators" : "age_unverifiable",
      visible_person_count: 1,
      signals: [],
      sensitive_visible_facts: []
    }
  };
}

function h3ProviderResult(ir, resultOptions) {
  return {
    data: grokResponsesPublicResult({
      id: "h3-facts",
      model: "grok-contract-test",
      output_text: JSON.stringify(ir),
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
    }, resultOptions),
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    durationMs: 5,
    providerCallCount: 1,
    inputMeta: {}
  };
}

function interactionIncompleteFactsV2({ explicitMinor = false, name = "白发猫耳少女" } = {}) {
  const facts = visualFactsV2({ name });
  facts.entities[0].name = explicitMinor ? "儿童" : name;
  facts.entities[0].action = "右手靠近身体下方";
  facts.relations = ["人物位于床面中央"];
  facts.content_safety = {
    level: "explicit",
    body_exposure: "full",
    interaction_category: "sexual",
    age_assessment: explicitMinor ? "young_or_minor_indicators" : "age_unverifiable",
    visible_person_count: 1,
    signals: explicitMinor
      ? ["nudity", "explicit_activity", "age_ambiguous"]
      : ["nudity", "explicit_activity", "age_ambiguous"],
    sensitive_visible_facts: [explicitMinor ? "儿童裸体与生殖器直接可见" : "人物裸体与生殖器直接可见"]
  };
  return facts;
}

function h3FaithfulRichPrompt() {
  return [
    "[风格设定]",
    "数字绘画与日式动漫渲染，轮廓流畅，皮肤高光和阴影过渡细腻，湿润材质反光清晰，保持原图可见绘画语言。",
    "",
    "[主体物品]",
    "白发猫耳少女拥有银白色长发、白色猫耳和蓝色眼睛，裸体侧卧在床面。女性右手直接握住阴茎，阴茎与女性下体保持接触并呈插入状态，接触位置覆盖透明液体，姿势和可见主体关系保持原图事实。",
    "",
    "[环境背景]",
    "日式室内房间，木质框架和格子拉门位于后景，白色床单处于前景，人物身体占据画面中央并遮挡部分床面。",
    "",
    "[光线与色彩]",
    "右上方暖色自然光照亮人物，皮肤高光呈粉白色，木质结构为深棕色，床单为白色，主体边缘具有明亮轮廓光。",
    "",
    "[拍摄参数]",
    "中近景低角度视角，人物居中并形成对角线构图，躯干和接触位置清晰，背景拉门轻微虚化，镜头固定。"
  ].join("\n");
}

function h3SensitiveCrossSectionRichPrompt() {
  return [
    "[风格设定]",
    "动漫渲染风格，流畅柔和的线条勾勒身体轮廓，皮肤表面呈现湿润光泽质感，毛发丝缕清晰可见。",
    "",
    "[主体物品]",
    "一名成年女性拥有银白色长发、白色猫耳和蓝色眼睛，赤裸身体覆盖透明液体。女性右手握住阴茎，阴茎插入女性阴道，阴道口与阴茎紧密接触。",
    "",
    "[环境背景]",
    "日式室内背景，木质框架与格子拉门位于后景，白色床单位于中景，人物处于画面中心。",
    "",
    "[光线与色彩]",
    "侧上方自然光照射，身体高光呈亮白色反光，阴影落在乳房下方与大腿内侧，整体以粉白肤色和浅棕木色为主。",
    "",
    "[拍摄参数]",
    "近景特写，低角度仰视构图，镜头聚焦于躯干与阴茎和阴道的接触部位，浅景深模糊背景。"
  ].join("\n");
}

function h3OrdinaryRichPrompt() {
  return [
    "[风格设定]",
    "数字绘画与日式动漫渲染，线条流畅，布料和木材纹理清晰。",
    "[主体物品]",
    "银白色长发、白色猫耳和蓝色眼睛的女性角色穿蓝色长袍，端坐在床边，双手自然放在膝上。",
    "[环境背景]",
    "日式室内房间，木质框架和格子拉门处于后景，白色床单位于中景。",
    "[光线与色彩]",
    "右上方暖色自然光形成柔和高光和阴影，整体色调为粉白与浅棕。",
    "[拍摄参数]",
    "中近景平视构图，人物居中，浅景深轻微虚化背景。"
  ].join("\n");
}

function h3ShortFaithfulRichPrompt() {
  return [
    "[风格设定]",
    "日式动漫渲染。",
    "[主体物品]",
    "女性右手握住阴茎，阴茎插入阴道，裸体与接触部位可见。",
    "[环境背景]",
    "日式室内。",
    "[光线与色彩]",
    "暖色侧光。",
    "[拍摄参数]",
    "固定近景。"
  ].join("\n");
}

function h3AliasedRichPrompt() {
  return `${h3FaithfulRichPrompt()
    .replace("[风格设定]", "[风格与设定]")
    .replace("[主体物品]", "[主体与道具]")
    .replace("[环境背景]", "[场景与背景]")
    .replace("[光线与色彩]", "[光影及色彩]")
    .replace("[拍摄参数]", "[镜头与构图]")}\n\n[用户附加要求]\n要求 = \"不能作为视觉事实\"`;
}

function h3AttemptFromText(outputText, resultOptions, id = "h3-attempt") {
  const usage = { input_tokens: 10, output_tokens: 20, total_tokens: 30 };
  try {
    return {
      data: grokResponsesPublicResult({ id, model: "grok-contract-test", output_text: outputText, usage }, resultOptions),
      usage,
      durationMs: 5,
      providerCallCount: 1,
      inputMeta: {}
    };
  } catch (error) {
    error.grokUsage = usage;
    error.grokDurationMs = 5;
    error.grokProviderCallCount = 1;
    throw error;
  }
}

function normalizedInteractionFailure(structuralFacts) {
  const error = new Error("normalized H3 interaction validation failure");
  error.grokVisualIrContractInvalid = true;
  error.grokVisualIrSemantic = true;
  error.grokVisualIrReason = "content_safety_interaction";
  error.h3FailureStage = "visual_facts";
  error.h3FailureReason = "content_safety_interaction";
  error.h3ValidationLeaf = "strict_ir_content_safety_interaction";
  error.h3StructuralVisualFacts = structuralFacts;
  error.grokProviderCallCount = 1;
  error.grokDurationMs = 5;
  return error;
}

function verboseInteractionFailureFactsV2() {
  const facts = interactionIncompleteFactsV2();
  facts.relations = [];
  facts.entities[0].action = "";
  return facts;
}

function prompt(visual, sound = "Soft clothing movement and quiet room tone.") {
  return [
    "<Picture 1> aligns with [Shot 1] at 0.00 seconds.",
    `integrated_multimodal_description: [Shot 1] <Picture 1> ${visual}`,
    `overall_soundscape: ${sound}`,
    "non_diegetic_music: N/A"
  ].join("\n");
}

function stageOptions(request, ir) {
  return {
    ...request.resultOptions,
    minimaxH3Stage: "prompt_compile",
    minimaxH3TrustedVisualIr: ir
  };
}

test("H3 allows an ordinary child reference but blocks every sensitive child combination", () => {
  const request = buildH3({ userPrompt: "A child waves safely in a family room" });
  const childIr = visualIr({ age: "minor" });
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(childIr) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }));
  const safePrompt = prompt("A child in a blue coat stands centered in a quiet wooden interior under soft side light, begins with one hand lowered, then gradually raises it beside the face while the locked camera holds.");
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: safePrompt }, stageOptions(request, childIr)));

  const sensitiveChildIr = visualIr({ age: "minor", level: "nudity", sensitiveFacts: ["the child is fully nude"] });
  const enabled = buildH3();
  assert.throws(() => grokResponsesPublicResult({ output_text: JSON.stringify(sensitiveChildIr) }, {
    ...enabled.resultOptions,
    minimaxH3Stage: "visual_ir"
  }), (error) => error?.failureCategory === "provider_content_policy");
  assert.throws(() => buildH3({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true },
    userRequirements: "under-18 subject in explicit sexual activity"
  }), (error) => error?.failureCategory === "provider_content_policy");
});

test("H3 sensitive context blocks only explicit minor evidence in raw text and IR facts", () => {
  const explicitMinorIndicators = [
    "underage", "minor", "child", "children", "juvenile", "loli", "shota",
    "under-18", "17 years old", "7 y/o", "aged 16",
    "未成年", "未满18岁", "17岁", "儿童", "孩童", "小孩", "幼女", "幼童",
    "幼儿", "婴幼儿", "婴儿", "萝莉", "正太"
  ];
  const enabledPolicy = { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true };
  for (const indicator of explicitMinorIndicators) {
    assert.throws(() => buildH3({
      contentPolicy: enabledPolicy,
      userRequirements: `${indicator} fully nude`
    }), (error) => error?.failureCategory === "provider_content_policy", `raw explicit-minor indicator must block: ${indicator}`);

    const request = buildH3({ contentPolicy: enabledPolicy });
    const sensitiveIr = visualIr({
      age: "adult",
      level: "nudity",
      sensitiveFacts: ["adult is fully nude"]
    });
    sensitiveIr.subjects[0].age_evidence = [`visible ${indicator} appearance`];
    assert.throws(() => grokResponsesPublicResult({ output_text: JSON.stringify(sensitiveIr) }, {
      ...request.resultOptions,
      minimaxH3Stage: "visual_ir"
    }), (error) => error?.failureCategory === "provider_content_policy", `IR explicit-minor fact must block: ${indicator}`);
  }
});

test("H3 ambiguous age and appearance wording never becomes an explicit-minor hard gate", () => {
  const ambiguousAgeIndicators = [
    "teen", "teenage", "teenager", "adolescent", "girl", "boy", "young", "youth",
    "young-looking", "child-like", "少女", "少年", "女孩", "男孩", "年轻", "青少年",
    "幼态", "娃娃脸"
  ];
  for (const indicator of ambiguousAgeIndicators) {
    const safeRequest = buildH3({ userPrompt: `${indicator} waves safely in a family room` });
    assert.equal(safeRequest.resultOptions.explicitYouthUserRequest, false);
    assert.equal(safeRequest.resultOptions.authorizedSensitiveUserRequest, false);
    const sensitiveRequest = buildH3({ userRequirements: `${indicator} fully nude` });
    assert.equal(sensitiveRequest.resultOptions.explicitYouthUserRequest, false);
    assert.equal(sensitiveRequest.resultOptions.authorizedSensitiveUserRequest, true);
  }
  const request = buildH3();
  for (const ageEvidence of [
    "visible teen appearance", "young adult girl appearance", "young-looking adult appearance",
    "少女外观", "年轻成年人少女外观", "娃娃脸"
  ]) {
    const sensitiveIr = visualIr({
      age: "young_looking",
      level: "nudity",
      sensitiveFacts: ["the person is fully nude"]
    });
    sensitiveIr.subjects[0].age_evidence = [ageEvidence];
    assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(sensitiveIr) }, {
      ...request.resultOptions,
      minimaxH3Stage: "visual_ir"
    }), `ambiguous IR evidence must not trigger the age gate: ${ageEvidence}`);
  }
  const fact = "the person is fully nude";
  const youngLookingIr = visualIr({
    age: "young_looking",
    level: "nudity",
    sensitiveFacts: [fact]
  });
  const projectedVisual = `A young-looking person in a blue coat stands centered in a quiet wooden interior under soft side light, begins with one hand lowered, then gradually raises it beside the face while the locked camera holds. ${fact}.`;
  assert.doesNotThrow(() => grokResponsesPublicResult({
    output_text: prompt(projectedVisual)
  }, stageOptions(request, youngLookingIr)));
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(projectedVisual.replace("young-looking person", "minor"))
  }, stageOptions(request, youngLookingIr)), (error) => error?.failureCategory === "provider_content_policy");
});

test("H3 raw sensitive authorization ignores negated requests in English and Chinese", () => {
  for (const userRequirements of [
    "no nudity; keep the blue coat",
    "without sexual activity, preserve the quiet room",
    "不要裸露，保持蓝色外套",
    "禁止性行为；只让角色挥手"
  ]) {
    const request = buildH3({ userRequirements });
    assert.equal(request.resultOptions.authorizedSensitiveUserRequest, false);
  }
  const noConfirmation = buildH3({
    userRequirements: "adult nudity",
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false }
  });
  assert.equal(noConfirmation.resultOptions.authorizedSensitiveUserRequest, true);
  const affirmative = buildH3({
    userRequirements: "不要裸露，但是成年人物明确自慰",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  assert.equal(affirmative.resultOptions.authorizedSensitiveUserRequest, true);
  assert.deepEqual(affirmative.resultOptions.contentPolicy, {
    sensitiveVisualAnalysis: true,
    allSubjectsConfirmedAdult: false
  });
});

test("H3 facts-first projection preserves sensitive IR when age is unverifiable without adult confirmation", () => {
  const fact = "the person is fully nude";
  const request = buildH3({
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false }
  });
  const ir = visualIr({
    age: "age_unverifiable",
    level: "nudity",
    sensitiveFacts: [fact]
  });
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(ir) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }));
  const chineseUnverifiableIr = visualIr({
    age: "age_unverifiable",
    level: "nudity",
    sensitiveFacts: [fact]
  });
  chineseUnverifiableIr.subjects[0].age_evidence = ["无法从可见细节判断是成年人还是未成年人"];
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(chineseUnverifiableIr) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }));
  for (const uncertainAgeEvidence of [
    "minor status cannot be verified from the image",
    "the person could be a teen or an adult",
    "未成年状态不可核验"
  ]) {
    const uncertaintyOnlyIr = visualIr({
      age: "age_unverifiable",
      level: "nudity",
      sensitiveFacts: [fact]
    });
    uncertaintyOnlyIr.subjects[0].age_evidence = [uncertainAgeEvidence];
    assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(uncertaintyOnlyIr) }, {
      ...request.resultOptions,
      minimaxH3Stage: "visual_ir"
    }), `uncertainty alone must not become explicit youth evidence: ${uncertainAgeEvidence}`);
  }
  const ambiguousYouthIr = visualIr({
    age: "age_unverifiable",
    level: "nudity",
    sensitiveFacts: [fact]
  });
  ambiguousYouthIr.subjects[0].age_evidence = ["visible teen appearance, although exact age cannot be determined"];
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(ambiguousYouthIr) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }));
  const uncertainCandidateIr = visualIr({
    age: "age_unverifiable",
    level: "nudity",
    sensitiveFacts: [fact]
  });
  uncertainCandidateIr.uncertain = ["the person might be a minor, but the image does not establish age"];
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(uncertainCandidateIr) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }));
  for (const uncertainVisibleFact of [
    "the person could be a minor or an adult",
    "无法确认该人物是否未成年"
  ]) {
    const visibleUncertaintyIr = visualIr({
      age: "age_unverifiable",
      level: "nudity",
      sensitiveFacts: [fact]
    });
    visibleUncertaintyIr.subjects[0].visible_facts = ["person wearing a blue coat", uncertainVisibleFact];
    assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(visibleUncertaintyIr) }, {
      ...request.resultOptions,
      minimaxH3Stage: "visual_ir"
    }), `uncertain visible wording must not become explicit-minor evidence: ${uncertainVisibleFact}`);
  }
  const explicitChildFactIr = visualIr({
    age: "age_unverifiable",
    level: "nudity",
    sensitiveFacts: [fact]
  });
  explicitChildFactIr.subjects[0].visible_facts = ["person wearing a blue coat", "the subject is a child"];
  assert.throws(() => grokResponsesPublicResult({ output_text: JSON.stringify(explicitChildFactIr) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }), (error) => error?.failureCategory === "provider_content_policy");
  const neutralVisual = `A person in a blue coat stands centered in a quiet wooden interior under soft side light, begins with one hand lowered, then gradually raises it beside the face while the locked camera holds. ${fact}.`;
  assert.doesNotThrow(() => grokResponsesPublicResult({
    output_text: prompt(neutralVisual)
  }, stageOptions(request, ir)));
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(neutralVisual.replace(` ${fact}.`, ""))
  }, stageOptions(request, ir)), (error) => error?.errorCode === "h3_contract_sensitive_fidelity");
});

test("H3 adult IR does not force an adult label over a faithful 白发猫耳少女 sensitive fact", () => {
  const fact = "白发猫耳少女全裸，乳头清晰可见";
  const request = buildH3();
  const ir = visualIr({ age: "adult", level: "nudity", sensitiveFacts: [fact] });
  ir.subjects[0].visible_facts = ["white hair and cat ears"];
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: JSON.stringify(ir) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }));
  const faithfulVisual = `A white-haired cat-eared figure stands centered in a quiet wooden interior under soft side light, begins with one hand lowered, then gradually raises it beside the face while the locked camera holds. ${fact}.`;
  assert.doesNotThrow(() => grokResponsesPublicResult({
    output_text: prompt(faithfulVisual)
  }, stageOptions(request, ir)));

  const explicitMinorIr = visualIr({ age: "minor", level: "nudity", sensitiveFacts: [fact] });
  explicitMinorIr.subjects[0].visible_facts = ["white hair and cat ears"];
  assert.throws(() => grokResponsesPublicResult({ output_text: JSON.stringify(explicitMinorIr) }, {
    ...request.resultOptions,
    minimaxH3Stage: "visual_ir"
  }), (error) => error?.failureCategory === "provider_content_policy");
});

test("H3 final projection is category-scoped and keeps required IR facts inside the integrated field", () => {
  const fact = "adult is fully nude";
  const request = buildH3({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true }
  });
  const ir = visualIr({ level: "nudity", sensitiveFacts: [fact] });
  const baseVisual = "An adult in a blue coat stands centered in a quiet wooden interior under soft side light, begins with one hand lowered, then gradually raises it beside the face while the locked camera holds.";
  assert.doesNotThrow(() => grokResponsesPublicResult({
    output_text: prompt(`${baseVisual} ${fact}.`)
  }, stageOptions(request, ir)));
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(baseVisual, `Quiet room tone; ${fact}.`)
  }, stageOptions(request, ir)), (error) => error?.errorCode === "h3_contract_sensitive_fidelity");
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(`${baseVisual} ${fact}; visible genitals.`)
  }, stageOptions(request, ir)), (error) => error?.errorCode === "h3_contract_sensitive_projection");

  const authorized = buildH3({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true },
    userRequirements: "adult fully nude with visible genitals"
  });
  const ordinaryIr = visualIr();
  assert.doesNotThrow(() => grokResponsesPublicResult({
    output_text: prompt(`${baseVisual} The adult is fully nude with visible genitals.`)
  }, stageOptions(authorized, ordinaryIr)));
});

test("H3 final projection rejects generic or wrong-frame prompts that omit verified ordinary facts", () => {
  const request = buildH3();
  const ir = visualIr();
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt("A cinematic subject begins moving, then finishes while the locked camera holds.")
  }, stageOptions(request, ir)), (error) => error?.errorCode === "h3_contract_visual_fidelity");
});

test("H3 ordinary projection preserves age, clothing, scene, action, and audio across Chinese-English synonyms", () => {
  const request = buildH3({ userPrompt: "A child waves safely in a family room" });
  const ir = visualIr({ age: "minor" });
  const bilingual = prompt(
    "一个小孩穿着蓝色外套站在安静的木质室内，柔和侧光照亮人物；一只手起初垂下，随后逐渐举到脸旁，镜头固定。",
    "轻微衣物摩擦声与安静室内环境声。"
  ).replace("non_diegetic_music: N/A", "non_diegetic_music: 无配乐");
  assert.doesNotThrow(() => grokResponsesPublicResult({
    output_text: bilingual
  }, stageOptions(request, ir)));

  const adultSwap = prompt("An adult in a blue coat stands in a quiet wooden interior under soft side light, one hand starts lowered and gradually raises beside the face while the locked camera holds.");
  assert.throws(() => grokResponsesPublicResult({
    output_text: adultSwap
  }, stageOptions(request, ir)), (error) => ["h3_contract_visual_fidelity", "h3_contract_visual_projection"].includes(error?.errorCode));

  const inventedWorld = prompt(
    "A child alien in a blue coat stands in a stadium under soft side light, one hand starts lowered and gradually raises beside the face while the locked camera holds.",
    "A loud explosion and quiet room tone."
  );
  assert.throws(() => grokResponsesPublicResult({
    output_text: inventedWorld
  }, stageOptions(request, ir)), (error) => ["h3_contract_visual_fidelity", "h3_contract_audio_fidelity", "h3_contract_visual_projection"].includes(error?.errorCode));
});

test("H3 sensitive projection rejects category and anatomy upgrades", () => {
  const enabled = (userRequirements = "") => buildH3({
    userRequirements,
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true }
  });
  const baseVisual = "An adult in a blue coat stands in a quiet wooden interior under soft side light, one hand starts lowered and gradually raises beside the face while the locked camera holds.";

  const nudityFact = "adult is fully nude";
  const nudityIr = visualIr({ level: "nudity", sensitiveFacts: [nudityFact] });
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(`${baseVisual} ${nudityFact}; the adult performs explicit sexual activity.`)
  }, stageOptions(enabled(), nudityIr)), (error) => error?.errorCode === "h3_contract_sensitive_projection");

  const nippleFact = "adult nipples are directly visible";
  const nippleIr = visualIr({ level: "nudity", sensitiveFacts: [nippleFact] });
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(`${baseVisual} ${nippleFact}; visible genitals replace the nipple detail.`)
  }, stageOptions(enabled(), nippleIr)), (error) => error?.errorCode === "h3_contract_sensitive_projection");

  const rawNudity = enabled("adult is fully nude");
  assert.throws(() => grokResponsesPublicResult({
    output_text: prompt(`${baseVisual} The adult is fully nude and performs sexual activity.`)
  }, stageOptions(rawNudity, visualIr())), (error) => error?.errorCode === "h3_contract_sensitive_projection");
});

test("H3 preflight envelopes are sanitized, keep safe status, and never charge provider calls", () => {
  let safetyError;
  try {
    buildH3({ userRequirements: "under-18 subject in explicit sexual activity" });
  } catch (error) {
    safetyError = error;
  }
  const blocked = miniMaxH3ReversePreflightFailure({ purpose: "minimax-h3-i2v-reverse" }, safetyError);
  assert.equal(blocked.httpStatus, 422);
  assert.equal(blocked.envelope.failureCategory, "provider_content_policy");
  assert.equal(blocked.envelope.retryable, false);
  assert.equal(blocked.envelope.providerCallCount, 0);
  assert.doesNotMatch(JSON.stringify(blocked), /under-18|sexual activity/);

  const internal = miniMaxH3ReversePreflightFailure(
    { purpose: "minimax-h3-fl2v-reverse" },
    new Error("sentinel-secret")
  );
  assert.equal(internal.httpStatus, 500);
  assert.equal(internal.envelope.errorCode, "provider_http");
  assert.equal(internal.envelope.providerCallCount, 0);
  assert.doesNotMatch(JSON.stringify(internal), /sentinel-secret/);
  assert.equal(miniMaxH3ReversePreflightFailure({ purpose: "static-image-reverse" }, new Error("ordinary")), null);
});

test.skip("H3 I2VA uses one strict visual-fact call and deterministically compiles exact three fields", async () => {
  const request = buildH3({
    userPrompt: "角色缓慢举起右手，镜头固定",
    preferredOutputLanguage: "zh-CN"
  });
  assert.equal(request.resultOptions.requiredProviderCalls, 1);
  assert.equal(request.resultOptions.h3VisualBodies.length, 1);
  assert.equal(request.resultOptions.h3VisualBodies[0].input[0].content.filter((item) => item.type === "input_image").length, 1);
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async () => {
      calls += 1;
      return h3ProviderResult(visualFactsV2(), request.resultOptions);
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.h3BaselineStageCount, 1);
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assert.match(result.data.output_text, /^integrated_multimodal_description: \[Shot 1\] <Picture 1>/);
  assert.equal(result.data.output_text.split("\n").length, 3);
  for (const fact of ["银白色长发", "白色猫耳", "日式房间", "右手自然下垂", "角色缓慢举起右手", "镜头固定"]) {
    assert.match(result.data.output_text, new RegExp(fact));
  }
  assert.doesNotMatch(result.data.output_text, /^<Picture 1>/);
});

test.skip("H3 I2VA recovers incomplete interaction evidence through one faithful rich confirmation", async () => {
  const request = buildH3({
    userPrompt: "保持首帧主体与镜头，动作连续推进",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(
        calls === 1
          ? JSON.stringify(interactionIncompleteFactsV2())
          : h3AliasedRichPrompt(),
        resultOptions,
        `h3-rich-${calls}`
      );
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.h3ContractRepairUsed, true);
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assert.equal(result.data.output_text.split("\n").length, 3);
  assert.match(result.data.output_text, /^integrated_multimodal_description: \[Shot 1\] <Picture 1>/);
  for (const fact of ["白发猫耳少女", "银白色长发", "日式房间", "直接握住", "插入", "阴茎", "透明液体", "平视"]) {
    assert.match(result.data.output_text, new RegExp(fact));
  }
});

test.skip("H3 I2VA routes normalized content_safety_interaction through one rich confirmation instead of a second strict call", async () => {
  const request = buildH3({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  const attemptBodies = [];
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async (attemptBody) => {
      attemptBodies.push(attemptBody);
      if (attemptBodies.length === 1) throw normalizedInteractionFailure(interactionIncompleteFactsV2());
      return h3AttemptFromText(h3FaithfulRichPrompt(), resultOptions, "h3-normalized-rich");
    }
  );
  assert.equal(attemptBodies.length, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.h3ContractRepairUsed, true);
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assert.equal(result.data.output_text.split("\n").length, 3);
  const richBodyText = JSON.stringify(attemptBodies[1]);
  assert.match(richBodyText, /MiniMax H3 互动事实确认补充约束/);
  assert.match(richBodyText, /五个 section 标题/);
  assert.doesNotMatch(richBodyText, /Return exactly one strict JSON object matching this schema/);
});

test.skip("H3 I2VA captures structurally valid facts when a verbose interaction reason normalizes to content_safety_interaction", async () => {
  const request = buildH3({
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  const verboseFacts = verboseInteractionFailureFactsV2();
  assert.throws(
    () => grokResponsesPublicResult({ output_text: JSON.stringify(verboseFacts) }, resultOptions),
    (error) => error?.grokVisualIrReason === "non-none interaction requires relations or entity.action"
      && error?.h3FailureReason === "content_safety_interaction"
      && error?.h3StructuralVisualFacts?.schema === "nf.visual.v2"
  );
  const attemptBodies = [];
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async (attemptBody) => {
      attemptBodies.push(attemptBody);
      return h3AttemptFromText(
        attemptBodies.length === 1
          ? JSON.stringify(verboseFacts)
          : h3FaithfulRichPrompt(),
        resultOptions,
        `h3-verbose-interaction-${attemptBodies.length}`
      );
    }
  );
  assert.equal(attemptBodies.length, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.h3ContractRepairUsed, true);
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assert.equal(result.data.output_text.split("\n").length, 3);
  assert.match(JSON.stringify(attemptBodies[0]), /novaflow_visual_v2/);
  assert.match(JSON.stringify(attemptBodies[1]), /MiniMax H3 互动事实确认补充约束/);
  assert.doesNotMatch(JSON.stringify(attemptBodies[1]), /Return exactly one strict JSON object matching this schema/);
});

test.skip("H3 rich recovery accepts short concrete five-section evidence and canonical projection", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  const shortRich = h3ShortFaithfulRichPrompt();
  assert.ok(shortRich.length < 300);
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(
        calls === 1 ? JSON.stringify(interactionIncompleteFactsV2()) : shortRich,
        resultOptions,
        `h3-rich-short-${calls}`
      );
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.data.output_text.split("\n").length, 3);
  assert.match(result.data.output_text, /握住|插入/);
});

test.skip("H3 rich projection fills missing ordinary appearance, scene, light, and camera facts", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  const sparse = interactionIncompleteFactsV2({ name: "角色" });
  sparse.entities[0].appearance = [];
  sparse.entities[0].materials = [];
  sparse.entities[0].colors = [];
  sparse.scene = { environment: "", background: "", spatial_layers: [] };
  sparse.look = { lighting: [], palette: [], materials: [], style: [], atmosphere: "", finish: "" };
  sparse.camera_cues = { shot: "", angle: "", composition: "", depth_of_field: "" };
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(
        calls === 1 ? JSON.stringify(sparse) : h3FaithfulRichPrompt(),
        resultOptions,
        `h3-rich-ordinary-${calls}`
      );
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.data.output_text.split("\n").length, 3);
  for (const fact of ["银白色长发", "白色猫耳", "蓝色眼睛", "日式室内房间", "暖色自然光", "中近景低角度视角"]) {
    assert.match(result.data.output_text, new RegExp(fact));
  }
});

test.skip("H3 rich projection preserves conflicting initial ordinary facts", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  const initial = interactionIncompleteFactsV2({ name: "黑发兔耳女性角色" });
  initial.entities[0].appearance = ["黑色短发", "绿色眼睛", "兔耳"];
  initial.entities[0].colors = ["黑色", "绿色"];
  initial.scene = { environment: "现代室内房间", background: "现代墙面", spatial_layers: [] };
  initial.look.lighting = ["冷色硬光"];
  initial.look.palette = ["冷色调"];
  initial.camera_cues = { shot: "全景", angle: "高角度俯拍", composition: "主体居中", depth_of_field: "深景深" };
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(
        calls === 1 ? JSON.stringify(initial) : h3FaithfulRichPrompt(),
        resultOptions,
        `h3-rich-conflict-${calls}`
      );
    }
  );
  const output = result.data.output_text;
  for (const fact of ["黑色短发", "绿色眼睛", "兔耳", "现代室内房间", "冷色硬光", "全景", "高角度俯拍", "深景深"]) {
    assert.match(output, new RegExp(fact));
  }
  for (const conflict of ["银白色长发", "白色猫耳", "蓝色眼睛", "日式室内房间", "暖色自然光", "中近景低角度视角", "背景拉门轻微虚化"]) {
    assert.doesNotMatch(output, new RegExp(conflict));
  }
});

test("H3 rich recovery still rejects empty and generic five-section text", () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const richOptions = { ...request.resultOptions, minimaxH3RichVisualStage: true };
  assert.throws(
    () => grokResponsesPublicResult({ output_text: "" }, richOptions),
    (error) => error?.h3ValidationLeaf === "rich_empty"
  );
  const generic = [
    "[风格设定]", "普通风格。",
    "[主体物品]", "画面有一个主体。",
    "[环境背景]", "室内背景。",
    "[光线与色彩]", "柔和光线。",
    "[拍摄参数]", "固定镜头。"
  ].join("\n");
  assert.throws(
    () => grokResponsesPublicResult({ output_text: generic }, richOptions),
    (error) => error?.h3ValidationLeaf === "rich_section_1_facts_missing"
  );
});

test.skip("H3 rich confirmation fails closed and never starts a second recovery", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  let calls = 0;
  let failure = null;
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      request.body,
      request.inputMeta,
      resultOptions,
      async () => {
        calls += 1;
        return h3AttemptFromText(
          calls === 1 ? JSON.stringify(interactionIncompleteFactsV2()) : "[风格设定]\n不完整",
          resultOptions,
          `h3-rich-invalid-${calls}`
        );
      }
    ),
    (error) => {
      failure = error;
      return error?.h3FailureStage === "visual_facts";
    }
  );
  assert.equal(calls, 2);
  assert.equal(failure?.h3ValidationLeaf, "rich_section_count");
  const envelope = miniMaxH3FailureEnvelope(failure);
  assert.equal(envelope.validationLeaf, "rich_section_count");
  assert.doesNotMatch(JSON.stringify(envelope), /h3StructuralVisualFacts|output_text|visible_facts|sensitive_visible_facts/);
});

test.skip("H3 rich projection failure reports the bounded canonical strict-IR leaf", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  const facts = interactionIncompleteFactsV2();
  facts.scene.environment = "日式成人性行为房间";
  let failure = null;
  let calls = 0;
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      request.body,
      request.inputMeta,
      resultOptions,
      async () => {
        calls += 1;
        return h3AttemptFromText(
          calls === 1 ? JSON.stringify(facts) : h3FaithfulRichPrompt(),
          resultOptions,
          `h3-rich-canonical-leaf-${calls}`
        );
      }
    ),
    (error) => {
      failure = error;
      return error?.h3FailureStage === "visual_facts";
    }
  );
  assert.equal(calls, 2);
  assert.equal(failure?.h3ValidationLeaf, "strict_ir_visual_semantic_contract");
  assert.match(failure.h3ValidationLeaf, /^[a-z0-9_]{3,80}$/);
  assert.notEqual(failure.h3ValidationLeaf, "rich_projection_canonical_v2_invalid");
  const envelope = miniMaxH3FailureEnvelope(failure);
  assert.equal(envelope.validationLeaf, "strict_ir_visual_semantic_contract");
});

test("H3 validation envelope reports bounded strict IR leaf without raw visual facts", () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  let failure = null;
  assert.throws(
    () => grokResponsesPublicResult({ output_text: JSON.stringify(interactionIncompleteFactsV2()) }, request.resultOptions),
    (error) => {
      failure = error;
      return error?.h3ValidationLeaf === "strict_ir_content_safety_interaction";
    }
  );
  const envelope = miniMaxH3FailureEnvelope(failure);
  assert.equal(envelope.validationLeaf, "strict_ir_content_safety_interaction");
  assert.doesNotMatch(JSON.stringify(envelope), /h3StructuralVisualFacts|output_text|visible_facts|sensitive_visible_facts/);
});

test.skip("H3 rich section canonicalization never repairs missing, extra, reordered, or unknown sections", async () => {
  const canonical = h3FaithfulRichPrompt();
  const invalidVariants = [
    canonical.replace("[环境背景]\n", ""),
    canonical.replace("[环境背景]", "[环境背景]\n额外 = \"噪声\"\n\n[附加分析]"),
    canonical
      .replace("[主体物品]", "[临时标题]")
      .replace("[环境背景]", "[主体物品]")
      .replace("[临时标题]", "[环境背景]"),
    canonical.replace("[主体物品]", "[未知主体分类]")
  ];
  for (const candidate of invalidVariants) {
    const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
    const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
    let calls = 0;
    await assert.rejects(
      callGrokResponseWithVisualRetry(
        request.body,
        request.inputMeta,
        resultOptions,
        async () => {
          calls += 1;
          return h3AttemptFromText(
            calls === 1 ? JSON.stringify(interactionIncompleteFactsV2()) : candidate,
            resultOptions,
            `h3-invalid-section-${calls}`
          );
        }
      ),
      (error) => error?.h3FailureStage === "visual_facts"
    );
    assert.equal(calls, 2);
  }
});

test.skip("H3 blocks explicit minor sensitive partial facts before rich confirmation", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  for (const normalizedReason of [false, true]) {
    const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
    let calls = 0;
    await assert.rejects(
      callGrokResponseWithVisualRetry(
        request.body,
        request.inputMeta,
        resultOptions,
        async () => {
          calls += 1;
          const facts = interactionIncompleteFactsV2({ explicitMinor: true });
          if (normalizedReason) throw normalizedInteractionFailure(facts);
          return h3AttemptFromText(JSON.stringify(facts), resultOptions);
        }
      ),
      (error) => error?.failureCategory === "provider_content_policy"
        && error?.h3FailureReason === "explicit_minor_sensitive"
    );
    assert.equal(calls, 1);
  }
});

test.skip("H3 deterministic I2VA serializer follows the requested English output language", async () => {
  const request = buildH3({
    userPrompt: "The character slowly raises her right hand; keep the camera locked",
    preferredOutputLanguage: "en"
  });
  const facts = visualFactsV2({
    name: "white-haired cat-eared character",
    action: "right hand rests beside the body",
    environment: "Japanese-style room"
  });
  facts.entities[0].appearance = ["long silver-white hair", "white cat ears", "blue eyes", "blue coat"];
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async () => h3ProviderResult(facts, request.resultOptions)
  );
  assert.match(result.data.output_text, /^integrated_multimodal_description: \[Shot 1\] <Picture 1> is the exact opening frame/);
  assert.match(result.data.output_text, /white-haired cat-eared character/);
  assert.match(result.data.output_text, /The character slowly raises her right hand/);
  assert.match(result.data.output_text, /overall_soundscape: Use only user-supplied sound/);
  assert.doesNotMatch(result.data.output_text, /已验证可见事实|仅使用用户明确要求/);
});

test.skip("H3 FL2VA analyzes each endpoint independently and preserves frame-scoped facts", async () => {
  const first = { dataUrl: "data:image/png;base64,FIRST", role: "first_frame", label: "first frame" };
  const last = { dataUrl: "data:image/png;base64,LAST", role: "last_frame", label: "last frame" };
  const request = buildH3({
    purpose: "minimax-h3-fl2v-reverse",
    durationSeconds: 8,
    userPrompt: "角色连续抬起长剑，镜头固定",
    images: [last, first]
  });
  assert.equal(request.resultOptions.requiredProviderCalls, 2);
  assert.equal(request.resultOptions.h3VisualBodies.length, 2);
  assert.deepEqual(
    request.resultOptions.h3VisualBodies.map((frameBody) => frameBody.input[0].content[0].image_url),
    [first.dataUrl, last.dataUrl]
  );
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async (attemptBody) => {
      calls += 1;
      const imageUrl = attemptBody.input[0].content[0].image_url;
      return h3ProviderResult(
        imageUrl === first.dataUrl
          ? visualFactsV2({ action: "长剑保持低位", environment: "古代庭院" })
          : visualFactsV2({ action: "长剑举至头顶", environment: "古代庭院" }),
        request.resultOptions
      );
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.h3BaselineStageCount, 2);
  assert.match(result.data.output_text, /^integrated_multimodal_description:/);
  assert.match(result.data.output_text, /<Picture 1>：[^\n]*长剑保持低位/);
  assert.match(result.data.output_text, /<Picture 2>：[^\n]*长剑举至头顶/);
  assert.match(result.data.output_text, /\[Shot 2\] At 00:08\.000, <Picture 2>/);
  assert.equal(result.data.output_text.split("\n").length, 3);
});

test.skip("H3 FL2VA recovers one endpoint with rich facts while preserving frame scope", async () => {
  const first = { dataUrl: "data:image/png;base64,FIRST-SAFE", role: "first_frame", label: "first frame" };
  const last = { dataUrl: "data:image/png;base64,LAST-RICH", role: "last_frame", label: "last frame" };
  const request = buildH3({
    purpose: "minimax-h3-fl2v-reverse",
    durationSeconds: 8,
    images: [first, last],
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      if (calls === 1) return h3ProviderResult(visualFactsV2({ action: "长剑保持低位", environment: "古代庭院" }), resultOptions);
      if (calls === 2) throw normalizedInteractionFailure(interactionIncompleteFactsV2());
      return h3AttemptFromText(h3FaithfulRichPrompt(), resultOptions, `h3-fl-one-rich-${calls}`);
    }
  );
  assert.equal(calls, 3);
  assert.equal(result.providerCallCount, 3);
  assert.equal(result.h3ContractRepairUsed, true);
  assert.match(result.data.output_text, /<Picture 1>：[^\n]*长剑保持低位/);
  assert.match(result.data.output_text, /<Picture 2>：[^\n]*透明液体/);
  assert.match(result.data.output_text, /\[Shot 2\] At 00:08\.000, <Picture 2>/);
  assert.equal(result.data.output_text.split("\n").length, 3);
});

test.skip("H3 FL2VA allows only one global rich recovery and never makes a fourth call", async () => {
  const first = { dataUrl: "data:image/png;base64,FIRST-PARTIAL", role: "first_frame", label: "first frame" };
  const last = { dataUrl: "data:image/png;base64,LAST-PARTIAL", role: "last_frame", label: "last frame" };
  const request = buildH3({
    purpose: "minimax-h3-fl2v-reverse",
    images: [first, last],
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const resultOptions = { ...request.resultOptions, h3RepairAllowed: true };
  let calls = 0;
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      request.body,
      request.inputMeta,
      resultOptions,
      async () => {
        calls += 1;
        return h3AttemptFromText(
          calls === 2 ? h3FaithfulRichPrompt() : JSON.stringify(interactionIncompleteFactsV2()),
          resultOptions,
          `h3-fl-rich-${calls}`
        );
      }
    ),
    (error) => error?.h3FailureStage === "visual_facts"
      && error?.grokProviderCallCount === 3
  );
  assert.equal(calls, 3);
});

test.skip("H3 strict visual facts preserve ambiguous labels but block explicit minor plus sensitive facts", async () => {
  const allowed = buildH3({
    userPrompt: "保持镜头固定",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const allowedResult = await callGrokResponseWithVisualRetry(
    allowed.body,
    allowed.inputMeta,
    allowed.resultOptions,
    async () => h3ProviderResult(visualFactsV2({ name: "白发猫耳少女", sensitive: true }), allowed.resultOptions)
  );
  assert.match(allowedResult.data.output_text, /白发猫耳少女/);
  assert.match(allowedResult.data.output_text, /乳头直接可见/);

  const blocked = buildH3({
    userPrompt: "保持镜头固定",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      blocked.body,
      blocked.inputMeta,
      blocked.resultOptions,
      async () => h3ProviderResult(visualFactsV2({ sensitive: true, explicitMinor: true }), blocked.resultOptions)
    ),
    (error) => error?.failureCategory === "provider_content_policy"
      && error?.h3FailureStage === "safety_policy"
      && error?.h3FailureReason === "explicit_minor_sensitive"
  );
});

test.skip("H3 strict visual-fact failure returns only safe stage and leaf reason", async () => {
  const request = buildH3();
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      request.body,
      request.inputMeta,
      { ...request.resultOptions, h3RepairAllowed: false },
      async () => {
        try {
          grokResponsesPublicResult({ output_text: '{"schema":"nf.visual.v2"}' }, request.resultOptions);
        } catch (error) {
          error.grokProviderCallCount = 1;
          throw error;
        }
      }
    ),
    (error) => error?.errorCode === "h3_contract_visual_ir_structure"
      && error?.h3FailureStage === "visual_facts"
      && error?.h3FailureReason === "visual_structure_contract"
      && !/\{"schema"/.test(error?.message || "")
  );
});

// The reverse output layout: one alignment line, then each official field once; FL2VA stays one shot.
function assertH3ReverseLayout(text, mode = "image_video") {
  const [alignment, ...rest] = text.split("\n\n");
  assert.match(alignment, mode === "first_last" ? /<Picture 1>.*\[Shot 1\].*0\.00.*<Picture 2>.*8\.00/ : /^[^\n]*<Picture 1>[^\n]*\[Shot 1\][^\n]*0\.00/);
  assert.match(rest.join("\n\n"), /^integrated_multimodal_description: \[Shot 1\] /);
  for (const field of ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"]) {
    assert.equal(text.split(`\n${field}: `).length - 1, 1, field);
  }
  assert.doesNotMatch(text, /\[Shot 2\]/);
}

test("H3 rich-primary I2VA uses exactly one provider call and preserves the five-block visual facts", async () => {
  const request = buildH3({
    userPrompt: "保持首帧身份与构图，动作连续推进",
    preferredOutputLanguage: "zh-CN",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  assert.equal(request.resultOptions.requiredProviderCalls, 1);
  assert.equal(request.resultOptions.h3VisualBodies.length, 1);
  assert.equal(request.body.text, undefined);
  assert.equal(request.body.input[0].content.filter((item) => item.type === "input_image").length, 1);
  const providerPrompt = request.body.input[0].content.find((item) => item.type === "input_text")?.text || "";
  for (const section of ["[风格设定]", "[主体物品]", "[环境背景]", "[光线与色彩]", "[拍摄参数]"]) {
    assert.match(providerPrompt, new RegExp(section.replace(/[\[\]]/g, "\\$&")));
  }
  assert.doesNotMatch(providerPrompt, /Return exactly one strict JSON object|novaflow_visual_v2/);

  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(h3FaithfulRichPrompt(), request.resultOptions, "h3-rich-primary-i2");
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.h3BaselineStageCount, 1);
  assert.equal(result.h3ContractRepairUsed, false);
  assert.equal(result.h3RetryCount, 0);
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assertH3ReverseLayout(result.data.output_text);
  for (const fact of [
    "银白色长发", "白色猫耳", "蓝色眼睛", "日式室内房间", "木质框架", "白色床单",
    "右上方暖色自然光", "中近景低角度视角", "对角线构图", "右手直接握住", "插入", "透明液体"
  ]) {
    assert.match(result.data.output_text, new RegExp(fact));
  }
});

test("H3 rich-primary deterministically archives sensitive light and camera clauses without crossing the projection boundary", async () => {
  const request = buildH3({
    preferredOutputLanguage: "zh-CN",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(h3SensitiveCrossSectionRichPrompt(), request.resultOptions, "h3-rich-cross-section");
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.h3ContractRepairUsed, false);
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assertH3ReverseLayout(result.data.output_text);
  for (const fact of [
    "银白色长发", "白色猫耳", "蓝色眼睛", "日式室内背景", "侧上方自然光", "低角度仰视构图", "插入"
  ]) {
    assert.match(result.data.output_text, new RegExp(fact));
  }
});

test("H3 rich-primary derives an ordinary safe contract from ordinary five-block evidence", async () => {
  const request = buildH3({
    preferredOutputLanguage: "zh-CN",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(h3OrdinaryRichPrompt(), request.resultOptions, "h3-rich-ordinary");
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.h3ContractRepairUsed, false);
  assertH3ReverseLayout(result.data.output_text);
  for (const fact of ["银白色长发", "白色猫耳", "蓝色眼睛", "蓝色长袍", "日式室内房间", "右上方暖色自然光", "中近景平视构图"]) {
    assert.match(result.data.output_text, new RegExp(fact));
  }
  assert.doesNotMatch(result.data.output_text, /裸体|裸露|阴茎|阴道|性行为|sexual|nude|naked/i);
});

test("H3 rich-primary FL2VA uses one call per endpoint and no repair budget", async () => {
  const first = { dataUrl: "data:image/png;base64,FIRST-RICH", role: "first_frame", label: "first frame" };
  const last = { dataUrl: "data:image/png;base64,LAST-RICH", role: "last_frame", label: "last frame" };
  const request = buildH3({
    purpose: "minimax-h3-fl2v-reverse",
    durationSeconds: 8,
    images: [first, last],
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  assert.equal(request.resultOptions.requiredProviderCalls, 2);
  assert.equal(request.resultOptions.h3VisualBodies.length, 2);
  assert.ok(request.resultOptions.h3VisualBodies.every((body) => body.text === undefined));
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async (attemptBody) => {
      calls += 1;
      const imageUrl = attemptBody.input[0].content.find((item) => item.type === "input_image")?.image_url;
      const rich = imageUrl === first.dataUrl
        ? h3FaithfulRichPrompt().replace("裸体侧卧在床面", "裸体侧卧在床面，右手保持低位")
        : h3FaithfulRichPrompt().replace("裸体侧卧在床面", "裸体侧卧在床面，右手抬至胸前");
      return h3AttemptFromText(rich, request.resultOptions, `h3-rich-primary-fl-${calls}`);
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.h3BaselineStageCount, 2);
  assert.equal(result.h3ContractRepairUsed, false);
  assert.equal(result.h3RetryCount, 0);
  assertH3ReverseLayout(result.data.output_text, "first_last");
  assert.match(result.data.output_text, /<Picture 2>/);
  assert.match(result.data.output_text, /右手保持低位/);
  assert.match(result.data.output_text, /右手抬至胸前/);
});

test("H3 rich-primary fails closed after one call for generic output and never repairs", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  let calls = 0;
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      request.body,
      request.inputMeta,
      request.resultOptions,
      async () => {
        calls += 1;
        return h3AttemptFromText([
          "[风格设定]", "普通风格。",
          "[主体物品]", "画面有一个主体。",
          "[环境背景]", "室内背景。",
          "[光线与色彩]", "柔和光线。",
          "[拍摄参数]", "固定镜头。"
        ].join("\n"), request.resultOptions, "h3-rich-primary-generic");
      }
    ),
    (error) => error?.h3FailureStage === "visual_facts"
      && error?.grokProviderCallCount === 1
      && error?.h3ContractRepairUsed === false
  );
  assert.equal(calls, 1);
});

test("H3 rich-primary blocks explicit minor plus sensitive facts after one call", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const explicitMinorRich = h3FaithfulRichPrompt().replace("白发猫耳少女", "明确未成年儿童");
  let calls = 0;
  await assert.rejects(
    callGrokResponseWithVisualRetry(
      request.body,
      request.inputMeta,
      request.resultOptions,
      async () => {
        calls += 1;
        return h3AttemptFromText(explicitMinorRich, request.resultOptions, "h3-rich-primary-minor");
      }
    ),
    (error) => error?.failureCategory === "provider_content_policy"
      && error?.h3FailureReason === "explicit_minor_sensitive"
      && error?.grokProviderCallCount === 1
  );
  assert.equal(calls, 1);
});

// A faithful subject line does not have to use one of the listed subject nouns. "成年女性仰躺" carries
// no 人物 / 女子 / 她, so the projection used to read zero people out of the very sentence its own
// exposure facts came from, and the strict validator then rejected the pair as person-only safety on a
// zero count - one provider call, no repair, nothing written.
test("H3 rich-primary counts the subject from the safety evidence, not from a subject-word list", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const genderSubjectRich = [
    "[风格设定]", "写实渲染。",
    "[主体物品]", "成年女性仰躺，裸露的身体可见。",
    "[环境背景]", "室内床铺。",
    "[光线与色彩]", "暖色侧光。",
    "[拍摄参数]", "固定近景。"
  ].join("\n");
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(
    request.body,
    request.inputMeta,
    request.resultOptions,
    async () => {
      calls += 1;
      return h3AttemptFromText(genderSubjectRich, request.resultOptions, "h3-rich-primary-gender-subject");
    }
  );
  assert.equal(calls, 1, "the frame must still take exactly one provider call");
  assert.match(String(result?.data?.output_text || ""), /integrated_multimodal_description/);

  // An object-only explicit frame keeps its zero count.
  const objectRich = [
    "[风格设定]", "产品摄影。",
    "[主体物品]", "白色内衣产品平铺展示，无人物。",
    "[环境背景]", "纯白背景。",
    "[光线与色彩]", "均匀柔光。",
    "[拍摄参数]", "俯拍平铺。"
  ].join("\n");
  await assert.rejects(
    callGrokResponseWithVisualRetry(request.body, request.inputMeta, request.resultOptions, async () => (
      h3AttemptFromText(objectRich, request.resultOptions, "h3-rich-primary-object-only")
    )),
    (error) => error?.h3FailureStage === "visual_facts",
    "an object-only frame must not be projected into a person frame"
  );
});

const reverseGirlRich = [
  "[风格设定]",
  "日系动漫插画，线条干净，色彩明亮，阴影柔和。",
  "",
  "[主体物品]",
  "一名少女留着黑色短发，穿橙色衬衫和绿色短裤，背着绿色背包，站在公路中央面向镜头。",
  "",
  "[环境背景]",
  "乡间公路向远处延伸，两侧是绿色田野和木桩围栏，远处有山丘和蓝天白云。",
  "",
  "[光线与色彩]",
  "阳光从左上方照射，形成柔和阴影，整体色调明亮，以蓝绿为主色。",
  "",
  "[拍摄参数]",
  "中景，平视视角，人物居中，景深清晰，镜头固定。"
].join("\n");

// Grok's real wording for the robot end frame: concrete, but none of the listed subject words.
const reverseRobotRich = [
  "[风格设定]",
  "3D 数字渲染风格，金属表面质感细腻，边缘线条清晰。",
  "",
  "[主体物品]",
  "画面中央站立一个复古机器人，头部为圆形金属头盔，双目橙光闪烁，躯干呈青绿色金属装甲，右臂握持银色喷壶。",
  "",
  "[环境背景]",
  "温室内的石板小路，两侧是绿色植物，背景是玻璃墙。",
  "",
  "[光线与色彩]",
  "自然光从上方照入，金属表面有高光，整体色调偏暖。",
  "",
  "[拍摄参数]",
  "全景，平视视角，主体居中，景深适中。"
].join("\n");

test("H3 rich facts accept a concrete subject described outside the keyword list", () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const richOptions = { ...request.resultOptions, minimaxH3RichVisualStage: true };
  assert.doesNotThrow(() => grokResponsesPublicResult({ output_text: reverseRobotRich }, richOptions));
});

test("H3 first/last reverse turns the editor's @首帧/@尾帧 mentions into picture labels", async () => {
  const first = { dataUrl: "data:image/png;base64,FIRST", role: "first_frame", label: "首帧" };
  const last = { dataUrl: "data:image/png;base64,LAST", role: "last_frame", label: "尾帧" };
  const request = buildH3({
    purpose: "minimax-h3-fl2v-reverse",
    images: [first, last],
    userPrompt: "@首帧 在旅途中遇到了 @尾帧 中的机器人",
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  const resultOptions = { ...request.resultOptions, visualRetryAllowed: true, providerCallBudget: 2, h3RepairAllowed: false };
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(request.body, request.inputMeta, resultOptions, async () => {
    calls += 1;
    return {
      ok: true,
      data: grokResponsesPublicResult(
        { output_text: calls === 1 ? reverseGirlRich : reverseRobotRich },
        { ...resultOptions, supportsNegativePrompt: false }
      ),
      providerCallCount: 1
    };
  });
  assert.equal(calls, 2);
  assert.match(result.data.output_text, /<Picture 1> 在旅途中遇到了 <Picture 2> 中的机器人/);
  assert.doesNotMatch(result.data.output_text, /@首帧|@尾帧/);
});

// Round-1 live Grok answers (robot.jpg; goddess_a.jpg -> goddess_b.jpg). The compiled facts had been split inside
// words (柔和阴影 -> 柔；阴影, 猫与女子之间 -> 猫；女子之间), had lost the subject sentence, carried a stray "一名 "
// and "交叠；双腿交叠", and the ending frame repeated a whole second inventory.
const liveRobotRich = [
  "[风格设定]",
  "采用精细3D渲染风格，呈现圆润机械轮廓，金属表面带有锈蚀和划痕质感，关节处显示铆钉连接细节。",
  "[主体物品]",
  "画面中央有一个青铜色机器人。机器人头部圆形，配备两个发光黄色眼睛和两根天线。身体为青绿色金属，关节部位棕色。右手紧握银色浇水壶，壶口朝下。左手自然下垂，手指微曲。机器人双腿站立，脚踩在苔藓地面，金属靴底可见磨损。",
  "[环境背景]",
  "背景为温室内部，周围有木质种植箱和茂密绿色植物。前景地面覆盖绿色苔藓，机器人位于路径中央，与花箱形成前后层次。",
  "[光线与色彩]",
  "光源来自左侧上方，阳光照射形成明亮高光和柔和阴影。整体色板以青绿和棕色为主，金属表面反射暖光，植物叶片呈现鲜绿调。",
  "[拍摄参数]",
  "采用中景构图，平视视角，机器人居中，背景虚化呈现浅景深效果，镜头带有轻微光晕。"
].join("\n");
const liveGoddessOpeningRich = [
  "[风格设定]",
  "采用写实数字渲染风格，流畅人体轮廓与柔和造型，丝绸布料呈现飘逸褶皱质感，金色金属饰品带有光泽反光，皮肤表面光滑并附着细微光粒子。",
  "[主体物品]",
  "紫发女子坐在台阶上，长直紫发披肩，穿白色透视长裙配金色腰封与臂环，右手握金色月牙法杖，赤足伸展双腿，左臂撑在台阶上；橘色长毛猫蹲坐于下方台阶；法杖与女子手部接触并释放金色光点；女子裙摆垂落接触台阶；猫与女子之间相隔数级台阶。",
  "[环境背景]",
  "背景为夜色山脉与古建筑遗迹，前景是白色大理石台阶，女子位于中景台阶上，猫处于前景较低台阶，散落红色花瓣点缀台阶表面。",
  "[光线与色彩]",
  "上方柔和暮光照射台阶，整体色板为深蓝紫与粉橙渐变，法杖金色光点形成局部高光，女子皮肤与裙摆受侧光呈现柔和明暗过渡。",
  "[拍摄参数]",
  "中景构图，略仰视视角，台阶引导线条透视，镜头呈现清晰前景到模糊远景的景深效果。"
].join("\n");
const liveGoddessEndingRich = [
  "[风格设定]",
  "采用数字艺术渲染风格，轮廓线条流畅，表面呈现光滑皮肤质感与半透明布料垂坠效果，金色金属饰品具反射光泽。",
  "[主体物品]",
  "画面中有一名紫发女子，身着白色半透明长裙搭配金色腰带与臂环，右手握持金色月牙法杖。",
  "女子赤足坐在大理石台阶上，双腿交叠，左手撑在台阶上。",
  "台阶下方有一只橙色长毛猫咪蹲坐。",
  "法杖周围飘散金色光粒子，裙摆带有星光效果。",
  "[环境背景]",
  "背景为层层大理石台阶延伸向上，前景台阶上散落红色花瓣，中景为山脉与古建筑剪影。",
  "女子与猫咪位于台阶中下部，与远景山脉形成层次对比。",
  "[光线与色彩]",
  "光源来自画面右上方柔和暮光，皮肤与金色饰品受暖光照亮，整体色板以蓝紫渐变天空为主。",
  "[拍摄参数]",
  "中景构图，低角度视角，主体居中偏右，透视沿台阶向上延伸，景深浅聚焦于女子与法杖。"
].join("\n");
const h3Visual = (text) => text.split("integrated_multimodal_description: ")[1].split("\n\noverall_soundscape:")[0];

test("H3 rich-primary keeps the sentences Grok wrote whole, with the subject sentence and each fact once", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const result = await callGrokResponseWithVisualRetry(request.body, request.inputMeta, request.resultOptions, async () => (
    h3AttemptFromText(liveRobotRich, request.resultOptions, "h3-live-robot")
  ));
  assertH3ReverseLayout(result.data.output_text);
  const visual = h3Visual(result.data.output_text);
  for (const sentence of [
    "采用精细3D渲染风格，呈现圆润机械轮廓，金属表面带有锈蚀和划痕质感，关节处显示铆钉连接细节。",
    "画面中央有一个青铜色机器人。机器人头部圆形，配备两个发光黄色眼睛和两根天线。",
    "机器人双腿站立，脚踩在苔藓地面，金属靴底可见磨损。",
    "背景为温室内部，周围有木质种植箱和茂密绿色植物。",
    "光源来自左侧上方，阳光照射形成明亮高光和柔和阴影。整体色板以青绿和棕色为主"
  ]) assert.ok(visual.includes(sentence), sentence);
  assert.doesNotMatch(visual, /；|一名 /u);
  const sentences = visual.split(/(?<=。)|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
  assert.equal(new Set(sentences).size, sentences.length, "each fact once");
});

const h3Fl2vVisual = async (openingRich, endingRich) => {
  const request = buildH3({
    purpose: "minimax-h3-fl2v-reverse",
    durationSeconds: 6,
    images: [{ dataUrl: "data:image/png;base64,FIRST", role: "first_frame", label: "首帧" }, { dataUrl: "data:image/png;base64,LAST", role: "last_frame", label: "尾帧" }],
    contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }
  });
  let calls = 0;
  const result = await callGrokResponseWithVisualRetry(request.body, request.inputMeta, request.resultOptions, async () => {
    calls += 1;
    return h3AttemptFromText(calls === 1 ? openingRich : endingRich, request.resultOptions, `h3-fl2v-${calls}`);
  });
  return h3Visual(result.data.output_text);
};
const h3Ending = (visual) => /过渡过程中逐步到达尾帧状态：([^\n]*)/u.exec(visual)?.[1] ?? "";

test("H3 rich-primary FL2VA ending leaves out only the clauses the opening frame already states", async () => {
  const visual = await h3Fl2vVisual(liveGoddessOpeningRich, liveGoddessEndingRich);
  for (const sentence of ["紫发女子坐在台阶上，长直紫发披肩，穿白色透视长裙配金色腰封与臂环", "猫与女子之间相隔数级台阶。", "上方柔和暮光照射台阶"]) {
    assert.ok(visual.includes(sentence), sentence);
  }
  assert.doesNotMatch(visual, /；|一名 /u);
  const ending = h3Ending(visual);
  // The pose change survives once; 中景构图, which both frames state, is written only for the opening.
  assert.match(ending, /双腿交叠。/u);
  assert.doesNotMatch(ending, /交叠[^。]*交叠|中景构图/u);
  assert.equal(visual.split("中景构图").length, 2);
  assert.match(visual, /到 6\.00 秒，动作连续收束至 <Picture 2> 的准确姿态/u);
});

test("H3 rich-primary FL2VA ending keeps a changed pose, framing, light, setting and style", async () => {
  const rich = ({ style = "写实摄影风格，自然肤色与布料质感。", subject, scene = "背景为公园草地与树木，前景是石阶，女子位于中景。",
    light = "午后阳光从左侧照射，整体色板以绿色和暖黄为主。", camera = "中景构图，平视视角，浅景深。" }) => [
    "[风格设定]", style, "[主体物品]", subject, "[环境背景]", scene, "[光线与色彩]", light, "[拍摄参数]", camera
  ].join("\n");
  const woman = "画面中有一名年轻女子，黑色长发披肩，身穿白色衬衫与蓝色牛仔裤。";
  const seated = rich({ subject: woman + "女子坐在台阶上，面向镜头，双眼紧闭，右手握着一本书。一只白猫趴在她脚边的地上。" });
  // Antonyms share almost every character with the opening (坐/站, 面向/背对, 闭/睁); only the unchanged clauses drop.
  assert.equal(h3Ending(await h3Fl2vVisual(seated, rich({ subject: woman + "女子站在台阶上，背对镜头，双眼睁开，右手放下那本书。白猫跳到台阶上趴在她身旁。" }))),
    "女子站在台阶上，背对镜头，双眼睁开，右手放下那本书。白猫跳到台阶上趴在她身旁。");
  // A close-up, a new light, a new setting or a new style at <Picture 2> is stated as well.
  assert.equal(h3Ending(await h3Fl2vVisual(seated, rich({
    subject: woman + "女子坐在台阶上，面向镜头，双眼紧闭，右手握着一本书。一只白猫趴在她脚边的地上。",
    style: "二维动漫插画风格，自然肤色与布料质感。",
    scene: "背景为夜晚的城市街道，前景是石阶，女子位于中景。",
    light: "冷白色路灯从正上方照射，整体色板以绿色和暖黄为主。",
    camera: "特写构图，平视视角，浅景深。"
  }))), "二维动漫插画风格。特写构图。背景为夜晚的城市街道。冷白色路灯从正上方照射。");
  // An identical ending frame has nothing to add.
  assert.equal(h3Ending(await h3Fl2vVisual(seated, seated)), "");
});

test("H3 rich-primary camera sentence that names another shot size keeps its other clauses", async () => {
  const request = buildH3({ contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false } });
  const visualFor = async (camera) => h3Visual((await callGrokResponseWithVisualRetry(request.body, request.inputMeta, request.resultOptions, async () => (
    h3AttemptFromText(liveRobotRich.replace(/(?<=\[拍摄参数\]\n).*/u, camera), request.resultOptions, "h3-camera")
  ))).data.output_text);
  // Round-2 live camera section (a_rfix1): 远景 here conflicts with 中景; only its comma clause drops.
  const live = await visualFor("中景构图，平视视角。主体居中偏左，道路透视线引导构图。轻微单点透视，镜头感自然，景深清晰显示远景。");
  assert.ok(live.includes("中景构图，平视视角。主体居中偏左，道路透视线引导构图。轻微单点透视，镜头感自然。"), live);
  assert.doesNotMatch(live, /景深清晰显示远景/u);
  const low = await visualFor("中景构图。低角度仰拍视角，前景草叶虚化，远景树林清晰可见。");
  assert.ok(low.includes("中景构图。低角度仰拍视角，前景草叶虚化。"), low);
  assert.doesNotMatch(low, /远景树林/u);
});
