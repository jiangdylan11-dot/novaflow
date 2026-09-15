const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const modelsPath = path.resolve(__dirname, "../../particle-editor/art-generate-model.resource.js");
const workflowPath = path.resolve(__dirname, "../../particle-editor/art-generate-provider.workflow.js");

let loadNonce = 0;

async function loadModels() {
  loadNonce += 1;
  await import(`${pathToFileURL(modelsPath).href}?test=${loadNonce}`);
  return globalThis.NovaFlowArtGenerateModels;
}

async function loadWorkflow() {
  loadNonce += 1;
  await import(`${pathToFileURL(workflowPath).href}?test=${loadNonce}`);
  return globalThis.NovaFlowArtGenerateProviderWorkflow;
}

function providerNode(result) {
  assert.equal(result.providerNodeIds.length, 1);
  return result.workflow[result.providerNodeIds[0]];
}

function saveNode(result) {
  const matches = Object.values(result.workflow).filter((node) => node.class_type === "SaveImage");
  assert.equal(matches.length, 1);
  return matches[0];
}

function buildTextFrame(nodeId, text, eventType = 3) {
  const nodeIdBytes = Buffer.from(nodeId, "utf8");
  const textBytes = Buffer.from(text, "utf8");
  const frame = Buffer.alloc(8 + nodeIdBytes.length + textBytes.length);
  frame.writeUInt32BE(eventType, 0);
  frame.writeUInt32BE(nodeIdBytes.length, 4);
  nodeIdBytes.copy(frame, 8);
  textBytes.copy(frame, 8 + nodeIdBytes.length);
  return frame;
}

function createFakeWebSocketClass() {
  return class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      this.constructor.instances.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, value = {}) {
      for (const listener of this.listeners.get(type) || []) listener(value);
    }

    close() {
      this.readyState = 3;
      this.emit("close");
    }
  };
}

function delayedValue(delayMs, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
}

test("provider capability registry exposes Local, GPT, and Google limits", async () => {
  const models = await loadModels();

  assert.equal(typeof globalThis.NovaFlowArtGenerateModels?.getCapability, "function");
  assert.deepEqual(models.providerOptions.map((item) => item.value), ["local", "gpt", "google"]);
  assert.deepEqual(models.providerOptions.map((item) => item.label), ["本地模型", "GPT", "Google"]);
  assert.deepEqual({
    local: {
      txt2img: models.getCapability("local", "txt2img"),
      img2img: models.getCapability("local", "img2img"),
    },
    gpt: {
      txt2img: models.getCapability("gpt", "txt2img"),
      img2img: models.getCapability("gpt", "img2img"),
    },
    google: {
      txt2img: models.getCapability("google", "txt2img"),
      img2img: models.getCapability("google", "img2img"),
    },
  }, {
    local: {
      txt2img: { referenceLimit: 0, fields: ["width", "height", "textQuality", "seed", "nsfw"], negativePrompt: true },
      img2img: { referenceLimit: 3, fields: ["width", "height", "editStrength", "seed", "nsfw"], negativePrompt: true },
    },
    gpt: {
      txt2img: { referenceLimit: 0, fields: ["quality", "size"], negativePrompt: false },
      img2img: { referenceLimit: 3, fields: ["quality", "size"], negativePrompt: false },
    },
    google: {
      txt2img: { referenceLimit: 0, fields: ["aspectRatio"], negativePrompt: false },
      img2img: { referenceLimit: 3, fields: ["aspectRatio", "resolution"], negativePrompt: false },
    },
  });
});

test("ordinary local text generation exposes fixed Ideogram Instant controls while NSFW keeps Rapid controls", async () => {
  const models = await loadModels();
  const ideogram = models.capabilityFor("local", "txt2img", { nsfw: false });
  assert.deepEqual(ideogram, {
    referenceLimit: 0,
    fields: ["width", "height", "instantQuality", "seed", "nsfw"],
    negativePrompt: false,
  });

  const rapid = models.capabilityFor("local", "txt2img", { nsfw: true });
  assert.deepEqual(rapid, models.getCapability("local", "txt2img"));
  assert.equal(rapid.negativePrompt, true);
  assert.ok(rapid.fields.includes("textQuality"));
});

function localWorkflowFixture({ includeLightning = true } = {}) {
  const workflow = {
    sampler: {
      class_type: "KSampler",
      inputs: {
        seed: 42,
        steps: ["steps-switch", 0],
        cfg: ["cfg-switch", 0],
        sampler_name: "dpmpp_2m",
        scheduler: "normal",
        denoise: 0.35,
      },
    },
  };
  if (includeLightning) {
    workflow.lightning = {
      class_type: "PrimitiveBoolean",
      inputs: { value: false },
      _meta: { title: "Enable 4 Steps LoRA?" },
    };
  }
  return workflow;
}

test("local presets map the ordinary and NSFW text/edit routes to the measured settings", async () => {
  const models = await loadModels();
  assert.equal(typeof models.localPresetFor, "function");
  assert.equal(typeof models.applyLocalWorkflowPreset, "function");

  const cases = [
    {
      name: "ordinary text fast",
      mode: "txt2img",
      state: { nsfw: false, localTextQuality: "fast" },
      expected: { steps: 4, cfg: 1, samplerName: "euler", scheduler: "simple", denoise: 1, lightning: true },
    },
    {
      name: "ordinary text fine",
      mode: "txt2img",
      state: { nsfw: false, localTextQuality: "fine" },
      expected: { steps: 25, cfg: 4, samplerName: "euler", scheduler: "simple", denoise: 1, lightning: false },
    },
    {
      name: "ordinary edit faithful",
      mode: "img2img",
      state: { nsfw: false, localEditStrength: "faithful" },
      expected: { steps: 4, cfg: 1, samplerName: "euler", scheduler: "simple", denoise: 1, lightning: true },
    },
    {
      name: "ordinary edit enhanced",
      mode: "img2img",
      state: { nsfw: false, localEditStrength: "enhanced" },
      expected: { steps: 12, cfg: 4, samplerName: "euler", scheduler: "simple", denoise: 1, lightning: false },
    },
    {
      name: "NSFW text fast",
      mode: "txt2img",
      state: { nsfw: true, localTextQuality: "fast" },
      expected: { steps: 4, cfg: 1, samplerName: "euler_ancestral", scheduler: "beta", denoise: 1, lightning: false },
    },
    {
      name: "NSFW text fine",
      mode: "txt2img",
      state: { nsfw: true, localTextQuality: "fine" },
      expected: { steps: 6, cfg: 1, samplerName: "euler_ancestral", scheduler: "beta", denoise: 1, lightning: false },
    },
    {
      name: "NSFW edit faithful",
      mode: "img2img",
      state: { nsfw: true, localEditStrength: "faithful" },
      expected: { steps: 4, cfg: 1, samplerName: "euler_ancestral", scheduler: "beta", denoise: 1, lightning: false },
    },
    {
      name: "NSFW edit enhanced",
      mode: "img2img",
      state: { nsfw: true, localEditStrength: "enhanced" },
      expected: { steps: 6, cfg: 1, samplerName: "euler_ancestral", scheduler: "beta", denoise: 1, lightning: false },
    },
  ];

  for (const entry of cases) {
    assert.deepEqual(models.localPresetFor(entry.state, entry.mode), entry.expected, `${entry.name} preset should remain stable`);
    const workflow = localWorkflowFixture({ includeLightning: !entry.state.nsfw });
    const applied = models.applyLocalWorkflowPreset(workflow, entry.state, entry.mode);
    assert.equal(applied, workflow, `${entry.name} should patch the supplied workflow in place`);
    assert.equal(workflow.sampler.inputs.steps, entry.expected.steps, `${entry.name} should write direct KSampler steps`);
    assert.equal(workflow.sampler.inputs.cfg, entry.expected.cfg, `${entry.name} should write direct KSampler CFG`);
    assert.equal(workflow.sampler.inputs.sampler_name, entry.expected.samplerName, `${entry.name} should write the sampler`);
    assert.equal(workflow.sampler.inputs.scheduler, entry.expected.scheduler, `${entry.name} should write the scheduler`);
    assert.equal(workflow.sampler.inputs.denoise, entry.expected.denoise, `${entry.name} should write denoise`);
    assert.equal(Array.isArray(workflow.sampler.inputs.steps), false, `${entry.name} steps must not retain a switch reference`);
    assert.equal(Array.isArray(workflow.sampler.inputs.cfg), false, `${entry.name} CFG must not retain a switch reference`);
    if (!entry.state.nsfw) {
      assert.equal(workflow.lightning.inputs.value, entry.expected.lightning, `${entry.name} should synchronize the Lightning switch`);
    }
  }
});

test("ordinary local presets fail closed when the workflow has no Lightning Boolean", async () => {
  const models = await loadModels();
  assert.throws(
    () => models.applyLocalWorkflowPreset(
      localWorkflowFixture({ includeLightning: false }),
      { nsfw: false, localTextQuality: "fine" },
      "txt2img",
    ),
    /Lightning|4 Step.*LoRA|Boolean/i,
    "an ordinary workflow without its Lightning switch must not silently create an invalid combination",
  );
});

test("Local UI runs delegate to the dedicated workflow contract and apply its workflow metadata", async () => {
  const workflow = await loadWorkflow();
  const previous = globalThis.NovaFlowUiDesignLocalWorkflow;
  const originalWorkflow = localWorkflowFixture();
  const dedicatedWorkflow = {
    uiSampler: {
      class_type: "KSampler",
      inputs: { steps: 12, cfg: 4, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    },
  };
  const metadata = {
    version: "test-local-ui-contract",
    taskProfile: "ui-design",
    intent: "redesign",
    sampling: { editStrength: "enhanced", steps: 12, cfg: 4 },
  };
  const state = { localEditStrength: "faithful", uiRunIntent: "redesign" };
  const referenceRoles = [
    { index: 0, role: "ui_layout" },
    { index: 1, role: "style" },
  ];
  const calls = [];

  globalThis.NovaFlowUiDesignLocalWorkflow = {
    build(options) {
      calls.push(options);
      return { workflow: dedicatedWorkflow, metadata };
    },
  };

  try {
    const result = workflow.buildRunWorkflow({
      provider: "local",
      mode: "txt2img",
      taskProfile: " UI-DESIGN ",
      localWorkflow: originalWorkflow,
      localModelKey: "qwen-ui-local",
      referenceRoles,
      layoutGuideEncoding: "soft-ui-semantic-scaffold-v2",
      state,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].taskProfile, "ui-design");
    assert.equal(calls[0].mode, "txt2img");
    assert.strictEqual(calls[0].localWorkflow, originalWorkflow);
    assert.strictEqual(calls[0].referenceRoles, referenceRoles);
    assert.strictEqual(calls[0].state, state);
    assert.equal(calls[0].layoutGuideEncoding, "soft-ui-semantic-scaffold-v2");
    assert.strictEqual(result.workflow, dedicatedWorkflow);
    assert.strictEqual(result.uiLocal, metadata);
    assert.equal(result.modelKey, "qwen-ui-local");
    assert.equal(result.taskType, "local_workflow_image");
    assert.deepEqual(result.providerNodeIds, []);
    assert.equal(result.providerNodeType, "");
    assert.equal(originalWorkflow.sampler.inputs.steps[0], "steps-switch");
  } finally {
    if (previous === undefined) delete globalThis.NovaFlowUiDesignLocalWorkflow;
    else globalThis.NovaFlowUiDesignLocalWorkflow = previous;
  }
});

test("Local UI refinement delegates only the dedicated ui-design-refine task profile", async () => {
  const workflow = await loadWorkflow();
  const previous = globalThis.NovaFlowUiDesignLocalRefineWorkflow;
  const originalWorkflow = localWorkflowFixture();
  const refinedWorkflow = {
    refinedSampler: {
      class_type: "KSampler",
      inputs: { steps: 12, cfg: 3.5, sampler_name: "euler", scheduler: "simple", denoise: 0.35 },
    },
  };
  const metadata = {
    version: "test-local-ui-refine-contract",
    taskProfile: "ui-design-refine",
    preset: "polish",
  };
  const calls = [];

  globalThis.NovaFlowUiDesignLocalRefineWorkflow = {
    build(options) {
      calls.push(options);
      return { workflow: refinedWorkflow, metadata };
    },
  };

  try {
    const result = workflow.buildRunWorkflow({
      provider: "local",
      mode: "img2img",
      taskProfile: "ui-design-refine",
      localWorkflow: originalWorkflow,
      uploadedNames: ["first-pass.png"],
      localModelKey: "qwen-ui-refine",
      state: { localUiRefinePreset: "polish", localUiRefineDenoise: 0.35, nsfw: true },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].taskProfile, "ui-design-refine");
    assert.equal(calls[0].mode, "img2img");
    assert.strictEqual(calls[0].localWorkflow, originalWorkflow);
    assert.deepEqual(calls[0].uploadedNames, ["first-pass.png"]);
    assert.equal(calls[0].preset, "polish");
    assert.equal(calls[0].denoise, 0.35);
    assert.equal(calls[0].nsfw, true);
    assert.deepEqual(calls[0].state, { localUiRefinePreset: "polish", localUiRefineDenoise: 0.35, nsfw: true });
    assert.strictEqual(result.workflow, refinedWorkflow);
    assert.strictEqual(result.uiRefine, metadata);
    assert.equal(result.uiLocal, null);
    assert.equal(result.modelKey, "qwen-ui-refine");
  } finally {
    if (previous === undefined) delete globalThis.NovaFlowUiDesignLocalRefineWorkflow;
    else globalThis.NovaFlowUiDesignLocalRefineWorkflow = previous;
  }
});

test("ordinary Local Art Generate keeps its original workflow and bypasses the UI module", async () => {
  const workflow = await loadWorkflow();
  const previous = globalThis.NovaFlowUiDesignLocalWorkflow;
  const originalWorkflow = localWorkflowFixture();
  let buildCalls = 0;
  globalThis.NovaFlowUiDesignLocalWorkflow = {
    build() {
      buildCalls += 1;
      throw new Error("ordinary Local generation must not enter the UI workflow");
    },
  };

  try {
    const result = workflow.buildRunWorkflow({
      provider: "local",
      mode: "img2img",
      taskProfile: "art-generate",
      localWorkflow: originalWorkflow,
      localModelKey: "ordinary-local",
      state: { localEditStrength: "faithful" },
    });

    assert.equal(buildCalls, 0);
    assert.strictEqual(result.workflow, originalWorkflow);
    assert.equal(result.uiLocal, null);
    assert.equal(result.modelKey, "ordinary-local");
    assert.equal(result.taskType, "local_workflow_image");
  } finally {
    if (previous === undefined) delete globalThis.NovaFlowUiDesignLocalWorkflow;
    else globalThis.NovaFlowUiDesignLocalWorkflow = previous;
  }
});

test("Local UI provider fails closed when the dedicated workflow module is unavailable", async () => {
  const workflow = await loadWorkflow();
  const previous = globalThis.NovaFlowUiDesignLocalWorkflow;
  delete globalThis.NovaFlowUiDesignLocalWorkflow;

  try {
    assert.throws(() => workflow.buildRunWorkflow({
      provider: "local",
      mode: "img2img",
      taskProfile: "ui-design",
      localWorkflow: localWorkflowFixture(),
      referenceRoles: [{ index: 0, role: "ui_layout" }],
      layoutGuideEncoding: "soft-ui-semantic-scaffold-v2",
      state: { uiRunIntent: "redesign" },
    }), /Local UI workflow module is required for taskProfile=ui-design/);
  } finally {
    if (previous === undefined) delete globalThis.NovaFlowUiDesignLocalWorkflow;
    else globalThis.NovaFlowUiDesignLocalWorkflow = previous;
  }
});

test("GPT Image 2.5 routes text to Flare and edits to Sunburst while preserving reference limits", async () => {
  const workflow = await loadWorkflow();
  assert.equal(typeof globalThis.NovaFlowArtGenerateProviderWorkflow?.buildWorkflow, "function");

  const gptText = workflow.buildWorkflow({
    provider: "gpt",
    mode: "txt2img",
    prompt: "a paper sculpture",
    uploadedNames: ["must-not-be-used.png"],
    outputPrefix: "NF_GPT_TEXT",
    settings: { quality: "medium", size: "Custom", customWidth: 1280, customHeight: 1024 },
    apiKey: "SENTINEL_MUST_NOT_APPEAR",
  });
  const gptTextNode = providerNode(gptText);
  assert.equal(gptText.providerNodeType, "OpenAIGPTImageNodeV2");
  assert.equal(gptText.modelKey, "gpt-image-2.5-flare");
  assert.equal(gptText.taskType, "local_workflow_image");
  assert.equal(gptTextNode.class_type, "OpenAIGPTImageNodeV2");
  assert.equal(gptTextNode.inputs.n, 1);
  assert.equal(gptTextNode.inputs.model, "gpt-image-2.5-flare");
  assert.equal(gptTextNode.inputs["model.size"], "Custom");
  assert.equal(gptTextNode.inputs["model.quality"], "medium");
  assert.equal(gptTextNode.inputs["model.custom_width"], 1280);
  assert.equal(gptTextNode.inputs["model.custom_height"], 1024);
  assert.equal(Object.keys(gptTextNode.inputs).some((key) => key.startsWith("model.images.")), false);
  assert.equal(Object.values(gptText.workflow).some((node) => node.class_type === "LoadImage"), false);
  assert.equal(saveNode(gptText).inputs.filename_prefix, "NF_GPT_TEXT");
  assert.equal(JSON.stringify(gptText).includes("SENTINEL_MUST_NOT_APPEAR"), false);

  const gptEdit = workflow.buildWorkflow({
    provider: "gpt",
    mode: "img2img",
    prompt: "replace the product",
    uploadedNames: ["one.png", "two.png", "three.png"],
    outputPrefix: "NF_GPT",
    settings: { quality: "low", size: "1024x1024", customWidth: 1024, customHeight: 1024 },
  });
  const gptEditNode = providerNode(gptEdit);
  assert.equal(gptEdit.modelKey, "gpt-image-2.5-sunburst");
  assert.equal(gptEditNode.inputs.model, "gpt-image-2.5-sunburst");
  assert.equal(gptEdit.providerNodeType, "OpenAIGPTImageNodeV2");
  assert.deepEqual(
    Object.keys(gptEditNode.inputs).filter((key) => key.startsWith("model.images.")),
    ["model.images.image_1", "model.images.image_2", "model.images.image_3"],
  );
  assert.deepEqual(
    Object.values(gptEdit.workflow).filter((node) => node.class_type === "LoadImage").map((node) => node.inputs.image),
    ["one.png", "two.png", "three.png"],
  );
  assert.deepEqual(saveNode(gptEdit).inputs.images, [gptEdit.providerNodeIds[0], 0]);

  assert.throws(() => workflow.buildWorkflow({
    provider: "gpt",
    mode: "img2img",
    uploadedNames: ["one.png", "two.png", "three.png", "four.png"],
  }), /received 4 references; maximum is 3/);

  const sixteenNames = Array.from({ length: 16 }, (_, index) => `gpt-${index + 1}.png`);
  const gptMaximum = workflow.buildRunWorkflow({
    provider: "gpt",
    mode: "img2img",
    prompt: "merge all references",
    uploadedNames: sixteenNames,
    maxReferences: 16,
  });
  const gptMaximumNode = providerNode(gptMaximum);
  assert.deepEqual(
    Object.keys(gptMaximumNode.inputs).filter((key) => key.startsWith("model.images.")),
    Array.from({ length: 16 }, (_, index) => `model.images.image_${index + 1}`),
  );
  assert.deepEqual(
    Object.values(gptMaximum.workflow).filter((node) => node.class_type === "LoadImage").map((node) => node.inputs.image),
    sixteenNames,
  );
  assert.throws(() => workflow.buildRunWorkflow({
    provider: "gpt",
    mode: "img2img",
    uploadedNames: sixteenNames.concat("gpt-17.png"),
    maxReferences: 16,
  }), /received 17 references; maximum is 16/);
});

test("Google keeps the shared default at three and accepts an explicit maximum of fourteen references", async () => {
  const workflow = await loadWorkflow();

  const googleText = workflow.buildWorkflow({
    provider: "google",
    mode: "txt2img",
    prompt: "a lantern",
    uploadedNames: [],
    outputPrefix: "NF_GOOGLE",
    settings: { aspectRatio: "1:1" },
  });
  const googleTextNode = providerNode(googleText);
  assert.equal(googleText.providerNodeType, "GeminiImageNode");
  assert.equal(googleText.modelKey, "gemini-2.5-flash-image");
  assert.equal(googleTextNode.inputs.model, "gemini-2.5-flash-image");
  assert.equal(googleTextNode.inputs.aspect_ratio, "1:1");
  assert.equal("images" in googleTextNode.inputs, false);
  assert.equal(Object.values(googleText.workflow).some((node) => node.class_type === "BatchImagesNode"), false);
  assert.equal(saveNode(googleText).inputs.filename_prefix, "NF_GOOGLE");

  const googleEdit = workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "merge references",
    uploadedNames: ["one.png", "two.png", "three.png"],
    outputPrefix: "NF_GOOGLE_EDIT",
    settings: { aspectRatio: "1:1", resolution: "1K" },
  });
  const googleEditNode = providerNode(googleEdit);
  const batch = Object.values(googleEdit.workflow).find((node) => node.class_type === "BatchImagesNode");
  assert.equal(googleEdit.providerNodeType, "GeminiImage2Node");
  assert.equal(googleEdit.modelKey, "gemini-3-pro-image-preview");
  assert.equal(googleEditNode.inputs.model, "gemini-3-pro-image-preview");
  assert.equal(googleEditNode.inputs.resolution, "1K");
  assert.deepEqual(Object.keys(batch.inputs), ["images.image0", "images.image1", "images.image2"]);
  assert.deepEqual(googleEditNode.inputs.images, [
    Object.entries(googleEdit.workflow).find(([, node]) => node === batch)[0],
    0,
  ]);
  assert.deepEqual(saveNode(googleEdit).inputs.images, [googleEdit.providerNodeIds[0], 0]);

  assert.throws(() => workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    uploadedNames: ["one.png", "two.png", "three.png", "four.png"],
  }), /received 4 references; maximum is 3/);

  const fourteenNames = Array.from({ length: 14 }, (_, index) => `google-${index + 1}.png`);
  const googleMaximum = workflow.buildRunWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "merge all references",
    uploadedNames: fourteenNames,
    maxReferences: 14,
  });
  const googleMaximumNode = providerNode(googleMaximum);
  const maximumBatch = Object.values(googleMaximum.workflow).find((node) => node.class_type === "BatchImagesNode");
  assert.deepEqual(
    Object.keys(maximumBatch.inputs),
    Array.from({ length: 14 }, (_, index) => `images.image${index}`),
  );
  assert.deepEqual(
    Object.values(googleMaximum.workflow).filter((node) => node.class_type === "LoadImage").map((node) => node.inputs.image),
    fourteenNames,
  );
  assert.deepEqual(googleMaximumNode.inputs.images, [
    Object.entries(googleMaximum.workflow).find(([, node]) => node === maximumBatch)[0],
    0,
  ]);
  assert.throws(() => workflow.buildRunWorkflow({
    provider: "google",
    mode: "img2img",
    uploadedNames: fourteenNames.concat("google-15.png"),
    maxReferences: 14,
  }), /received 15 references; maximum is 14/);
});

test("Google edit adapter supports an optional system prompt and fails closed for invalid UI guide metadata", async () => {
  const workflow = await loadWorkflow();

  const ordinary = workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "ordinary edit",
    uploadedNames: ["reference.png"],
    systemPrompt: "   ",
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(providerNode(ordinary).inputs, "system_prompt"),
    false,
    "ordinary Google edits must not gain a blank system_prompt input",
  );

  const ordinaryWithSystemPrompt = workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "ordinary edit with system guidance",
    uploadedNames: ["reference.png"],
    systemPrompt: "  Keep the source identity stable.  ",
  });
  assert.equal(
    providerNode(ordinaryWithSystemPrompt).inputs.system_prompt,
    "Keep the source identity stable.",
  );

  const uiDesign = workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "build a finished UI",
    uploadedNames: ["layout-guide.png", "style.png"],
    systemPrompt: "  Treat image 1 as geometry, not artwork.  ",
    taskProfile: "ui-design",
    layoutGuideEncoding: "soft-occupancy-heatmap-v1",
    referenceRoles: [
      { index: 0, role: "ui_layout" },
      { index: 1, role: "style" },
    ],
  });
  assert.equal(
    providerNode(uiDesign).inputs.system_prompt,
    "Treat image 1 as geometry, not artwork.",
  );

  assert.throws(() => workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "invalid UI role",
    uploadedNames: ["layout-guide.png"],
    taskProfile: "ui-design",
    layoutGuideEncoding: "soft-occupancy-heatmap-v1",
    referenceRoles: [{ index: 0, role: "reference" }],
  }), /referenceRoles\[0\].*ui_layout/);

  assert.throws(() => workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "invalid UI encoding",
    uploadedNames: ["layout-guide.png"],
    taskProfile: "ui-design",
    referenceRoles: ["ui_layout"],
  }), /layoutGuideEncoding=soft-occupancy-heatmap-v1/);

  assert.throws(() => workflow.buildWorkflow({
    provider: "google",
    mode: "img2img",
    prompt: "missing UI system guidance",
    uploadedNames: ["layout-guide.png"],
    systemPrompt: "   ",
    taskProfile: "ui-design",
    layoutGuideEncoding: "soft-occupancy-heatmap-v1",
    referenceRoles: ["ui_layout"],
  }), /non-empty systemPrompt/);
});

test("each provider run namespaces every node id so broadcast Price frames cannot cross tasks", async () => {
  const workflow = await loadWorkflow();
  const runA = workflow.buildWorkflow({
    provider: "gpt",
    mode: "img2img",
    prompt: "run a",
    uploadedNames: ["a.png", "b.png", "c.png"],
    nodeIdPrefix: "run_a",
  });
  const runB = workflow.buildWorkflow({
    provider: "gpt",
    mode: "img2img",
    prompt: "run b",
    uploadedNames: ["a.png", "b.png", "c.png"],
    nodeIdPrefix: "run_b",
  });
  const runAIds = Object.keys(runA.workflow);
  const runBIds = Object.keys(runB.workflow);
  assert.ok(runAIds.every((nodeId) => nodeId.startsWith("run_a_")));
  assert.ok(runBIds.every((nodeId) => nodeId.startsWith("run_b_")));
  assert.deepEqual(runAIds.filter((nodeId) => runBIds.includes(nodeId)), []);

  const FakeWebSocket = createFakeWebSocketClass();
  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "http://127.0.0.1:8188",
    clientId: "run_a",
    providerNodeIds: runA.providerNodeIds,
    WebSocket: FakeWebSocket,
  });
  const socket = FakeWebSocket.instances[0];
  const unrelated = observer.waitForCredits(15);
  socket.emit("message", { data: buildTextFrame(runB.providerNodeIds[0], "Price: 99 credits") });
  assert.equal(await unrelated, null, "another task's broadcast Price must be ignored");
  const ownPrice = observer.waitForCredits(100);
  socket.emit("message", { data: buildTextFrame(runA.providerNodeIds[0], "Price: 7 credits") });
  assert.equal(await ownPrice, 7);
  observer.close();
});

test("GPT custom size rejects combinations that the live node cannot execute", async () => {
  const workflow = await loadWorkflow();
  const buildCustom = (customWidth, customHeight) => workflow.buildWorkflow({
    provider: "gpt",
    mode: "txt2img",
    prompt: "custom size",
    settings: { size: "Custom", customWidth, customHeight, quality: "low" },
  });
  assert.throws(() => buildCustom(1024, 3840), /3:1/);
  assert.throws(() => buildCustom(3840, 3840), /8,294,400/);
  assert.doesNotThrow(() => buildCustom(2048, 2048));
});

test("Comfy binary TEXT parser decodes price frames and rejects other events", async () => {
  const workflow = await loadWorkflow();
  const frame = buildTextFrame("provider-node-7", "Status: completed\nPrice: 8.25 credits");

  assert.deepEqual(workflow.parseComfyProgressTextFrame(frame), {
    nodeId: "provider-node-7",
    amountText: "8.25",
    credits: 8.25,
    exact: false,
    source: "comfy_api_legacy_price_v1",
  });
  assert.equal(workflow.parseComfyProgressTextFrame(buildTextFrame("provider-node-7", "Price: 9 credits", 1)), null);
  assert.equal(workflow.parseComfyProgressTextFrame(buildTextFrame("provider-node-7", "Status: running")), null);
  assert.equal(workflow.parseComfyProgressTextFrame(frame.subarray(0, 7)), null);
});

test("Comfy binary TEXT parser prefers the NovaFlow exact marker over the human Price line", async () => {
  const workflow = await loadWorkflow();
  const frame = buildTextFrame(
    "provider-node-7",
    "Status: completed\nPrice: 4.3 credits\nNovaFlow-Price-Exact: 4.270000 credits",
  );

  assert.deepEqual(workflow.parseComfyProgressTextFrame(frame), {
    nodeId: "provider-node-7",
    amountText: "4.270000",
    credits: 4.27,
    exact: true,
    source: "comfy_api_exact_price_v1",
  });
  for (const invalid of ["04.270000", "0.000000", "123456789012345.000000"]) {
    assert.equal(
      workflow.parseComfyProgressTextFrame(buildTextFrame("provider-node-7", `NovaFlow-Price-Exact: ${invalid} credits`)),
      null,
      `invalid exact marker must be ignored: ${invalid}`,
    );
  }
});

test("exact-price waiter ignores legacy Price frames and resolves only the machine marker", async () => {
  const workflow = await loadWorkflow();
  const FakeWebSocket = createFakeWebSocketClass();
  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "http://127.0.0.1:8188",
    clientId: "exact-price-test",
    providerNodeIds: ["provider-node-7"],
    WebSocket: FakeWebSocket,
  });
  const socket = FakeWebSocket.instances[0];

  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 4.3 credits") });
  assert.equal(await observer.waitForExactPrice(0), null, "legacy one-decimal display must never settle money");

  const exact = observer.waitForExactPrice(100);
  socket.emit("message", {
    data: buildTextFrame("provider-node-7", "Price: 4.3 credits\nNovaFlow-Price-Exact: 4.270000 credits"),
  });
  assert.deepEqual(await exact, {
    amountText: "4.270000",
    credits: 4.27,
    exact: true,
    source: "comfy_api_exact_price_v1",
  });
  assert.equal(await observer.waitForCredits(0), 4.27, "the legacy numeric compatibility API should see the exact value");
  observer.close();
});

test("price observer opens the provider socket, filters node ids, and keeps the latest positive price", async () => {
  const workflow = await loadWorkflow();
  const FakeWebSocket = createFakeWebSocketClass();

  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "https://runtime.example.test/",
    clientId: "client 42",
    providerNodeIds: ["provider-node-7"],
    WebSocket: FakeWebSocket,
  });
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, "wss://runtime.example.test/ws?clientId=client+42");
  assert.equal(socket.binaryType, "arraybuffer");

  const firstPrice = observer.waitForCredits(250);
  socket.emit("message", { data: buildTextFrame("unrelated-node", "Price: 99 credits") });
  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 8.25 credits") });
  assert.equal(await firstPrice, 8.25);

  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 9.5 credits") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await observer.waitForCredits(0), 9.5);
  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 1 credits") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await observer.waitForCredits(0), 9.5, "later low frames must not reduce the trusted settlement amount");

  observer.close();
  assert.equal(socket.readyState, 3);
});

test("price observer binds TEXT Price to the target prompt execution window", async () => {
  const workflow = await loadWorkflow();
  const FakeWebSocket = createFakeWebSocketClass();
  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "http://127.0.0.1:8188",
    clientId: "isolated-client",
    providerNodeIds: ["provider-node-7"],
    requirePromptOwnership: true,
    WebSocket: FakeWebSocket,
  });
  const socket = FakeWebSocket.instances[0];
  socket.emit("open");
  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 100 credits") });
  socket.emit("message", { data: JSON.stringify({ type: "executing", data: { prompt_id: "other-prompt", node: "provider-node-7" } }) });
  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 99 credits") });
  observer.bindPrompt("target-prompt");
  assert.equal(await observer.waitForCredits(0), null);
  socket.emit("message", { data: JSON.stringify({ type: "executing", data: { prompt_id: "target-prompt", node: "provider-node-7" } }) });
  socket.emit("message", { data: buildTextFrame("provider-node-7", "Price: 7.5 credits") });
  assert.equal(await observer.waitForCredits(100), 7.5);
  observer.close();
});

test("price observer resolves an active waiter promptly when the socket closes remotely", async () => {
  const workflow = await loadWorkflow();
  const FakeWebSocket = createFakeWebSocketClass();
  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "http://127.0.0.1:8188",
    clientId: "close-test",
    providerNodeIds: ["provider-node-7"],
    WebSocket: FakeWebSocket,
  });
  const pendingCredits = observer.waitForCredits(200);
  FakeWebSocket.instances[0].emit("close");
  const outcome = await Promise.race([pendingCredits, delayedValue(25, "still-pending")]);
  observer.close();

  assert.equal(outcome, null);
});

test("price observer returns null immediately for future waiters after a socket error", async () => {
  const workflow = await loadWorkflow();
  const FakeWebSocket = createFakeWebSocketClass();
  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "http://127.0.0.1:8188",
    clientId: "error-test",
    providerNodeIds: ["provider-node-7"],
    WebSocket: FakeWebSocket,
  });
  FakeWebSocket.instances[0].emit("error");
  const outcome = await Promise.race([
    observer.waitForCredits(200),
    delayedValue(25, "still-pending"),
  ]);
  observer.close();

  assert.equal(outcome, null);
});

test("price observer bounds readiness when a socket never opens", async () => {
  const workflow = await loadWorkflow();
  const FakeWebSocket = createFakeWebSocketClass();
  const observer = workflow.createPriceObserver({
    runtimeBaseUrl: "http://127.0.0.1:8188",
    clientId: "never-opens-test",
    providerNodeIds: ["provider-node-7"],
    WebSocket: FakeWebSocket,
    connectTimeoutMs: 10,
  });
  const ready = await Promise.race([observer.ready, delayedValue(50, "still-pending")]);
  const credits = await Promise.race([
    observer.waitForCredits(200),
    delayedValue(25, "still-pending"),
  ]);
  observer.close();

  assert.equal(ready, false);
  assert.equal(credits, null);
});
