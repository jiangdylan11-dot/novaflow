const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_SAFETENSORS_HEADER_BYTES,
  createMiniMaxH3LoraCatalog,
} = require("../main/minimax-h3-lora-catalog");

function abTensors(options = {}) {
  const prefix = options.prefix || "diffusion_model.transformer_blocks.0.attn.to_q";
  const rank = options.rank || 4;
  const highRank = options.highRank || rank;
  return {
    [`${prefix}.lora_A.weight`]: {
      dtype: "F16",
      shape: [rank, 8],
      data_offsets: [0, rank * 8 * 2],
    },
    [`${prefix}.lora_B.weight`]: {
      dtype: "F16",
      shape: [8, highRank],
      data_offsets: [rank * 8 * 2, (rank * 8 * 2) + (8 * highRank * 2)],
    },
  };
}

const H3_DIMENSIONS = Object.freeze({
  attn_out_proj: { input: 7168, output: 5376 },
  attn_qkv_proj: { input: 5376, output: 21504 },
  mlp_fc1: { input: 5376, output: 28672 },
  mlp_fc2: { input: 14336, output: 5376 },
});

function h3Tensors(options = {}) {
  const target = options.target || "attn_out_proj";
  const dimensions = H3_DIMENSIONS[target];
  const block = options.block == null ? 10 : options.block;
  const rank = options.rank || 1;
  const input = options.input || dimensions.input;
  const output = options.output || dimensions.output;
  const upRank = options.upRank || rank;
  const prefix = `lora_unet_blocks_${block}_${target}`;
  const downEnd = rank * input * 2;
  const upEnd = downEnd + (output * upRank * 2);
  const tensors = {
    [`${prefix}.lora_down.weight`]: {
      dtype: "BF16",
      shape: [rank, input],
      data_offsets: [0, downEnd],
    },
    [`${prefix}.lora_up.weight`]: {
      dtype: "BF16",
      shape: [output, upRank],
      data_offsets: [downEnd, upEnd],
    },
  };
  if (options.alpha !== false) {
    tensors[`${prefix}.alpha`] = {
      dtype: "F32",
      shape: [],
      data_offsets: [upEnd, upEnd + 4],
    };
  }
  return tensors;
}

function combineTensors(...groups) {
  let cursor = 0;
  const combined = {};
  for (const group of groups) {
    for (const [name, tensor] of Object.entries(group)) {
      const byteLength = tensor.data_offsets[1] - tensor.data_offsets[0];
      combined[name] = {
        ...tensor,
        shape: [...tensor.shape],
        data_offsets: [cursor, cursor + byteLength],
      };
      cursor += byteLength;
    }
  }
  return combined;
}

function fakeTransformerTensors() {
  return {
    "diffusion_model.transformer_blocks.0.attn.to_q.lora_down.weight": {
      dtype: "BF16",
      shape: [4, 8],
      data_offsets: [0, 64],
    },
    "diffusion_model.transformer_blocks.0.attn.to_q.lora_up.weight": {
      dtype: "BF16",
      shape: [8, 4],
      data_offsets: [64, 128],
    },
  };
}

function broadH3Tensors(format = 'updown', refiner = false) {
  const values = combineTensors(...Object.keys(H3_DIMENSIONS).map(target => h3Tensors({ target, block: 1 })))
  if (format === 'updown') return values;
  return Object.fromEntries(Object.entries(values).filter(([name]) => !name.endsWith('.alpha')).map(([name, value]) => [
    name.replace(/^lora_unet_blocks_(\d+)_(attn|mlp)_(out_proj|qkv_proj|fc1|fc2)\.lora_(down|up)\.weight$/,
      (_, block, group, projection, side) => `diffusion_model.${refiner ? 'token_refiner.' : ''}blocks.${block}.${group}.${projection}.lora_${side === 'down' ? 'A' : 'B'}.weight`), value,
  ]));
}

test('recognizes community A/B and up/down H3 adapters without trainer-specific metadata', async t => {
  const fixture = createFixture(t);
  for (const format of ['ab', 'updown']) {
    const name = `minimax_h3/community-${format}.safetensors`;
    const tensors = format === 'ab' ? combineTensors(broadH3Tensors('ab'), broadH3Tensors('ab', true)) : broadH3Tensors();
    writeSafetensors(path.join(fixture.lorasPath, ...name.split('/')), { ss_base_model_version: format === 'ab' ? 'minimax_h3' : 'community-export' }, tensors);
    fixture.state.runtimeNames.push(name);
  }
  const api = fixture.makeCatalog();
  const entries = await api.catalog({ mode: 't2v', steps: 4 });
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => e.modelFamily === 'h3'));
  assert.equal((await api.catalog({ mode: 'r2v', steps: 4 })).length, 2);
  for (const entry of entries) assert.equal((await api.validate({ mode: 't2v', steps: 4, name: entry.name, fingerprint: entry.fingerprint, strength: 1 })).ok, true);
});

test('structural fallback rejects wrong shapes and out-of-range main or refiner blocks', async t => {
  const fixture = createFixture(t);
  for (const fault of ['shape', 'block', 'refiner', 'unpaired']) {
    let tensors = broadH3Tensors('ab');
    const firstKey = Object.keys(tensors)[0];
    if (fault === 'shape') tensors[firstKey].shape[1] -= 1;
    if (fault === 'unpaired') delete tensors[firstKey];
    if (fault === 'block') tensors = Object.fromEntries(Object.entries(tensors).map(([k, v]) => [k.replace('blocks.1.', 'blocks.50.'), v]));
    if (fault === 'refiner') tensors = combineTensors(tensors, Object.fromEntries(Object.entries(broadH3Tensors('ab', true)).map(([k, v]) => [k.replace('blocks.1.', 'blocks.2.'), v])));
    const name = `minimax_h3/${fault}.safetensors`;
    writeSafetensors(path.join(fixture.lorasPath, ...name.split('/')), {}, tensors);
    fixture.state.runtimeNames.push(name);
  }
  assert.deepEqual(await fixture.makeCatalog().catalog({ mode: 't2v', steps: 4 }), []);
});

function h3Metadata(base = "fl2va", extra = {}) {
  return {
    ss_h3_lora_base: base,
    ss_network_module: "networks.lora_minimax_h3",
    ...extra,
  };
}

function writeSafetensors(filePath, metadata, tensors = h3Tensors()) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = Buffer.from(JSON.stringify({ __metadata__: metadata, ...tensors }), "utf8");
  const maxOffset = Math.max(...Object.values(tensors).map((tensor) => tensor.data_offsets[1]));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  fs.writeFileSync(filePath, Buffer.concat([length, header, Buffer.alloc(maxOffset)]));
}

function writeBrokenHeader(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = Buffer.from("{not-json", "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  fs.writeFileSync(filePath, Buffer.concat([length, header]));
}

function writeOversizedHeaderDeclaration(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(MAX_SAFETENSORS_HEADER_BYTES + 1));
  fs.writeFileSync(filePath, length);
}

// A header-only stand-in for the H3 model the animation panel loads (10Eros), with the 2-D weights
// LoRAs target: 50 main blocks and 2 refiner blocks (attention and MLP), each main block's AdaLN
// projection on the 8-wide time basis, and the text condition projection.
const H3_BASE_PARTS = ["diffusion_models", "Minimax_H3", "10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors"];
function writeH3Base(modelsPath) {
  const header = {};
  const add = (name, shape, dtype = "BF16") => { header[`${name}.weight`] = { dtype, shape, data_offsets: [0, 0] }; };
  const blockWeights = (prefix, dtype) => {
    add(`${prefix}.attn.qkv_proj`, [21504, 5376], dtype);
    add(`${prefix}.attn.out_proj`, [5376, 7168], dtype);
    add(`${prefix}.mlp.fc1`, [28672, 5376], dtype);
    add(`${prefix}.mlp.fc2`, [5376, 14336], dtype);
  };
  for (let block = 0; block < 50; block += 1) {
    blockWeights(`blocks.${block}`, "I8");
    add(`blocks.${block}.adaln_proj.linear`, [96768, 8]);
  }
  for (let block = 0; block < 2; block += 1) blockWeights(`token_refiner.blocks.${block}`);
  add("condition_proj", [5376, 5120]);
  header["blocks.0.attn.norm_q.weight"] = { dtype: "BF16", shape: [128], data_offsets: [0, 0] };
  const filePath = path.join(modelsPath, ...H3_BASE_PARTS);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(filePath, Buffer.concat([length, json]));
  return filePath;
}

// One LoRA pair on `prefix` (ComfyUI spellings: 'ab' lora_A/B, 'updown' lora_down/up).
function pairTensors(prefix, input, output, { rank = 2, style = "ab", alpha = false, dtype = "BF16" } = {}) {
  const [down, up] = style === "ab" ? [".lora_A.weight", ".lora_B.weight"] : [".lora_down.weight", ".lora_up.weight"];
  const width = dtype === "F32" ? 4 : 2;
  const tensors = {
    [prefix + down]: { dtype, shape: [rank, input], data_offsets: [0, rank * input * width] },
    [prefix + up]: { dtype, shape: [output, rank], data_offsets: [0, output * rank * width] },
  };
  if (alpha) tensors[`${prefix}.alpha`] = { dtype: "F32", shape: [], data_offsets: [0, 4] };
  return tensors;
}

function createFixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-h3-lora-"));
  const modelsPath = path.join(workspace, "models");
  const lorasPath = path.join(modelsPath, "loras");
  const h3LorasPath = path.join(lorasPath, "minimax_h3");
  fs.mkdirSync(h3LorasPath, { recursive: true });
  const basePath = writeH3Base(modelsPath);
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const state = { runtimeNames: [] };
  function makeCatalog(options = {}) {
    return createMiniMaxH3LoraCatalog({
      fs: options.fs || fs,
      path,
      readConfig: () => ({ ok: true, modelsPath: options.configModelsPath || modelsPath }),
      listRuntimeLoraNames: async () => [...state.runtimeNames],
      ...(options.expectedModelsPath ? { expectedModelsPath: options.expectedModelsPath } : {}),
    });
  }
  return { workspace, modelsPath, lorasPath, h3LorasPath, basePath, state, makeCatalog };
}

test("shows a metadata-declared FL2VA standard LoRA at arbitrary valid step counts", async (t) => {
  const fixture = createFixture(t);
  const relativeName = "minimax_h3\\SexGod-NaughtyTimes-v2-rank256.safetensors";
  writeSafetensors(
    path.join(fixture.lorasPath, "minimax_h3", "SexGod-NaughtyTimes-v2-rank256.safetensors"),
    h3Metadata("minimax_h3_fl2va_int8_convrot.safetensors", {
      ss_output_name: "SexGod-NaughtyTimes-v2-rank256",
    }),
    h3Tensors({ target: "attn_out_proj", block: 10, rank: 256 }),
  );
  fixture.state.runtimeNames = [relativeName];
  const catalogApi = fixture.makeCatalog();

  for (const steps of [1, 4, 17, 20, 10_000]) {
    const items = await catalogApi.catalog({ mode: "text_video", steps });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, relativeName);
    assert.equal(items[0].modelFamily, "fl2va");
    assert.equal(items[0].kind, "standard");
    assert.equal(items[0].supportedSteps, null);
    assert.deepEqual(items[0].strengthRange, { min: 0, max: 2, default: 1, step: 0.05 });
    assert.match(items[0].fingerprint, /^v1:\d+:[\d.]+:[a-f0-9]{64}$/);
  }
  assert.equal((await catalogApi.catalog({ mode: "t2v", steps: 4 })).length, 1);
  assert.equal((await catalogApi.catalog({ mode: "i2v", steps: 4 })).length, 1);
  assert.equal((await catalogApi.catalog({ mode: "fl2v", steps: 4 })).length, 1);
  assert.equal((await catalogApi.catalog({ mode: "multi_reference", steps: 4 })).length, 0);
  assert.equal((await catalogApi.catalog({ mode: "r2v", steps: 4 })).length, 0);
});

test("shows Ref2VA only in multi-reference mode and accepts an up/down tensor pair", async (t) => {
  const fixture = createFixture(t);
  const relativeName = "minimax_h3/ref2va/character-reference.safetensors";
  writeSafetensors(
    path.join(fixture.lorasPath, "minimax_h3", "ref2va", "character-reference.safetensors"),
    h3Metadata("ref2va", { ss_network_module: "  Networks.Lora_MiniMax_H3  " }),
    h3Tensors({ target: "attn_qkv_proj", block: 2, rank: 2 }),
  );
  fixture.state.runtimeNames = [relativeName];
  const catalogApi = fixture.makeCatalog();

  assert.equal((await catalogApi.catalog({ mode: "multi_reference", steps: 9 })).length, 1);
  assert.equal((await catalogApi.catalog({ mode: "r2v", steps: 9 })).length, 1);
  assert.equal((await catalogApi.catalog({ mode: "image_video", steps: 9 })).length, 0);
  assert.equal((await catalogApi.catalog({ mode: "i2v", steps: 9 })).length, 0);
});

test("accepts all four real H3 target dimensions and rejects a single wrong target in a mixed file", async (t) => {
  const fixture = createFixture(t);
  const validName = "minimax_h3/all-real-targets.safetensors";
  const wrongName = "minimax_h3/one-wrong-target.safetensors";
  writeSafetensors(
    path.join(fixture.lorasPath, ...validName.split("/")),
    h3Metadata("fl2va"),
    combineTensors(
      h3Tensors({ target: "attn_out_proj", block: 0 }),
      h3Tensors({ target: "attn_qkv_proj", block: 1 }),
      h3Tensors({ target: "mlp_fc1", block: 2 }),
      h3Tensors({ target: "mlp_fc2", block: 3 }),
    ),
  );
  writeSafetensors(
    path.join(fixture.lorasPath, ...wrongName.split("/")),
    h3Metadata("fl2va"),
    combineTensors(
      h3Tensors({ target: "attn_qkv_proj", block: 1 }),
      h3Tensors({ target: "mlp_fc2", block: 3, input: 14335 }),
    ),
  );
  fixture.state.runtimeNames = [validName, wrongName];

  const items = await fixture.makeCatalog().catalog({ mode: "t2v", steps: 6 });
  assert.deepEqual(items.map((item) => item.name), [validName]);
});

test("requires object_info intersection and hides foreign, damaged, oversized, and shape-mismatched files", async (t) => {
  const fixture = createFixture(t);
  const validButMissing = "minimax_h3/valid-but-not-in-runtime.safetensors";
  writeSafetensors(path.join(fixture.lorasPath, ...validButMissing.split("/")), h3Metadata("fl2va"));
  writeSafetensors(path.join(fixture.h3LorasPath, "unknown.safetensors"), { ss_network_module: "networks.lora_minimax_h3" });
  writeSafetensors(path.join(fixture.h3LorasPath, "wan.safetensors"), h3Metadata("wan2.2"));
  writeSafetensors(path.join(fixture.h3LorasPath, "contains-only.safetensors"), h3Metadata("qwen_minimax_h3_fl2va"));
  writeSafetensors(path.join(fixture.h3LorasPath, "missing-network.safetensors"), { ss_h3_lora_base: "fl2va" });
  writeSafetensors(path.join(fixture.h3LorasPath, "wrong-network.safetensors"), {
    ss_h3_lora_base: "fl2va",
    ss_network_module: "networks.lora",
  });
  writeSafetensors(
    path.join(fixture.h3LorasPath, "bad-shape.safetensors"),
    h3Metadata("fl2va"),
    h3Tensors({ target: "attn_out_proj", input: 7167 }),
  );
  writeSafetensors(path.join(fixture.h3LorasPath, "fake-transformer.safetensors"), h3Metadata("fl2va"), fakeTransformerTensors());
  writeSafetensors(path.join(fixture.h3LorasPath, "ab-pair.safetensors"), h3Metadata("fl2va"), abTensors());
  writeBrokenHeader(path.join(fixture.h3LorasPath, "broken.safetensors"));
  writeOversizedHeaderDeclaration(path.join(fixture.h3LorasPath, "oversized.safetensors"));
  fixture.state.runtimeNames = [
    "minimax_h3/unknown.safetensors",
    "minimax_h3/wan.safetensors",
    "minimax_h3/contains-only.safetensors",
    "minimax_h3/missing-network.safetensors",
    "minimax_h3/wrong-network.safetensors",
    "minimax_h3/bad-shape.safetensors",
    "minimax_h3/fake-transformer.safetensors",
    "minimax_h3/ab-pair.safetensors",
    "minimax_h3/broken.safetensors",
    "minimax_h3/oversized.safetensors",
  ];

  // Only tensors that fit the loaded model decide: a file without a declared base, or with the
  // network-module metadata missing or different, is listed when every pair fits (no base = any
  // mode). An unreadable declared base, a wrong shape and non-H3 names stay hidden.
  const listed = await fixture.makeCatalog().catalog({ mode: "text_video", steps: 4 });
  assert.deepEqual(listed.map((item) => [item.name, item.modelFamily]), [
    ["minimax_h3/missing-network.safetensors", "fl2va"],
    ["minimax_h3/unknown.safetensors", "h3"],
    ["minimax_h3/wrong-network.safetensors", "fl2va"],
  ]);
});

test("lists LoRAs that also train condition_proj or AdaLN, and attention-only ones, when every pair fits the loaded model", async (t) => {
  const fixture = createFixture(t);
  const files = {
    // grindtime-style: main blocks plus the text condition projection, lora_A/B with alphas.
    "condition.safetensors": combineTensors(
      pairTensors("diffusion_model.blocks.3.attn.qkv_proj", 5376, 21504, { alpha: true, dtype: "F32" }),
      pairTensors("diffusion_model.condition_proj", 5120, 5376, { alpha: true, dtype: "F32" }),
    ),
    // cxy_kiss-style: AdaLN projection on the 8-wide time basis, refiner blocks too.
    "adaln.safetensors": combineTensors(
      pairTensors("diffusion_model.blocks.0.adaln_proj.linear", 8, 96768, { rank: 32 }),
      pairTensors("diffusion_model.token_refiner.blocks.1.mlp.fc2", 14336, 5376),
    ),
    // Footjob-style: attention only, kohya names, no metadata.
    "attention-only.safetensors": combineTensors(
      pairTensors("lora_unet_blocks_7_attn_qkv_proj", 5376, 21504, { style: "updown", alpha: true, dtype: "F32" }),
      pairTensors("lora_unet_blocks_7_attn_out_proj", 7168, 5376, { style: "updown", alpha: true, dtype: "F32" }),
    ),
  };
  for (const [file, tensors] of Object.entries(files)) {
    writeSafetensors(path.join(fixture.h3LorasPath, file), {}, tensors);
    fixture.state.runtimeNames.push(`minimax_h3/${file}`);
  }
  for (const mode of ["t2v", "i2v", "fl2v", "r2v"]) {
    const items = await fixture.makeCatalog().catalog({ mode, steps: 4 });
    assert.deepEqual(items.map((item) => item.name).sort(), Object.keys(files).map((file) => `minimax_h3/${file}`).sort());
    assert.ok(items.every((item) => item.modelFamily === "h3" && item.kind === "standard"));
  }
});

test("hides names ComfyUI does not map for H3, a weight hit twice, DoRA scales and an AdaLN LoRA for another time basis", async (t) => {
  const fixture = createFixture(t);
  const files = {
    // The H3 engine (ComfyUI 0.31.1) maps neither bare, transformer. nor lycoris_ names.
    "bare.safetensors": pairTensors("blocks.3.attn.qkv_proj", 5376, 21504),
    "transformer-prefix.safetensors": pairTensors("transformer.blocks.3.attn.qkv_proj", 5376, 21504),
    "lycoris-prefix.safetensors": pairTensors("lycoris_blocks_3_attn_qkv_proj", 5376, 21504, { style: "updown" }),
    // Two spellings of one weight: the later would silently replace the earlier.
    "twice.safetensors": combineTensors(
      pairTensors("diffusion_model.blocks.3.attn.qkv_proj", 5376, 21504),
      pairTensors("lora_unet_blocks_3_attn_qkv_proj", 5376, 21504, { style: "updown" }),
    ),
    "dora.safetensors": combineTensors(
      pairTensors("diffusion_model.blocks.3.attn.out_proj", 7168, 5376),
      { "diffusion_model.blocks.3.attn.out_proj.dora_scale": { dtype: "BF16", shape: [5376, 1], data_offsets: [0, 5376 * 2] } },
    ),
    // Trained on an H3 with the 2688-wide time embedding: no AdaLN weight of that shape here.
    "adaln-other-basis.safetensors": pairTensors("diffusion_model.blocks.0.adaln_proj.linear", 2688, 96768),
    // Same element count as out_proj, transposed.
    "transposed.safetensors": pairTensors("diffusion_model.blocks.3.attn.out_proj", 5376, 7168),
    // A 1-D norm weight is not a LoRA target.
    "norm.safetensors": pairTensors("diffusion_model.blocks.0.attn.norm_q", 128, 1),
    // An alpha the engine's loader cannot read.
    "alpha-e8m0.safetensors": {
      ...pairTensors("diffusion_model.blocks.3.attn.qkv_proj", 5376, 21504),
      "diffusion_model.blocks.3.attn.qkv_proj.alpha": { dtype: "F8_E8M0", shape: [], data_offsets: [0, 1] },
    },
  };
  for (const [file, tensors] of Object.entries(files)) {
    writeSafetensors(path.join(fixture.h3LorasPath, file), {}, combineTensors(tensors));
    fixture.state.runtimeNames.push(`minimax_h3/${file}`);
  }
  // Data with a gap, or metadata that is not all strings: safetensors' safe_open refuses both.
  const gap = combineTensors(pairTensors("diffusion_model.blocks.3.attn.qkv_proj", 5376, 21504));
  const gapFile = path.join(fixture.h3LorasPath, "gap.safetensors");
  writeSafetensors(gapFile, {}, gap);
  fs.appendFileSync(gapFile, Buffer.alloc(2));
  writeSafetensors(path.join(fixture.h3LorasPath, "metadata.safetensors"), { ss_steps: 1500 }, gap);
  fixture.state.runtimeNames.push("minimax_h3/gap.safetensors", "minimax_h3/metadata.safetensors");
  assert.deepEqual(await fixture.makeCatalog().catalog({ mode: "t2v", steps: 4 }), []);
});

test("lists nothing when the H3 model the panel loads is missing", async (t) => {
  const fixture = createFixture(t);
  writeSafetensors(path.join(fixture.h3LorasPath, "fine.safetensors"), h3Metadata("fl2va"));
  fixture.state.runtimeNames = ["minimax_h3/fine.safetensors"];
  assert.equal((await fixture.makeCatalog().catalog({ mode: "t2v", steps: 4 })).length, 1);
  fs.rmSync(fixture.basePath);
  assert.deepEqual(await fixture.makeCatalog().catalog({ mode: "t2v", steps: 4 }), []);
});

test("hides the managed Turbo profile and every user-selectable accelerator", async (t) => {
  const fixture = createFixture(t);
  const managed = "minimax_h3\\minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors";
  const external = "minimax_h3\\community-turbo-8steps.safetensors";
  writeSafetensors(
    path.join(fixture.lorasPath, "minimax_h3", path.basename(managed)),
    h3Metadata("fl2va", { ss_h3_lora_kind: "turbo", ss_h3_lora_required_steps: "4" }),
  );
  writeSafetensors(
    path.join(fixture.lorasPath, "minimax_h3", "community-turbo-8steps.safetensors"),
    h3Metadata("fl2va", { ss_h3_lora_kind: "accelerator", ss_h3_lora_required_steps: "8" }),
  );
  fixture.state.runtimeNames = [managed, external];
  const catalogApi = fixture.makeCatalog();

  assert.equal((await catalogApi.catalog({ mode: "text_video", steps: 4 })).length, 0);
  assert.equal((await catalogApi.catalog({ mode: "text_video", steps: 8 })).length, 0);
});

test("rejects symlink or junction escape and traversal-shaped runtime names", async (t) => {
  const fixture = createFixture(t);
  const outside = path.join(fixture.workspace, "outside");
  writeSafetensors(path.join(outside, "escape.safetensors"), h3Metadata("fl2va"));
  const crossDirectoryName = "cross-directory.safetensors";
  writeSafetensors(path.join(fixture.lorasPath, crossDirectoryName), h3Metadata("fl2va"));
  const linkPath = path.join(fixture.h3LorasPath, "linked");
  try {
    fs.symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  fixture.state.runtimeNames = [
    "minimax_h3/linked/escape.safetensors",
    "minimax_h3/../outside/escape.safetensors",
    crossDirectoryName,
  ];

  assert.deepEqual(await fixture.makeCatalog().catalog({ mode: "text_video", steps: 4 }), []);
});

test("pins config modelsPath to the expected real model root and rejects a junction to a different root", async (t) => {
  const fixture = createFixture(t);
  const relativeName = "minimax_h3/trusted.safetensors";
  writeSafetensors(path.join(fixture.lorasPath, ...relativeName.split("/")), h3Metadata("fl2va"));
  fixture.state.runtimeNames = [relativeName];

  const trusted = fixture.makeCatalog({ expectedModelsPath: () => fixture.modelsPath });
  assert.equal((await trusted.catalog({ mode: "t2v", steps: 4 })).length, 1);

  const otherModelsPath = path.join(fixture.workspace, "other-models");
  fs.mkdirSync(path.join(otherModelsPath, "loras"), { recursive: true });
  const wrongExpectedRoot = fixture.makeCatalog({ expectedModelsPath: () => otherModelsPath });
  assert.deepEqual(await wrongExpectedRoot.catalog({ mode: "t2v", steps: 4 }), []);

  const junctionPath = path.join(fixture.workspace, "configured-models-junction");
  try {
    fs.symlinkSync(otherModelsPath, junctionPath, process.platform === "win32" ? "junction" : "dir");
    const junctionEscape = fixture.makeCatalog({
      configModelsPath: junctionPath,
      expectedModelsPath: () => fixture.modelsPath,
    });
    assert.deepEqual(await junctionEscape.catalog({ mode: "t2v", steps: 4 }), []);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) throw error;
    t.diagnostic(`junction assertion unavailable: ${error.code}`);
  }

  const expectedFailure = fixture.makeCatalog({ expectedModelsPath: () => { throw new Error("trusted root unavailable"); } });
  assert.deepEqual(await expectedFailure.catalog({ mode: "t2v", steps: 4 }), []);
});

test("reads exactly the safetensors length prefix and JSON header, never tensor bytes", async (t) => {
  const fixture = createFixture(t);
  const relativeName = "minimax_h3/safe.safetensors";
  const filePath = path.join(fixture.lorasPath, ...relativeName.split("/"));
  writeSafetensors(filePath, h3Metadata("fl2va"));
  fixture.state.runtimeNames = [relativeName];
  const headerLength = (file) => Number(fs.readFileSync(file).subarray(0, 8).readBigUInt64LE());
  const limits = new Map([[path.resolve(filePath), headerLength(filePath)], [path.resolve(fixture.basePath), headerLength(fixture.basePath)]]);
  const files = new Map();
  const readCalls = [];
  const trackedFs = Object.create(fs);
  trackedFs.openSync = (file, ...rest) => {
    const fd = fs.openSync(file, ...rest);
    files.set(fd, path.resolve(String(file)));
    return fd;
  };
  trackedFs.readSync = (fd, buffer, offset, length, position) => {
    const file = files.get(fd);
    readCalls.push({ file: path.basename(file), length, position });
    assert.ok(limits.has(file) && position + length <= 8 + limits.get(file), "attempted to read tensor data");
    return fs.readSync(fd, buffer, offset, length, position);
  };

  const items = await fixture.makeCatalog({ fs: trackedFs }).catalog({ mode: "first_last", steps: 31 });
  assert.equal(items.length, 1);
  // The loaded model's header once, then the LoRA's.
  assert.deepEqual(readCalls, [
    { file: path.basename(fixture.basePath), length: 8, position: 0 },
    { file: path.basename(fixture.basePath), length: limits.get(path.resolve(fixture.basePath)), position: 8 },
    { file: "safe.safetensors", length: 8, position: 0 },
    { file: "safe.safetensors", length: limits.get(path.resolve(filePath)), position: 8 },
  ]);
});

test("validate rechecks strength, object_info, header, stat, mode, steps, and fingerprint", async (t) => {
  const fixture = createFixture(t);
  const relativeName = "minimax_h3/character-style.safetensors";
  const filePath = path.join(fixture.lorasPath, "minimax_h3", "character-style.safetensors");
  writeSafetensors(filePath, h3Metadata("fl2va", { revision: "one" }));
  fixture.state.runtimeNames = [relativeName];
  const catalogApi = fixture.makeCatalog();
  const [item] = await catalogApi.catalog({ mode: "image_video", steps: 13 });

  assert.deepEqual(
    await catalogApi.validate({
      mode: "image_video",
      steps: 13,
      name: item.name,
      fingerprint: item.fingerprint,
      strength: 0.75,
    }),
    { ok: true, item, strength: 0.75 },
  );
  assert.equal((await catalogApi.validate({ mode: "bad", steps: 13, name: item.name, fingerprint: item.fingerprint, strength: 1 })).error, "invalid_mode");
  assert.equal((await catalogApi.validate({ mode: "image_video", steps: 0, name: item.name, fingerprint: item.fingerprint, strength: 1 })).error, "invalid_steps");
  assert.equal((await catalogApi.validate({ mode: "image_video", steps: 13, name: "../bad.safetensors", fingerprint: item.fingerprint, strength: 1 })).error, "invalid_name");
  assert.equal((await catalogApi.validate({ mode: "image_video", steps: 13, name: item.name, fingerprint: item.fingerprint, strength: 3 })).error, "invalid_strength");
  assert.equal((await catalogApi.validate({ mode: "multi_reference", steps: 13, name: item.name, fingerprint: item.fingerprint, strength: 1 })).error, "lora_not_available");

  fixture.state.runtimeNames = [];
  assert.equal((await catalogApi.validate({ mode: "image_video", steps: 13, name: item.name, fingerprint: item.fingerprint, strength: 1 })).error, "lora_not_available");
  fixture.state.runtimeNames = [relativeName];

  writeSafetensors(filePath, h3Metadata("fl2va", { revision: crypto.randomUUID() }));
  assert.equal(
    (await catalogApi.validate({ mode: "image_video", steps: 13, name: item.name, fingerprint: item.fingerprint, strength: 1 })).error,
    "fingerprint_mismatch",
  );
});

test("validate rejects a selected file after it moves outside loras/minimax_h3", async (t) => {
  const fixture = createFixture(t);
  const relativeName = "minimax_h3/move-after-selection.safetensors";
  const filePath = path.join(fixture.h3LorasPath, "move-after-selection.safetensors");
  writeSafetensors(filePath, h3Metadata("fl2va"));
  fixture.state.runtimeNames = [relativeName];
  const api = fixture.makeCatalog();
  const [item] = await api.catalog({ mode: "t2v", steps: 4 });
  fs.renameSync(filePath, path.join(fixture.lorasPath, "move-after-selection.safetensors"));

  assert.equal((await api.validate({
    mode: "t2v",
    steps: 4,
    name: relativeName,
    fingerprint: item.fingerprint,
    strength: 1,
  })).error, "lora_not_available");
});

test("returns an empty catalog when config, model root, runtime list, mode, or steps are unavailable", async (t) => {
  const fixture = createFixture(t);
  const missingConfig = createMiniMaxH3LoraCatalog({
    fs,
    path,
    readConfig: () => ({ ok: false, modelsPath: fixture.modelsPath }),
    listRuntimeLoraNames: () => [],
  });
  const runtimeFailure = createMiniMaxH3LoraCatalog({
    fs,
    path,
    readConfig: () => ({ ok: true, modelsPath: fixture.modelsPath }),
    listRuntimeLoraNames: () => { throw new Error("8189 unavailable"); },
  });

  assert.deepEqual(await missingConfig.catalog({ mode: "text_video", steps: 4 }), []);
  assert.deepEqual(await runtimeFailure.catalog({ mode: "text_video", steps: 4 }), []);
  assert.deepEqual(await fixture.makeCatalog().catalog({ mode: "missing", steps: 4 }), []);
  assert.deepEqual(await fixture.makeCatalog().catalog({ mode: "text_video", steps: 10_001 }), []);
});
