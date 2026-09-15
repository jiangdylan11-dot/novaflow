import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function loadCommonJsModule(file, requireMap = {}) {
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    require(specifier) {
      if (Object.hasOwn(requireMap, specifier)) return requireMap[specifier]
      throw new Error(`Unexpected CommonJS dependency: ${specifier}`)
    },
    AbortController,
    Blob,
    TextEncoder,
    URLSearchParams,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
  }
  sandbox.globalThis = sandbox
  runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file })
  return { api: module.exports, sandbox }
}

const localModule = loadCommonJsModule('particle-editor/aifx-local.workflow.js')
const local = localModule.api
const generateModule = loadCommonJsModule('particle-editor/aifx-generate.workflow.js', {
  './aifx-local.workflow.js': local,
})
const generate = generateModule.api

assert.equal(localModule.sandbox.NovaFlowAifxLocalWorkflow, local)
assert.equal(generateModule.sandbox.NovaFlowAifxGenerateWorkflow, generate)

function combo(values) {
  return [values, {}]
}

function node(required = {}, optional = {}) {
  return { input: { required, optional } }
}

function objectInfoFixture() {
  return {
    UNETLoader: node({
      unet_name: combo([
        'Qwen-Image-Edit-2509_fp8_e4m3fn.safetensors',
        'qwen_image_edit_2511_bf16.safetensors',
        'qwen_image_edit_2511_fp8mixed.safetensors',
      ]),
      weight_dtype: combo(['default', 'fp8_e4m3fn', 'fp8_e5m2']),
    }),
    LoraLoaderModelOnly: node({
      model: ['MODEL', {}],
      lora_name: combo([
        'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors',
        'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
        'eigen-banana-qwen-image-edit-2509-fp16-lora.safetensors',
      ]),
      strength_model: ['FLOAT', {}],
    }),
    CLIPLoader: node({
      clip_name: combo(['clip_l.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors']),
      type: ['COMBO', { options: ['stable_diffusion', 'qwen_image'] }],
    }, { device: combo(['default', 'cpu']) }),
    VAELoader: node({ vae_name: combo(['qwen_image_layered_vae.safetensors', 'qwen_image_vae.safetensors']) }),
    LoadImage: node({ image: ['COMBO', { image_upload: true }] }),
    TextEncodeQwenImageEditPlus: node({ clip: ['CLIP', {}], prompt: ['STRING', {}] }, {
      vae: ['VAE', {}],
      image1: ['IMAGE', {}],
      image2: ['IMAGE', {}],
      image3: ['IMAGE', {}],
    }),
    TextEncodeQwenImageEdit: node({ clip: ['CLIP', {}], prompt: ['STRING', {}] }, {
      vae: ['VAE', {}],
      image: ['IMAGE', {}],
    }),
    ConditioningAverage: node({
      conditioning_to: ['CONDITIONING', {}],
      conditioning_from: ['CONDITIONING', {}],
      conditioning_to_strength: ['FLOAT', {}],
    }),
    ConditioningSetTimestepRange: node({
      conditioning: ['CONDITIONING', {}],
      start: ['FLOAT', {}],
      end: ['FLOAT', {}],
    }),
    ConditioningCombine: node({
      conditioning_1: ['CONDITIONING', {}],
      conditioning_2: ['CONDITIONING', {}],
    }),
    ControlNetLoader: node({ control_net_name: combo(['Qwen-Image-ControlNet-Union.safetensors']) }),
    SetUnionControlNetType: node({
      control_net: ['CONTROL_NET', {}],
      type: ['COMBO', { options: ['auto', 'hed/pidi/scribble/ted', 'canny/lineart/anime_lineart/mlsd', 'depth'] }],
    }),
    ControlNetApplyAdvanced: node({
      positive: ['CONDITIONING', {}],
      negative: ['CONDITIONING', {}],
      control_net: ['CONTROL_NET', {}],
      image: ['IMAGE', {}],
      strength: ['FLOAT', {}],
      start_percent: ['FLOAT', {}],
      end_percent: ['FLOAT', {}],
    }, { vae: ['VAE', {}] }),
    EmptyQwenImageLayeredLatentImage: node({
      width: ['INT', {}],
      height: ['INT', {}],
      layers: ['INT', {}],
      batch_size: ['INT', {}],
    }),
    KSampler: node({
      model: ['MODEL', {}],
      seed: ['INT', {}],
      steps: ['INT', {}],
      cfg: ['FLOAT', {}],
      sampler_name: combo(['euler', 'dpmpp_2m']),
      scheduler: combo(['simple', 'karras']),
      positive: ['CONDITIONING', {}],
      negative: ['CONDITIONING', {}],
      latent_image: ['LATENT', {}],
      denoise: ['FLOAT', {}],
    }),
    VAEDecode: node({ samples: ['LATENT', {}], vae: ['VAE', {}] }),
    SaveImage: node({ images: ['IMAGE', {}], filename_prefix: ['STRING', {}] }),
  }
}

function workflowEntries(workflow, type) {
  return Object.entries(workflow).filter(([, item]) => item.class_type === type)
}

function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
}

function occurrenceCount(value, token) {
  return String(value).split(token).length - 1
}

function assertLocalWorkflowContract() {
  const info = objectInfoFixture()
  const resolved = local.resolveModels(info)
  assert.equal(resolved.unet, 'qwen_image_edit_2511_fp8mixed.safetensors')
  assert.equal(resolved.lora, 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors')
  assert.equal(resolved.clip, 'qwen_2.5_vl_7b_fp8_scaled.safetensors')
  assert.equal(resolved.vae, 'qwen_image_vae.safetensors')
  assert.equal(resolved.controlNet, 'Qwen-Image-ControlNet-Union.safetensors')
  assert.equal(resolved.controlType, 'hed/pidi/scribble/ted')

  const built = local.buildWorkflow({
    objectInfo: info,
    sheetImageName: 'control_sheet.png',
    styleImageName: 'style_reference.png',
    width: 1537,
    height: 769,
    frameCount: 9,
    prompt: 'coherent blue-white branching lightning material',
    strength: 0.73,
    seed: 42,
    outputPrefix: 'contract/aifx',
  })
  const workflow = built.workflow
  assert.equal(built.effectiveStrength, 0.73)
  assert.equal(built.width, 1552)
  assert.equal(built.height, 784)
  assert.ok(built.warnings.some((warning) => warning.includes('aligned')))
  assert.equal(workflowEntries(workflow, 'TextEncodeQwenImageEditPlus').length, 2)
  assert.equal(workflowEntries(workflow, 'IPAdapter').length, 0)
  assert.equal(Object.values(workflow).some((item) => /IPAdapter|CheckpointLoaderSimple/i.test(item.class_type)), false)

  const structure = workflowEntries(workflow, 'TextEncodeQwenImageEditPlus')[0][1]
  const style = workflowEntries(workflow, 'TextEncodeQwenImageEditPlus')[1][1]
  assertJsonEqual(structure.inputs.image1, ['1', 0])
  assert.equal(Object.hasOwn(structure.inputs, 'image2'), false)
  assertJsonEqual(style.inputs.image1, ['1', 0])
  assertJsonEqual(style.inputs.image2, ['2', 0])
  assert.match(style.inputs.prompt, /coherent blue-white branching lightning material/)
  assert.match(structure.inputs.prompt, /F1\u2192F9 CONTINUOUS SEQUENCE PLAN/)
  assert.match(style.inputs.prompt, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(lightning\)/)
  assert.match(style.inputs.prompt, /sharp forks, gaps, re-branches, and short plasma offshoots/)
  assert.match(style.inputs.prompt, /never a gallery, contact-sheet variants, or independent design options/)
  const modelFacingPrompts = `${structure.inputs.prompt}\n${style.inputs.prompt}`
  assert.equal(occurrenceCount(modelFacingPrompts, 'CONTINUOUS SEQUENCE PLAN'), 1)
  assert.equal(occurrenceCount(modelFacingPrompts, 'MATERIAL-SPECIFIC OUTLINE EVOLUTION'), 1)
  assert.equal(built.sequencePlan.length, 9)
  assert.equal(built.sequencePlan[0].phase, 'onset')
  assert.equal(built.sequencePlan[4].phase, 'peak')
  assert.equal(built.sequencePlan[8].phase, 'decay')

  const average = workflowEntries(workflow, 'ConditioningAverage')[0][1]
  assertJsonEqual(average.inputs.conditioning_to, ['8', 0])
  assertJsonEqual(average.inputs.conditioning_from, ['7', 0])
  assert.equal(built.conditioningStrength, 0.5814)
  assert.equal(average.inputs.conditioning_to_strength, built.conditioningStrength)

  const control = workflowEntries(workflow, 'ControlNetApplyAdvanced')[0][1]
  assertJsonEqual(control.inputs.positive, ['9', 0])
  assertJsonEqual(control.inputs.image, ['1', 0])
  assertJsonEqual(control.inputs.control_net, ['12', 0])
  assert.equal(control.inputs.strength, local.DEFAULT_CONTROL_STRENGTH)
  assert.equal(control.inputs.end_percent, local.DEFAULT_CONTROL_END_PERCENT)
  assert.equal(built.controlType, 'hed/pidi/scribble/ted')
  assert.equal(built.controlStrength, 0.62)
  assert.equal(built.controlEndPercent, 0.72)
  const sampler = workflowEntries(workflow, 'KSampler')[0][1]
  assertJsonEqual(sampler.inputs.model, ['4', 0])
  assert.equal(sampler.inputs.steps, 4)
  assert.equal(sampler.inputs.seed, 42)
  assertJsonEqual(sampler.inputs.positive, ['13', 0])
  assertJsonEqual(sampler.inputs.negative, ['13', 1])

  const configuredControl = local.buildWorkflow({
    objectInfo: info,
    sheetImageName: 'control_sheet.png',
    styleImageName: 'style_reference.png',
    width: 512,
    height: 512,
    frameCount: 4,
    prompt: 'faceted ice shards',
    controlStrength: 0.44,
    controlEndPercent: 0.58,
    seed: 7,
  })
  const configuredControlNode = workflowEntries(configuredControl.workflow, 'ControlNetApplyAdvanced')[0][1]
  assert.equal(configuredControlNode.inputs.strength, 0.44)
  assert.equal(configuredControlNode.inputs.end_percent, 0.58)
  assert.equal(configuredControl.sequencePlan.length, 4)
  assert.match(configuredControl.prompts.style, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(ice\)/)

  const explicitIceWithElectricStyle = local.compilePrompts({
    frameCount: 4,
    materialType: 'ice',
    prompt: 'crystalline ice with electric glow and plasma-like highlights',
    styleDescription: 'electric energy with cool highlights',
  })
  assert.equal(explicitIceWithElectricStyle.materialType, 'ice')
  assert.match(explicitIceWithElectricStyle.style, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(ice\)/)
  assert.doesNotMatch(explicitIceWithElectricStyle.style, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(lightning\)/)

  const customStyleFire = local.compilePrompts({
    frameCount: 4,
    stylePrompt: 'orange fire tongues with ember breakup',
  })
  assert.equal(customStyleFire.materialType, 'fire')
  assert.match(customStyleFire.style, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(fire\)/)
  assert.match(customStyleFire.structure, /F1\u2192F4 CONTINUOUS SEQUENCE PLAN/)
  assert.doesNotMatch(customStyleFire.style, /CONTINUOUS SEQUENCE PLAN/)

  const aliasSequencePlan = local.normalizeSequencePlan([
    { phase: 'start' },
    { phase: 'build' },
    { phase: 'climax' },
    { phase: 'followThrough' },
    { phase: 'fade_out' },
    { phase: 'break-up' },
    { phase: 'end' },
  ], 7)
  assert.deepEqual(
    Array.from(aliasSequencePlan, (frame) => frame.phase),
    ['onset', 'growth', 'peak', 'follow-through', 'decay', 'breakup', 'dissipation'],
  )

  const finalStructurePrompt = 'FINAL STRUCTURE F1\u2192F4 CONTINUOUS SEQUENCE PLAN'
  const finalStylePrompt = 'FINAL STYLE MATERIAL-SPECIFIC OUTLINE EVOLUTION (fire)'
  const precompiled = local.buildWorkflow({
    objectInfo: info,
    sheetImageName: 'control_sheet.png',
    styleImageName: 'style_reference.png',
    width: 512,
    height: 512,
    frameCount: 4,
    prompt: 'raw fire material direction',
    structurePrompt: finalStructurePrompt,
    stylePrompt: finalStylePrompt,
    promptsPrecompiled: true,
    seed: 11,
  })
  const precompiledEncoders = workflowEntries(precompiled.workflow, 'TextEncodeQwenImageEditPlus')
  assert.equal(precompiledEncoders[0][1].inputs.prompt, finalStructurePrompt)
  assert.equal(precompiledEncoders[1][1].inputs.prompt, finalStylePrompt)
  assert.equal(precompiled.promptsPrecompiled, true)
  const precompiledModelFacingPrompts = precompiledEncoders.map(([, encoder]) => encoder.inputs.prompt).join('\n')
  assert.equal(occurrenceCount(precompiledModelFacingPrompts, 'CONTINUOUS SEQUENCE PLAN'), 1)
  assert.equal(occurrenceCount(precompiledModelFacingPrompts, 'MATERIAL-SPECIFIC OUTLINE EVOLUTION'), 1)

  const peakAnchorFrame = {
    globalIndex: 4,
    phase: 'peak',
    energy: 1,
    centerX: 0.58,
    centerY: 0.47,
    directionDeg: 22,
    occupancy: 0.86,
  }
  const peakAnchor = local.buildWorkflow({
    objectInfo: info,
    guideImageName: 'peak_guide.png',
    styleImageName: 'style_reference.png',
    width: 752,
    height: 384,
    anchorRole: 'peak',
    anchorFrame: peakAnchorFrame,
    structurePrompt: 'Create one isolated peak VFX frame on black.',
    stylePrompt: 'Render the strongest peak material identity.',
    promptsPrecompiled: true,
    seed: 12,
  })
  assert.equal(peakAnchor.anchorRole, 'peak')
  assert.equal(peakAnchor.anchorFrame.globalIndex, 4)
  assert.equal(peakAnchor.identityConditioned, false)
  assert.equal(peakAnchor.semanticMaterialConditioning, false)
  assert.equal(peakAnchor.visualReferenceConnected, true)
  assert.equal(peakAnchor.sequencePlan.length, 0)
  assert.equal(peakAnchor.conditioningMode, 'early-visual-material-late-motion-synthesis')
  assert.equal(peakAnchor.visualReferenceEndPercent, 0.25)
  assert.equal(Object.hasOwn(peakAnchor.workflow, '18'), false)
  assert.equal(peakAnchor.workflow['7'].class_type, 'TextEncodeQwenImageEdit')
  assert.equal(Object.hasOwn(peakAnchor.workflow['7'].inputs, 'image1'), false)
  assert.equal(peakAnchor.workflow['7'].inputs.prompt, 'Create one isolated peak VFX frame on black.')
  assertJsonEqual(peakAnchor.workflow['8'].inputs.image1, ['2', 0])
  assert.equal(Object.hasOwn(peakAnchor.workflow['8'].inputs, 'image2'), false)
  assert.equal(peakAnchor.workflow['19'].class_type, 'ConditioningSetTimestepRange')
  assertJsonEqual(peakAnchor.workflow['19'].inputs.conditioning, ['8', 0])
  assert.equal(peakAnchor.workflow['19'].inputs.start, 0)
  assert.equal(peakAnchor.workflow['19'].inputs.end, 0.25)
  assertJsonEqual(peakAnchor.workflow['20'].inputs.conditioning, ['7', 0])
  assert.equal(peakAnchor.workflow['20'].inputs.start, 0.25)
  assert.equal(peakAnchor.workflow['20'].inputs.end, 1)
  assertJsonEqual(peakAnchor.workflow['21'].inputs.conditioning_1, ['19', 0])
  assertJsonEqual(peakAnchor.workflow['21'].inputs.conditioning_2, ['20', 0])
  assertJsonEqual(peakAnchor.workflow['13'].inputs.positive, ['21', 0])
  assert.equal(peakAnchor.workflow['1'].inputs.image, 'peak_guide.png')

  const breakupAnchor = local.buildWorkflow({
    objectInfo: info,
    guideImageName: 'breakup_guide.png',
    styleImageName: 'generated_peak_identity.png',
    width: 752,
    height: 384,
    anchorRole: 'breakup',
    materialReferenceMode: 'generated-peak-material-token',
    anchorFrame: {
      ...peakAnchorFrame,
      globalIndex: 7,
      phase: 'breakup',
      energy: 0.1,
      occupancy: 0.12,
    },
    structurePrompt: 'Create one isolated breakup VFX frame on black.',
    stylePrompt: 'Carry the reference-derived peak material identity semantically.',
    promptsPrecompiled: true,
    seed: 121,
  })
  assert.equal(breakupAnchor.tailMaterialVocabulary, true)
  assert.equal(breakupAnchor.semanticMaterialConditioning, false)
  assert.equal(breakupAnchor.peakMaterialTokenConditioning, true)
  assert.equal(breakupAnchor.visualReferenceConnected, true)
  assert.equal(breakupAnchor.visualReferenceEffective, true)
  assert.equal(breakupAnchor.conditioningMode, 'parallel-early-peak-material-token-tail-topology-synthesis')
  assert.equal(breakupAnchor.visualReferenceEndPercent, 0.12)
  assert.equal(breakupAnchor.workflow['8'].class_type, 'TextEncodeQwenImageEditPlus')
  assertJsonEqual(breakupAnchor.workflow['8'].inputs.image1, ['2', 0])
  assert.equal(Object.hasOwn(breakupAnchor.workflow['8'].inputs, 'image2'), false)
  assertJsonEqual(breakupAnchor.workflow['19'].inputs.conditioning, ['8', 0])
  assert.equal(breakupAnchor.workflow['19'].inputs.start, 0)
  assert.equal(breakupAnchor.workflow['19'].inputs.end, 0.12)
  assertJsonEqual(breakupAnchor.workflow['20'].inputs.conditioning, ['7', 0])
  assert.equal(breakupAnchor.workflow['20'].inputs.start, 0)
  assert.equal(breakupAnchor.workflow['20'].inputs.end, 1)
  assertJsonEqual(breakupAnchor.workflow['21'].inputs.conditioning_1, ['19', 0])
  assertJsonEqual(breakupAnchor.workflow['21'].inputs.conditioning_2, ['20', 0])
  assertJsonEqual(breakupAnchor.workflow['13'].inputs.positive, ['21', 0])

  const dissipationAnchor = local.buildWorkflow({
    objectInfo: info,
    guideImageName: 'dissipation_guide.png',
    styleImageName: 'generated_peak_identity.png',
    width: 752,
    height: 384,
    anchorRole: 'dissipation',
    materialReferenceMode: 'generated-peak-material-token',
    anchorFrame: {
      ...peakAnchorFrame,
      globalIndex: 8,
      phase: 'dissipation',
      energy: 0.03,
      occupancy: 0.025,
    },
    structurePrompt: 'Create one isolated dissipation VFX frame on black.',
    stylePrompt: 'Carry the reference-derived peak material identity semantically.',
    promptsPrecompiled: true,
    seed: 122,
  })
  assert.equal(dissipationAnchor.visualReferenceEndPercent, 0.12)
  assert.equal(dissipationAnchor.conditioningMode, 'parallel-early-peak-material-token-tail-topology-synthesis')
  assertJsonEqual(dissipationAnchor.workflow['19'].inputs.conditioning, ['8', 0])
  assert.equal(dissipationAnchor.workflow['19'].inputs.start, 0)
  assert.equal(dissipationAnchor.workflow['19'].inputs.end, 0.12)
  assertJsonEqual(dissipationAnchor.workflow['20'].inputs.conditioning, ['7', 0])
  assert.equal(dissipationAnchor.workflow['20'].inputs.start, 0)
  assert.equal(dissipationAnchor.workflow['20'].inputs.end, 1)
  assertJsonEqual(dissipationAnchor.workflow['21'].inputs.conditioning_1, ['19', 0])
  assertJsonEqual(dissipationAnchor.workflow['21'].inputs.conditioning_2, ['20', 0])

  const directReferenceTail = local.buildWorkflow({
    objectInfo: info,
    guideImageName: 'direct_tail_guide.png',
    styleImageName: 'full_reference.png',
    width: 752,
    height: 384,
    anchorRole: 'breakup',
    anchorFrame: {
      ...peakAnchorFrame,
      globalIndex: 7,
      phase: 'breakup',
    },
    structurePrompt: 'Create one isolated breakup VFX frame on black.',
    stylePrompt: 'Use the full reference material.',
    promptsPrecompiled: true,
    seed: 123,
  })
  assert.equal(directReferenceTail.conditioningMode, 'early-visual-material-late-motion-synthesis')
  assert.equal(directReferenceTail.peakMaterialTokenConditioning, false)
  assert.equal(directReferenceTail.workflow['20'].inputs.start, 0.12)

  const onsetAnchorFrame = {
    ...peakAnchorFrame,
    globalIndex: 0,
    phase: 'onset',
    energy: 0.1,
    occupancy: 0.12,
  }
  const onsetAnchor = local.buildWorkflow({
    objectInfo: info,
    guideImageName: 'onset_guide.png',
    styleImageName: 'style_reference.png',
    identityImageName: 'generated_peak.png',
    width: 752,
    height: 384,
    anchorRole: 'onset',
    anchorFrame: onsetAnchorFrame,
    structurePrompt: 'Create one isolated onset VFX frame on black.',
    stylePrompt: 'Keep the same identity as image3 while obeying image1 onset geometry.',
    promptsPrecompiled: true,
    seed: 13,
  })
  assert.equal(onsetAnchor.anchorRole, 'onset')
  assert.equal(onsetAnchor.identityConditioned, true)
  assert.equal(onsetAnchor.semanticMaterialConditioning, false)
  assert.equal(onsetAnchor.visualReferenceConnected, true)
  assert.equal(onsetAnchor.sequencePlan.length, 0)
  assert.equal(onsetAnchor.workflow['18'].class_type, 'LoadImage')
  assert.equal(onsetAnchor.workflow['18'].inputs.image, 'generated_peak.png')
  assert.equal(Object.hasOwn(onsetAnchor.workflow['7'].inputs, 'image1'), false)
  assertJsonEqual(onsetAnchor.workflow['8'].inputs.image1, ['2', 0])
  assertJsonEqual(onsetAnchor.workflow['8'].inputs.image2, ['18', 0])
  assert.equal(Object.hasOwn(onsetAnchor.workflow['8'].inputs, 'image3'), false)
  assertJsonEqual(onsetAnchor.workflow['13'].inputs.positive, ['21', 0])
  assertJsonEqual(onsetAnchor.workflow['13'].inputs.image, ['1', 0])

  assert.throws(
    () => local.buildWorkflow({
      objectInfo: info,
      guideImageName: 'peak_guide.png',
      styleImageName: 'style_reference.png',
      identityImageName: 'forbidden.png',
      width: 752,
      height: 384,
      anchorRole: 'peak',
      anchorFrame: peakAnchorFrame,
      structurePrompt: 'peak structure',
      stylePrompt: 'peak style',
      promptsPrecompiled: true,
    }),
    (error) => error?.code === 'AIFX_LOCAL_ANCHOR_IDENTITY_FORBIDDEN',
  )
  const sharedSeedDecayAnchor = local.buildWorkflow({
    objectInfo: info,
    guideImageName: 'decay_guide.png',
    styleImageName: 'style_reference.png',
    width: 752,
    height: 384,
    anchorRole: 'decay',
    materialReferenceMode: 'generated-peak-material-token',
    anchorFrame: { ...peakAnchorFrame, phase: 'decay' },
    structurePrompt: 'decay structure',
    stylePrompt: 'shared-seed decay style',
    promptsPrecompiled: true,
    seed: 13,
  })
  assert.equal(sharedSeedDecayAnchor.identityConditioned, false)
  assert.equal(sharedSeedDecayAnchor.semanticMaterialConditioning, false)
  assert.equal(sharedSeedDecayAnchor.peakMaterialTokenConditioning, true)
  assert.equal(sharedSeedDecayAnchor.visualReferenceConnected, true)
  assert.equal(sharedSeedDecayAnchor.visualReferenceEffective, true)
  assert.equal(sharedSeedDecayAnchor.visualReferenceEndPercent, 0.25)
  assert.equal(sharedSeedDecayAnchor.conditioningMode, 'early-peak-material-token-phase-topology-synthesis')
  assert.equal(Object.hasOwn(sharedSeedDecayAnchor.workflow, '18'), false)
  assertJsonEqual(sharedSeedDecayAnchor.workflow['8'].inputs.image1, ['2', 0])
  assert.equal(Object.hasOwn(sharedSeedDecayAnchor.workflow['8'].inputs, 'image2'), false)
  assert.equal(Object.hasOwn(sharedSeedDecayAnchor.workflow['8'].inputs, 'image3'), false)
  assertJsonEqual(sharedSeedDecayAnchor.workflow['13'].inputs.positive, ['21', 0])
  assert.equal(sharedSeedDecayAnchor.workflow['15'].inputs.seed, 13)

  const withoutImage2 = objectInfoFixture()
  delete withoutImage2.TextEncodeQwenImageEditPlus.input.optional.image2
  assert.equal(local.supportsIdentityImage(withoutImage2), false)
  const legacyWithoutImage2 = local.buildWorkflow({
    objectInfo: withoutImage2,
    sheetImageName: 'control_sheet.png',
    styleImageName: 'style_reference.png',
    width: 512,
    height: 512,
    frameCount: 4,
  })
  assert.equal(Object.hasOwn(legacyWithoutImage2.workflow['8'].inputs, 'image3'), false)
  assert.throws(
    () => local.buildWorkflow({
      objectInfo: withoutImage2,
      guideImageName: 'onset_guide.png',
      styleImageName: 'style_reference.png',
      identityImageName: 'generated_peak.png',
      width: 752,
      height: 384,
      anchorRole: 'onset',
      anchorFrame: onsetAnchorFrame,
      structurePrompt: 'onset structure',
      stylePrompt: 'onset style',
      promptsPrecompiled: true,
    }),
    (error) => error?.code === 'AIFX_LOCAL_IDENTITY_INPUT_UNAVAILABLE',
  )

  const lineArtFallback = objectInfoFixture()
  lineArtFallback.SetUnionControlNetType.input.required.type = combo(['auto', 'canny/lineart/anime_lineart/mlsd', 'depth'])
  assert.equal(local.resolveModels(lineArtFallback).controlType, 'canny/lineart/anime_lineart/mlsd')

  const staleOnly = objectInfoFixture()
  staleOnly.UNETLoader.input.required.unet_name = combo(['Qwen-Image-Edit-2509_fp8_e4m3fn.safetensors'])
  assert.throws(
    () => local.resolveModels(staleOnly),
    (error) => error?.code === 'AIFX_LOCAL_MODEL_UNAVAILABLE' && /2511/.test(error.message),
  )
  return built
}

function imageDataUrl(payload) {
  return `data:image/png;base64,${Buffer.from(payload).toString('base64')}`
}

function createBridgeFixture(info, calls) {
  return {
    timeouts: {},
    async detectBaseUrl() {
      calls.push(['detect'])
      return 'http://127.0.0.1:8188'
    },
    async requestJson(baseUrl, path, init) {
      calls.push(['request', baseUrl, path, init?.method || 'GET'])
      if (path === '/object_info') return { ok: true, data: info }
      if (path === '/prompt') {
        const body = JSON.parse(init.body)
        assert.equal(body.client_id, 'aifx-contract-client')
        assert.ok(body.prompt && typeof body.prompt === 'object')
        return { ok: true, data: { prompt_id: 'prompt-contract-1' } }
      }
      if (path === '/history/prompt-contract-1') {
        return {
          ok: true,
          data: {
            'prompt-contract-1': {
              outputs: {
                '17': { images: [{ filename: 'raw_sheet.png', subfolder: 'aifx', type: 'output' }] },
              },
            },
          },
        }
      }
      throw new Error(`Unexpected request path: ${path}`)
    },
    async fetchBlob(baseUrl, path) {
      calls.push(['download', baseUrl, path])
      assert.match(path, /filename=raw_sheet\.png/)
      return new Blob([Buffer.from('raw-sheet')], { type: 'image/png' })
    },
    async uploadDataUrl(baseUrl, name, dataUrl) {
      calls.push(['upload', baseUrl, name, dataUrl])
      return `uploaded_${name}`
    },
    async validateWorkflowNodes(baseUrl, workflow) {
      calls.push(['validate', baseUrl, workflow])
      for (const item of Object.values(workflow)) assert.ok(info[item.class_type], `missing fixture node ${item.class_type}`)
    },
    extractFiles(history) {
      return history?.outputs?.['17']?.images || []
    },
    historyErrorMessage() {
      return ''
    },
    async readQueueState() {
      calls.push(['queue'])
      return { running: 1, pending: 0, empty: false }
    },
    withTimeout(task) {
      return Promise.resolve().then(task)
    },
    async blobToDataUrl(blob) {
      calls.push(['blobToDataUrl', blob.type])
      return imageDataUrl('generated-raw-sheet')
    },
  }
}

function queueTuple(promptId, clientId, embedded = {}) {
  return [1, promptId, embedded, { client_id: clientId }, []]
}

function generationInput(bridge, options = {}) {
  return {
    provider: 'local',
    bridge,
    signal: options.signal,
    sheet: { name: 'sheet.png', dataUrl: imageDataUrl('sheet'), width: 32, height: 32 },
    styleReference: { name: 'style.png', dataUrl: imageDataUrl('style') },
    prompt: 'contract cancellation fire material',
    clientId: 'aifx-contract-client',
    pollIntervalMs: 0,
    timeoutMs: options.timeoutMs ?? 2000,
  }
}

function createCancellationBridge(options = {}) {
  const calls = []
  const mutations = []
  const controller = options.controller
  const bridge = createBridgeFixture(objectInfoFixture(), calls)
  const originalRequestJson = bridge.requestJson.bind(bridge)
  let ownLocation = options.ownLocation || 'pending'
  let historyStarted = false
  const foreignPromptId = 'foreign-prompt-9'

  const queuePayload = () => ({
    queue_pending: [
      ...(ownLocation === 'pending' ? [queueTuple('prompt-contract-1', options.ownClientId || 'aifx-contract-client')] : []),
      ...(options.includeForeign === false ? [] : [queueTuple(foreignPromptId, 'foreign-client', {
        note: options.embedOwnIdInForeign ? 'prompt-contract-1' : 'foreign workflow',
      })]),
    ],
    queue_running: [
      ...(ownLocation === 'running' ? [queueTuple('prompt-contract-1', options.ownClientId || 'aifx-contract-client')] : []),
      ...(options.foreignRunning ? [queueTuple('foreign-running-2', 'foreign-client')] : []),
    ],
  })

  bridge.requestJson = async (baseUrl, path, init = {}) => {
    if (path === '/history/prompt-contract-1') {
      calls.push(['request', baseUrl, path, init.method || 'GET'])
      if (!historyStarted) {
        historyStarted = true
        if (controller) controller.abort('contract cancellation after prompt submit')
      }
      return new Promise(() => {})
    }
    if (path === '/queue' && (init.method || 'GET') === 'GET') {
      calls.push(['request', baseUrl, path, 'GET'])
      return { ok: true, status: 200, data: queuePayload() }
    }
    if (path === '/queue' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      mutations.push({ path, body, init })
      calls.push(['request', baseUrl, path, 'POST'])
      if (body.delete?.includes('prompt-contract-1') && ownLocation === 'pending') {
        ownLocation = options.pendingBecomesRunning ? 'running' : 'absent'
      }
      return options.mutationResponse === 'undefined'
        ? undefined
        : { ok: false, status: 200, error: 'invalid json' }
    }
    if (path === '/interrupt' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      mutations.push({ path, body, init })
      calls.push(['request', baseUrl, path, 'POST'])
      if (body.prompt_id === 'prompt-contract-1' && ownLocation === 'running') ownLocation = 'absent'
      return options.mutationResponse === 'undefined'
        ? undefined
        : { ok: false, status: 200, error: 'invalid json' }
    }
    return originalRequestJson(baseUrl, path, init)
  }

  return { bridge, calls, mutations, location: () => ownLocation }
}

async function assertGenerateWorkflowContract() {
  const calls = []
  const progress = []
  const bridge = createBridgeFixture(objectInfoFixture(), calls)
  const finalStructurePrompt = 'GENERATE FINAL STRUCTURE F1\u2192F4 CONTINUOUS SEQUENCE PLAN'
  const finalStylePrompt = 'GENERATE FINAL STYLE MATERIAL-SPECIFIC OUTLINE EVOLUTION (fire)'
  const result = await generate.run({
    provider: 'local',
    bridge,
    sheet: { name: 'sheet.png', dataUrl: imageDataUrl('sheet'), width: 1536, height: 768 },
    styleReference: { name: 'style.png', dataUrl: imageDataUrl('style') },
    prompt: 'fire material with coherent orange emissive flame tongues',
    structurePrompt: finalStructurePrompt,
    stylePrompt: finalStylePrompt,
    promptsPrecompiled: true,
    frameCount: 4,
    styleStrength: 0.64,
    seed: 1234,
    clientId: 'aifx-contract-client',
    outputPrefix: 'contract/aifx',
    pollIntervalMs: 0,
    timeoutMs: 2000,
    onProgress(event) {
      progress.push(event.phase)
    },
  })

  assert.equal(result.kind, 'aifx-raw-sheet-candidate')
  assert.equal(result.provider, 'local')
  assert.equal(result.promptId, 'prompt-contract-1')
  assert.equal(result.effectiveStrength, 0.64)
  assert.match(result.modelKey, /qwen-image-edit-2511/)
  assert.match(result.promptHash, /^[a-f0-9]{64}$/)
  assert.match(result.workflowHash, /^[a-f0-9]{64}$/)
  assert.match(result.dataUrl, /^data:image\/png;base64,/)
  assert.equal(result.rawSheet.dataUrl, result.dataUrl)
  assert.ok(result.timing.totalMs >= 0)
  assert.deepEqual(calls.filter(([name]) => name === 'upload').map((entry) => entry[2]), ['sheet.png', 'style.png'])
  assert.ok(calls.some((entry) => entry[0] === 'request' && entry[2] === '/object_info'))
  assert.ok(calls.some((entry) => entry[0] === 'request' && entry[2] === '/prompt'))
  assert.ok(calls.some((entry) => entry[0] === 'request' && entry[2] === '/history/prompt-contract-1'))
  assert.ok(calls.some((entry) => entry[0] === 'validate'))
  assert.ok(calls.some((entry) => entry[0] === 'download'))
  assert.ok(progress.includes('complete'))
  const submittedWorkflow = calls.find((entry) => entry[0] === 'validate')?.[2]
  const submittedEncoders = workflowEntries(submittedWorkflow, 'TextEncodeQwenImageEditPlus')
  assert.equal(submittedEncoders[0][1].inputs.prompt, finalStructurePrompt)
  assert.equal(submittedEncoders[1][1].inputs.prompt, finalStylePrompt)
  const submittedModelFacingPrompts = submittedEncoders.map(([, encoder]) => encoder.inputs.prompt).join('\n')
  assert.equal(occurrenceCount(submittedModelFacingPrompts, 'CONTINUOUS SEQUENCE PLAN'), 1)
  assert.equal(occurrenceCount(submittedModelFacingPrompts, 'MATERIAL-SPECIFIC OUTLINE EVOLUTION'), 1)

  const anchorCalls = []
  const anchorBridge = createBridgeFixture(objectInfoFixture(), anchorCalls)
  const onsetFrame = {
    globalIndex: 0,
    phase: 'onset',
    energy: 0.1,
    centerX: 0.31,
    centerY: 0.52,
    directionDeg: 14,
    occupancy: 0.12,
  }
  const anchorResult = await generate.run({
    provider: 'local',
    bridge: anchorBridge,
    guide: { name: 'guide.png', dataUrl: imageDataUrl('guide'), width: 752, height: 384 },
    styleReference: { name: 'style.png', dataUrl: imageDataUrl('style') },
    identityReference: { name: 'peak.png', dataUrl: imageDataUrl('peak') },
    anchorRole: 'onset',
    anchorFrame: onsetFrame,
    structurePrompt: 'Create one isolated onset frame on a black background.',
    stylePrompt: 'Use image3 identity but obey image1 onset geometry.',
    promptsPrecompiled: true,
    styleStrength: 0.64,
    seed: 4321,
    clientId: 'aifx-contract-client',
    outputPrefix: 'contract/aifx-onset',
    pollIntervalMs: 0,
    timeoutMs: 2000,
  })
  assert.equal(anchorResult.kind, 'aifx-raw-frame-candidate')
  assert.equal(anchorResult.anchorRole, 'onset')
  assert.equal(anchorResult.anchorFrame.globalIndex, 0)
  assert.equal(anchorResult.rawFrame.dataUrl, anchorResult.dataUrl)
  assert.equal(Object.hasOwn(anchorResult, 'rawSheet'), false)
  assert.deepEqual(
    anchorCalls.filter(([name]) => name === 'upload').map((entry) => entry[2]),
    ['guide.png', 'style.png', 'peak.png'],
  )
  const submittedAnchorWorkflow = anchorCalls.find((entry) => entry[0] === 'validate')?.[2]
  assert.equal(submittedAnchorWorkflow['18'].class_type, 'LoadImage')
  assert.equal(submittedAnchorWorkflow['18'].inputs.image, 'uploaded_peak.png')
  assertJsonEqual(submittedAnchorWorkflow['8'].inputs.image1, ['2', 0])
  assertJsonEqual(submittedAnchorWorkflow['8'].inputs.image2, ['18', 0])
  assert.equal(Object.hasOwn(submittedAnchorWorkflow['8'].inputs, 'image3'), false)
  assertJsonEqual(submittedAnchorWorkflow['13'].inputs.positive, ['21', 0])
  assertJsonEqual(submittedAnchorWorkflow['13'].inputs.image, ['1', 0])

  const seedOnlyAnchorCalls = []
  const seedOnlyAnchorBridge = createBridgeFixture(objectInfoFixture(), seedOnlyAnchorCalls)
  const seedOnlyAnchorResult = await generate.run({
    provider: 'local',
    bridge: seedOnlyAnchorBridge,
    guide: { name: 'decay-guide.png', dataUrl: imageDataUrl('decay-guide'), width: 752, height: 384 },
    styleReference: { name: 'style.png', dataUrl: imageDataUrl('style') },
    anchorRole: 'decay',
    anchorFrame: { ...onsetFrame, phase: 'decay', globalIndex: 8 },
    materialReferenceMode: 'generated-peak-material-token',
    structurePrompt: 'Create one isolated decay frame on black.',
    stylePrompt: 'Use the compact peak material token while obeying the decay motion guide.',
    promptsPrecompiled: true,
    styleStrength: 0.64,
    seed: 4321,
    clientId: 'aifx-contract-client',
    outputPrefix: 'contract/aifx-decay-seed-only',
    pollIntervalMs: 0,
    timeoutMs: 2000,
  })
  assert.equal(seedOnlyAnchorResult.anchorRole, 'decay')
  assert.equal(seedOnlyAnchorResult.seed, 4321)
  assert.equal(seedOnlyAnchorResult.conditioningMode, 'early-peak-material-token-phase-topology-synthesis')
  assert.equal(seedOnlyAnchorResult.visualReferenceConnected, true)
  assert.equal(seedOnlyAnchorResult.visualReferenceEffective, true)
  assert.equal(seedOnlyAnchorResult.visualReferenceEndPercent, 0.25)
  assert.equal(seedOnlyAnchorResult.semanticMaterialConditioning, false)
  assert.equal(seedOnlyAnchorResult.peakMaterialTokenConditioning, true)
  assert.equal(seedOnlyAnchorResult.materialReferenceMode, 'generated-peak-material-token')
  assert.deepEqual(
    seedOnlyAnchorCalls.filter(([name]) => name === 'upload').map((entry) => entry[2]),
    ['decay-guide.png', 'style.png'],
  )
  const submittedSeedOnlyWorkflow = seedOnlyAnchorCalls.find((entry) => entry[0] === 'validate')?.[2]
  assert.equal(Object.hasOwn(submittedSeedOnlyWorkflow, '18'), false)
  assert.equal(submittedSeedOnlyWorkflow['8'].class_type, 'TextEncodeQwenImageEditPlus')
  assertJsonEqual(submittedSeedOnlyWorkflow['8'].inputs.image1, ['2', 0])
  assert.equal(Object.hasOwn(submittedSeedOnlyWorkflow['8'].inputs, 'image2'), false)
  assert.equal(Object.hasOwn(submittedSeedOnlyWorkflow['8'].inputs, 'image3'), false)
  assertJsonEqual(submittedSeedOnlyWorkflow['13'].inputs.positive, ['21', 0])
  assert.equal(submittedSeedOnlyWorkflow['19'].inputs.end, 0.25)
  assert.equal(submittedSeedOnlyWorkflow['20'].inputs.start, 0.25)

  let invalidAnchorBridgeTouched = false
  const invalidAnchorBridge = new Proxy({}, {
    get() {
      invalidAnchorBridgeTouched = true
      throw new Error('Invalid anchor requests must fail before bridge access')
    },
  })
  await assert.rejects(
    generate.run({
      provider: 'local',
      bridge: invalidAnchorBridge,
      anchorRole: 'peak',
      anchorFrame: { ...onsetFrame, phase: 'peak' },
      identityReference: true,
    }),
    (error) => error?.code === 'AIFX_LOCAL_ANCHOR_IDENTITY_FORBIDDEN',
  )
  assert.equal(invalidAnchorBridgeTouched, false)

  let cloudBridgeTouched = false
  const forbiddenBridge = new Proxy({}, {
    get() {
      cloudBridgeTouched = true
      throw new Error('Cloud mode must not inspect or fall back to Local bridge')
    },
  })
  for (const provider of ['gpt', 'google']) {
    await assert.rejects(
      generate.run({ provider, bridge: forbiddenBridge }),
      (error) => error?.code === 'AIFX_PROVIDER_DEFERRED'
        && error?.provider === provider
        && error?.deferred === true
        && error?.retryable === false,
    )
  }
  assert.equal(cloudBridgeTouched, false)
  await assert.rejects(
    generate.run({ provider: 'gooogle', bridge: forbiddenBridge }),
    (error) => error?.code === 'AIFX_PROVIDER_UNSUPPORTED' && error?.retryable === false,
  )
  assert.equal(cloudBridgeTouched, false)

  const controller = new AbortController()
  controller.abort('contract cancellation')
  await assert.rejects(
    generate.run({
      provider: 'local',
      bridge,
      signal: controller.signal,
      sheet: { dataUrl: imageDataUrl('sheet'), width: 32, height: 32 },
      styleReference: { dataUrl: imageDataUrl('style') },
    }),
    (error) => error?.name === 'AbortError' && error?.code === 'AIFX_ABORTED',
  )

  const hangingBridge = createBridgeFixture(objectInfoFixture(), [])
  hangingBridge.detectBaseUrl = () => new Promise(() => {})
  await assert.rejects(
    generate.run({
      provider: 'local',
      bridge: hangingBridge,
      timeoutMs: 8,
      sheet: { dataUrl: imageDataUrl('sheet'), width: 32, height: 32 },
      styleReference: { dataUrl: imageDataUrl('style') },
    }),
    (error) => error?.code === 'AIFX_TIMEOUT' && error?.retryable === true,
  )

  const pendingController = new AbortController()
  const pending = createCancellationBridge({ controller: pendingController, ownLocation: 'pending' })
  let pendingError = null
  await assert.rejects(
    generate.run(generationInput(pending.bridge, { signal: pendingController.signal })),
    (error) => {
      pendingError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(pendingError.runtimeCancellation?.confirmed, true)
  assert.equal(pendingError.runtimeCancellation?.action, 'delete-pending')
  assert.equal(pending.mutations.length, 1)
  assert.deepEqual(pending.mutations[0].body, { delete: ['prompt-contract-1'] })
  assert.equal(pending.mutations[0].body.delete.includes('foreign-prompt-9'), false)
  assert.equal(Object.hasOwn(pending.mutations[0].body, 'clear'), false)
  assert.equal(pending.mutations[0].init.headers['Content-Type'], 'application/json')

  const runningController = new AbortController()
  const running = createCancellationBridge({
    controller: runningController,
    ownLocation: 'running',
    foreignRunning: true,
  })
  let runningError = null
  await assert.rejects(
    generate.run(generationInput(running.bridge, { signal: runningController.signal })),
    (error) => {
      runningError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(runningError.runtimeCancellation?.confirmed, true)
  assert.equal(runningError.runtimeCancellation?.action, 'interrupt-running')
  assert.deepEqual(running.mutations.map((entry) => entry.path), ['/interrupt'])
  assert.deepEqual(running.mutations[0].body, { prompt_id: 'prompt-contract-1' })
  assert.ok(running.mutations[0].init.body, 'targeted Runtime interrupt must never be bodyless')
  assert.equal(Object.hasOwn(running.mutations[0].body, 'clear'), false)

  const foreignController = new AbortController()
  const foreignOnly = createCancellationBridge({
    controller: foreignController,
    ownLocation: 'absent',
    embedOwnIdInForeign: true,
  })
  let foreignError = null
  await assert.rejects(
    generate.run(generationInput(foreignOnly.bridge, { signal: foreignController.signal })),
    (error) => {
      foreignError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(foreignError.runtimeCancellation?.confirmed, false)
  assert.equal(foreignError.runtimeCancellation?.status, 'not-active')
  assert.equal(foreignOnly.mutations.length, 0, 'foreign queue entries must never be mutated')

  const mismatchController = new AbortController()
  const ownershipMismatch = createCancellationBridge({
    controller: mismatchController,
    ownLocation: 'running',
    ownClientId: 'foreign-client-claim',
    includeForeign: false,
  })
  let mismatchError = null
  await assert.rejects(
    generate.run(generationInput(ownershipMismatch.bridge, { signal: mismatchController.signal })),
    (error) => {
      mismatchError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(mismatchError.runtimeCancellation?.status, 'ownership-mismatch')
  assert.equal(ownershipMismatch.mutations.length, 0, 'mismatched client_id must fail closed')

  const timeoutPending = createCancellationBridge({ ownLocation: 'pending' })
  let timeoutErrorAfterPrompt = null
  await assert.rejects(
    generate.run(generationInput(timeoutPending.bridge, { timeoutMs: 25 })),
    (error) => {
      timeoutErrorAfterPrompt = error
      return error?.code === 'AIFX_TIMEOUT'
    },
  )
  assert.equal(timeoutErrorAfterPrompt.runtimeCancellation?.confirmed, true)
  assert.deepEqual(timeoutPending.mutations.map((entry) => entry.body), [{ delete: ['prompt-contract-1'] }])

  const transitionController = new AbortController()
  const transition = createCancellationBridge({
    controller: transitionController,
    ownLocation: 'pending',
    pendingBecomesRunning: true,
    includeForeign: false,
  })
  let transitionError = null
  await assert.rejects(
    generate.run(generationInput(transition.bridge, { signal: transitionController.signal })),
    (error) => {
      transitionError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(transitionError.runtimeCancellation?.confirmed, true)
  assert.equal(transitionError.runtimeCancellation?.action, 'interrupt-running')
  assert.deepEqual(transition.mutations.map((entry) => entry.path), ['/queue', '/interrupt'])

  const undefinedController = new AbortController()
  const undefinedMutation = createCancellationBridge({
    controller: undefinedController,
    ownLocation: 'pending',
    mutationResponse: 'undefined',
    includeForeign: false,
  })
  let undefinedError = null
  await assert.rejects(
    generate.run(generationInput(undefinedMutation.bridge, { signal: undefinedController.signal })),
    (error) => {
      undefinedError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(undefinedError.runtimeCancellation?.confirmed, false, 'undefined cancellation response must not become false success')
  assert.equal(undefinedError.runtimeCancelled, false)

  const lateController = new AbortController()
  const late = createCancellationBridge({ controller: null, ownLocation: 'pending', includeForeign: false })
  const lateBaseRequest = late.bridge.requestJson.bind(late.bridge)
  let resolveLatePrompt = null
  late.bridge.requestJson = async (baseUrl, path, init = {}) => {
    if (path !== '/prompt') return lateBaseRequest(baseUrl, path, init)
    late.calls.push(['request', baseUrl, path, init.method || 'GET'])
    setTimeout(() => lateController.abort('late prompt contract cancellation'), 0)
    return new Promise((resolve) => { resolveLatePrompt = resolve })
  }
  let lateError = null
  await assert.rejects(
    generate.run(generationInput(late.bridge, { signal: lateController.signal })),
    (error) => {
      lateError = error
      return error?.code === 'AIFX_ABORTED'
    },
  )
  assert.equal(lateError.runtimeCancellation?.status, 'prompt-id-unavailable')
  resolveLatePrompt({ ok: true, status: 200, data: { prompt_id: 'prompt-contract-1' } })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(late.mutations.map((entry) => entry.body), [{ delete: ['prompt-contract-1'] }], 'late prompt_id must still be cleaned up exactly')

  return { result, calls, progress }
}

const localReceipt = assertLocalWorkflowContract()
const generateReceipt = await assertGenerateWorkflowContract()

console.log(JSON.stringify({
  status: 'PASS',
  localVersion: local.VERSION,
  generateVersion: generate.VERSION,
  pipeline: localReceipt.pipeline,
  nodeCount: Object.keys(localReceipt.workflow).length,
  modelKey: generateReceipt.result.modelKey,
  effectiveStrength: generateReceipt.result.effectiveStrength,
  promptHash: generateReceipt.result.promptHash,
  workflowHash: generateReceipt.result.workflowHash,
  bridgeCalls: generateReceipt.calls.length,
  progressPhases: generateReceipt.progress,
}, null, 2))
