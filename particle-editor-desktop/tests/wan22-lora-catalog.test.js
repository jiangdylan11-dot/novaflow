const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_SAFETENSORS_HEADER_BYTES,
  TRUSTED_WAN22_LORA_MANIFEST,
  createWan22LoraCatalog,
} = require("../main/wan22-lora-catalog");

const DTYPE_BYTES = { F16: 2, BF16: 2, F32: 4, I64: 8 };
const STEM_A = "diffusion_model.blocks.0.cross_attn.k";
const STEM_B = "diffusion_model.blocks.0.self_attn.q";

function tensorEntries(specs) {
  let cursor = 0;
  const tensors = {};
  for (const [name, dtype, shape] of specs) {
    const count = shape.reduce((product, value) => product * value, 1);
    const bytes = count * DTYPE_BYTES[dtype];
    tensors[name] = { dtype, shape, data_offsets: [cursor, cursor + bytes] };
    cursor += bytes;
  }
  return tensors;
}

function baseTensors(options = {}) {
  const a = options.a || [8, 8];
  const b = options.b || [12, 8];
  return tensorEntries([
    [`model.${STEM_A}.weight`, "F16", a],
    [`model.${STEM_B}.weight`, "F16", b],
  ]);
}

function loraTensors(options = {}) {
  const rank = options.rank || 2;
  const aInput = options.aInput || 8;
  const aOutput = options.aOutput || 8;
  const bInput = options.bInput || 8;
  const bOutput = options.bOutput || 12;
  return tensorEntries([
    [`${STEM_A}.alpha`, "I64", []],
    [`${STEM_A}.lora_down.weight`, "F16", [rank, aInput]],
    [`${STEM_A}.lora_up.weight`, "F16", [aOutput, rank]],
    [`${STEM_B}.lora_down.weight`, "F16", [rank, bInput]],
    [`${STEM_B}.lora_up.weight`, "F16", [bOutput, rank]],
  ]);
}

function standardMetadata(extra = {}) {
  return {
    ss_wan_lora_base: "wan2.2_i2v_14b",
    ss_wan_lora_role: "shared",
    ss_wan_lora_kind: "standard",
    ...extra,
  };
}

function writeSafetensors(filePath, metadata, tensors) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const header = Buffer.from(JSON.stringify({ __metadata__: metadata || {}, ...tensors }), "utf8");
  const dataBytes = Math.max(0, ...Object.values(tensors).map((tensor) => tensor.data_offsets[1]));
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.length));
  fs.writeFileSync(filePath, Buffer.concat([prefix, header, Buffer.alloc(dataBytes)]));
}

function stableHeaderFingerprint(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const prefix = Buffer.alloc(8);
    fs.readSync(fd, prefix, 0, 8, 0);
    const headerLength = Number(prefix.readBigUInt64LE());
    const header = Buffer.alloc(headerLength);
    fs.readSync(fd, header, 0, header.length, 8);
    return `h1:${fs.statSync(filePath).size}:${crypto.createHash("sha256").update(header).digest("hex")}`;
  } finally {
    fs.closeSync(fd);
  }
}

function createFixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "novaflow-wan22-lora-"));
  const modelsPath = path.join(workspace, "models");
  const unetPath = path.join(modelsPath, "unet");
  const lorasPath = path.join(modelsPath, "loras");
  const wanLorasPath = path.join(lorasPath, "wan2_2");
  const highName = "Wan22_i2vHigh.safetensors";
  const lowName = "Wan22_i2vLow.safetensors";
  fs.mkdirSync(unetPath, { recursive: true });
  fs.mkdirSync(wanLorasPath, { recursive: true });
  writeSafetensors(path.join(unetPath, highName), { role: "high" }, baseTensors());
  writeSafetensors(path.join(unetPath, lowName), { role: "low" }, baseTensors());
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const state = { unets: [highName, lowName], loras: [] };
  function makeCatalog(options = {}) {
    return createWan22LoraCatalog({
      fs: options.fs || fs,
      path,
      readConfig: () => ({ ok: true, modelsPath: options.configModelsPath || modelsPath }),
      expectedModelsPath: () => options.expectedModelsPath || modelsPath,
      listRuntimeModelNames: async () => options.objectInfo || {
        unets: [...state.unets],
        loras: [...state.loras],
      },
      ...(options.trustedManifest ? { trustedManifest: options.trustedManifest } : {}),
    });
  }
  return { workspace, modelsPath, unetPath, lorasPath, wanLorasPath, highName, lowName, state, makeCatalog };
}

function wanName(localName) {
  return `wan2_2/${String(localName).replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

function wanFile(fixture, runtimeName) {
  return path.join(fixture.lorasPath, ...String(runtimeName).replace(/\\/g, "/").split("/"));
}

function context(fixture, overrides = {}) {
  return {
    highName: fixture.highName,
    lowName: fixture.lowName,
    steps: 20,
    ...overrides,
  };
}

test("returns only an explicit shared Wan2.2 I2V 14B standard LoRA that matches both UNETs", async (t) => {
  const fixture = createFixture(t);
  const compatibleName = wanName("shared-style.safetensors");
  writeSafetensors(wanFile(fixture, compatibleName), standardMetadata(), loraTensors());
  fixture.state.loras = [compatibleName];
  const api = fixture.makeCatalog();

  for (const steps of [1, 4, 20, 200, 10_000]) {
    const items = await api.catalog(context(fixture, { steps }));
    assert.equal(items.length, 1);
    assert.equal(items[0].name, compatibleName);
    assert.equal(items[0].modelFamily, "wan2.2_i2v_14b");
    assert.equal(items[0].role, "shared");
    assert.equal(items[0].kind, "standard");
    assert.equal(items[0].supportedSteps, null);
    assert.deepEqual(items[0].strengthRange, { min: 0, max: 2, default: 1, step: 0.05 });
    assert.match(items[0].fingerprint, /^v1:\d+:[\d.]+:[a-f0-9]{64}$/);
    assert.match(items[0].highFingerprint, /^v1:/);
    assert.match(items[0].lowFingerprint, /^v1:/);
  }
});

test("checks High-only against High, Low-only against Low, and shared against both models", async (t) => {
  const fixture = createFixture(t);
  writeSafetensors(path.join(fixture.unetPath, fixture.lowName), { role: "low" }, baseTensors({ a: [9, 8] }));
  const highName = wanName("high-only.safetensors");
  const lowName = wanName("low-only.safetensors");
  const sharedName = wanName("shared-needs-both.safetensors");
  writeSafetensors(
    wanFile(fixture, highName),
    standardMetadata({ ss_wan_lora_role: "high" }),
    loraTensors({ aOutput: 8 }),
  );
  writeSafetensors(
    wanFile(fixture, lowName),
    standardMetadata({ ss_wan_lora_role: "low" }),
    loraTensors({ aOutput: 9 }),
  );
  writeSafetensors(wanFile(fixture, sharedName), standardMetadata(), loraTensors({ aOutput: 8 }));
  fixture.state.loras = [highName, lowName, sharedName];

  const items = await fixture.makeCatalog().catalog(context(fixture));
  assert.deepEqual(
    items.map((item) => [item.name, item.role]).sort((left, right) => left[0].localeCompare(right[0])),
    [[highName, "high"], [lowName, "low"]].sort((left, right) => left[0].localeCompare(right[0])),
  );
});

test("is fail closed for unknown metadata, accelerator, foreign, and partially matching files", async (t) => {
  const fixture = createFixture(t);
  const files = [
    [wanName("unknown.safetensors"), {}, loraTensors()],
    [wanName("turbo-4steps.safetensors"), standardMetadata(), loraTensors()],
    [wanName("declared-accelerator.safetensors"), standardMetadata({ ss_wan_lora_kind: "accelerator" }), loraTensors()],
    [wanName("qwen.safetensors"), standardMetadata(), tensorEntries([
      ["transformer_blocks.0.attn.to_q.lora_down.weight", "F16", [2, 8]],
      ["transformer_blocks.0.attn.to_q.lora_up.weight", "F16", [8, 2]],
    ])],
    [wanName("partial.safetensors"), standardMetadata(), loraTensors({ bInput: 7 })],
  ];
  for (const [name, metadata, tensors] of files) {
    writeSafetensors(wanFile(fixture, name), metadata, tensors);
  }
  fixture.state.loras = files.map(([name]) => name);

  assert.deepEqual(await fixture.makeCatalog().catalog(context(fixture)), []);
});

test("accepts exact trusted role fingerprints and hides manifest accelerators", async (t) => {
  const fixture = createFixture(t);
  const name = wanName("curated-high.safetensors");
  const acceleratorName = wanName("curated-accelerator.safetensors");
  const filePath = wanFile(fixture, name);
  const acceleratorPath = wanFile(fixture, acceleratorName);
  writeSafetensors(filePath, {}, loraTensors());
  writeSafetensors(acceleratorPath, {}, loraTensors());
  fixture.state.loras = [name, acceleratorName];
  assert.deepEqual(await fixture.makeCatalog().catalog(context(fixture)), []);

  const manifest = [
    {
      name,
      headerFingerprint: stableHeaderFingerprint(filePath),
      modelFamily: "wan2.2_i2v_14b",
      role: "high",
      kind: "standard",
    },
    {
      name: acceleratorName,
      headerFingerprint: stableHeaderFingerprint(acceleratorPath),
      modelFamily: "wan2.2_i2v_14b",
      role: "high",
      kind: "accelerator",
      requiredSteps: [4],
    },
  ];
  const [item] = await fixture.makeCatalog({ trustedManifest: manifest }).catalog(context(fixture));
  assert.equal(item.name, name);
  assert.equal(item.role, "high");

  writeSafetensors(filePath, {}, loraTensors({ aInput: 7 }));
  assert.deepEqual(await fixture.makeCatalog({ trustedManifest: manifest }).catalog(context(fixture)), []);
});

test("ships a conservative manifest for three standards and one hidden High 4-step accelerator", () => {
  assert.deepEqual(
    TRUSTED_WAN22_LORA_MANIFEST.map(({ name, role, kind, requiredSteps }) => ({ name, role, kind, requiredSteps })),
    [
      { name: "wan2_2/Sensual_fingering_v1_low_noise手扣.safetensors", role: "low", kind: "standard", requiredSteps: undefined },
      { name: "wan2_2/wan22-i2v-rub-pussy-os-high摩擦阴部.safetensors", role: "high", kind: "standard", requiredSteps: undefined },
      { name: "wan2_2/x-ray_i2v_high_v1.1切面.safetensors", role: "high", kind: "standard", requiredSteps: undefined },
      {
        name: "wan2_2/Wan_2_2_I2V_A14B_HIGH_lightx2v_4step_lora_v1030_rank_64_bf16抽插4.safetensors",
        role: "high",
        kind: "accelerator",
        requiredSteps: [4],
      },
    ],
  );
  assert.equal(TRUSTED_WAN22_LORA_MANIFEST.some((entry) => entry.name.includes("NSFW-22-L-e8")), false);
});

test("intersects object_info and rejects unsafe names, the wrong fixed model root, and category escape", async (t) => {
  const fixture = createFixture(t);
  const name = wanName("shared.safetensors");
  const crossDirectoryName = "cross-directory.safetensors";
  writeSafetensors(wanFile(fixture, name), standardMetadata(), loraTensors());
  writeSafetensors(path.join(fixture.lorasPath, crossDirectoryName), standardMetadata(), loraTensors());
  fixture.state.loras = [];
  assert.deepEqual(await fixture.makeCatalog().catalog(context(fixture)), []);

  fixture.state.loras = [name, crossDirectoryName, "wan2_2/../outside.safetensors"];
  assert.deepEqual((await fixture.makeCatalog().catalog(context(fixture))).map((item) => item.name), [name]);
  const otherModels = path.join(fixture.workspace, "other-models");
  fs.mkdirSync(otherModels, { recursive: true });
  assert.deepEqual(
    await fixture.makeCatalog({ expectedModelsPath: otherModels }).catalog(context(fixture)),
    [],
  );

  const outside = path.join(fixture.workspace, "outside-loras");
  writeSafetensors(path.join(outside, "escape.safetensors"), standardMetadata(), loraTensors());
  const link = path.join(fixture.wanLorasPath, "linked");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    fixture.state.loras = ["wan2_2/linked/escape.safetensors"];
    assert.deepEqual(await fixture.makeCatalog().catalog(context(fixture)), []);
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) throw error;
    t.diagnostic(`junction assertion unavailable: ${error.code}`);
  }
});

test("parses full object_info and rejects swapped, missing, or duplicate High/Low model contexts", async (t) => {
  const fixture = createFixture(t);
  const name = wanName("shared.safetensors");
  writeSafetensors(wanFile(fixture, name), standardMetadata(), loraTensors());
  const objectInfo = {
    UNETLoader: { input: { required: { unet_name: [[fixture.highName, fixture.lowName]] } } },
    LoraLoaderModelOnly: { input: { required: { lora_name: [[name]] } } },
  };
  const api = fixture.makeCatalog({ objectInfo });
  assert.equal((await api.catalog(context(fixture))).length, 1);
  assert.deepEqual(await api.catalog(context(fixture, { highName: fixture.lowName, lowName: fixture.highName })), []);
  assert.deepEqual(await api.catalog(context(fixture, { lowName: fixture.highName })), []);
  assert.deepEqual(await api.catalog(context(fixture, { highName: "missingHigh.safetensors" })), []);
});

test("reads only the 8-byte prefix and JSON headers, never UNET or LoRA tensor bodies", async (t) => {
  const fixture = createFixture(t);
  const name = wanName("shared.safetensors");
  writeSafetensors(wanFile(fixture, name), standardMetadata(), loraTensors());
  fixture.state.loras = [name];
  const tracked = Object.create(fs);
  const limits = new Map();
  const opens = new Map();
  tracked.openSync = (filePath, flags) => {
    const fd = fs.openSync(filePath, flags);
    const prefix = Buffer.alloc(8);
    fs.readSync(fd, prefix, 0, 8, 0);
    limits.set(fd, 8 + Number(prefix.readBigUInt64LE()));
    opens.set(fd, filePath);
    return fd;
  };
  tracked.readSync = (fd, buffer, offset, length, position) => {
    assert.ok(position + length <= limits.get(fd), `tensor body read: ${opens.get(fd)}`);
    return fs.readSync(fd, buffer, offset, length, position);
  };
  tracked.closeSync = (fd) => {
    limits.delete(fd);
    opens.delete(fd);
    return fs.closeSync(fd);
  };

  assert.equal((await fixture.makeCatalog({ fs: tracked }).catalog(context(fixture))).length, 1);
});

test("rejects damaged and oversized headers without allocating tensor data", async (t) => {
  const fixture = createFixture(t);
  const brokenName = wanName("broken.safetensors");
  const oversizedName = wanName("oversized.safetensors");
  const brokenHeader = Buffer.from("{broken", "utf8");
  const brokenPrefix = Buffer.alloc(8);
  brokenPrefix.writeBigUInt64LE(BigInt(brokenHeader.length));
  fs.writeFileSync(wanFile(fixture, brokenName), Buffer.concat([brokenPrefix, brokenHeader]));
  const oversizedPrefix = Buffer.alloc(8);
  oversizedPrefix.writeBigUInt64LE(BigInt(MAX_SAFETENSORS_HEADER_BYTES + 1));
  fs.writeFileSync(wanFile(fixture, oversizedName), oversizedPrefix);
  fixture.state.loras = [brokenName, oversizedName];

  assert.deepEqual(await fixture.makeCatalog().catalog(context(fixture)), []);
});

test("validate rechecks LoRA and both model fingerprints, object_info, steps, and strength", async (t) => {
  const fixture = createFixture(t);
  const name = wanName("shared.safetensors");
  const loraPath = wanFile(fixture, name);
  writeSafetensors(loraPath, standardMetadata({ revision: "one" }), loraTensors());
  fixture.state.loras = [name];
  const api = fixture.makeCatalog();
  const [item] = await api.catalog(context(fixture));
  const payload = {
    ...context(fixture),
    name,
    role: item.role,
    fingerprint: item.fingerprint,
    highFingerprint: item.highFingerprint,
    lowFingerprint: item.lowFingerprint,
    strength: 0.8,
  };
  assert.deepEqual(await api.validate(payload), { ok: true, item, strength: 0.8 });
  assert.equal((await api.validate({ ...payload, steps: 0 })).error, "invalid_steps");
  assert.equal((await api.validate({ ...payload, role: "" })).error, "invalid_role");
  assert.equal((await api.validate({ ...payload, role: "high" })).error, "role_mismatch");
  assert.equal((await api.validate({ ...payload, strength: 3 })).error, "invalid_strength");
  assert.equal((await api.validate({ ...payload, highFingerprint: "stale" })).error, "high_model_fingerprint_mismatch");
  assert.equal((await api.validate({ ...payload, lowFingerprint: "stale" })).error, "low_model_fingerprint_mismatch");

  writeSafetensors(loraPath, standardMetadata({ revision: crypto.randomUUID() }), loraTensors());
  assert.equal((await api.validate(payload)).error, "fingerprint_mismatch");

  const refreshedItem = (await api.catalog(context(fixture)))[0];
  writeSafetensors(
    path.join(fixture.unetPath, fixture.highName),
    { role: "high", revision: crypto.randomUUID() },
    baseTensors(),
  );
  assert.equal((await api.validate({
    ...payload,
    fingerprint: refreshedItem.fingerprint,
    highFingerprint: refreshedItem.highFingerprint,
    lowFingerprint: refreshedItem.lowFingerprint,
  })).error, "high_model_fingerprint_mismatch");

  const postModelChangeItem = (await api.catalog(context(fixture)))[0];
  fixture.state.loras = [];
  assert.equal((await api.validate({
    ...payload,
    fingerprint: postModelChangeItem.fingerprint,
    highFingerprint: postModelChangeItem.highFingerprint,
    lowFingerprint: postModelChangeItem.lowFingerprint,
  })).error, "lora_not_available");
});

test("validate rejects a selected file after it moves outside loras/wan2_2", async (t) => {
  const fixture = createFixture(t);
  const name = wanName("move-after-selection.safetensors");
  const loraPath = wanFile(fixture, name);
  writeSafetensors(loraPath, standardMetadata({ ss_wan_lora_role: "high" }), loraTensors());
  fixture.state.loras = [name];
  const api = fixture.makeCatalog();
  const [item] = await api.catalog(context(fixture));
  const payload = {
    ...context(fixture),
    name,
    role: item.role,
    fingerprint: item.fingerprint,
    highFingerprint: item.highFingerprint,
    lowFingerprint: item.lowFingerprint,
    strength: 1,
  };
  fs.renameSync(loraPath, path.join(fixture.lorasPath, "move-after-selection.safetensors"));

  assert.equal((await api.validate(payload)).error, "lora_not_available");
});
