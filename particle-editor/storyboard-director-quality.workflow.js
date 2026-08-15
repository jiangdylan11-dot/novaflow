(function installNovaFlowStoryboardDirectorQuality(root, factory) {
  'use strict'

  const api = factory()
  if (root && !root.NovaFlowStoryboardDirectorQuality) {
    root.NovaFlowStoryboardDirectorQuality = api
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStoryboardDirectorQuality() {
  'use strict'

  const STATUS = Object.freeze({ PASS: 'PASS', WARNING: 'WARNING', FAIL: 'FAIL' })
  const REQUIRED_FIELDS = Object.freeze(['title', 'displayCaption', 'prompt', 'camera'])

  const CAMERA_FEATURES = Object.freeze({
    shotSize: [
      ['extreme-wide', /\b(?:extreme\s+wide|very\s+wide|extreme\s+long)\s+shot\b|超远景|大远景/i],
      ['wide', /\b(?:wide|long|establishing)\s+shot\b|\bwide\s+view\b|远景|全景|建立镜头/i],
      ['full', /\bfull(?:-body|\s+body)?\s+shot\b|全身(?:镜头|景)?/i],
      ['medium', /\bmedium(?:-wide|-long)?\s+shot\b|\bmedium\s+view\b|中景/i],
      ['medium-close', /\bmedium\s+close(?:-up)?\b|中近景/i],
      ['extreme-close', /\bextreme\s+close(?:-up)?\b|大特写|超特写/i],
      ['close', /\bclose(?:-up)?\s+(?:shot|view)\b|\bclose-up\b|近景|特写/i],
      ['insert', /\b(?:insert|detail|macro)\s+shot\b|细节镜头|微距/i]
    ],
    angle: [
      ['overhead', /\b(?:overhead|top-down|bird'?s-eye)\b|顶视|正俯拍/i],
      ['high', /\bhigh(?:-angle)?\b|俯拍|高机位/i],
      ['low', /\blow(?:-angle)?\b|仰拍|低机位/i],
      ['eye', /\beye(?:-level)?\b|平视/i],
      ['dutch', /\b(?:dutch|canted|tilted)\s+(?:angle|frame)\b|荷兰角|倾斜机位/i],
      ['over-shoulder', /\bover(?:-the)?-shoulder\b|\bOTS\b|过肩/i],
      ['profile', /\b(?:profile|side-on)\b|侧面机位|侧脸/i],
      ['rear', /\b(?:rear|back|from behind)\s+(?:view|shot|angle)?\b|背影|背面机位/i],
      ['pov', /\b(?:POV|point-of-view|first-person)\b|主观镜头|第一人称/i]
    ],
    staging: [
      ['left', /\b(?:left\s+third|frame\s+left|left\s+side)\b|画面左侧|左三分之一/i],
      ['right', /\b(?:right\s+third|frame\s+right|right\s+side)\b|画面右侧|右三分之一/i],
      ['center', /\b(?:centered|frame\s+center|central\s+composition)\b|居中构图|画面中央/i],
      ['two-shot', /\btwo-shot\b|双人镜头|双人构图/i],
      ['foreground', /\bforeground\b|前景/i],
      ['silhouette', /\bsilhouette\b|剪影/i]
    ],
    motion: [
      ['tracking', /\b(?:tracking|follow|following)\s+shot\b|跟拍|跟随镜头/i],
      ['push', /\b(?:push(?:-in)?|dolly\s+in)\b|推进|推镜/i],
      ['pull', /\b(?:pull(?:-back|-out)?|dolly\s+out)\b|拉远|拉镜/i],
      ['handheld', /\bhandheld\b|手持镜头/i],
      ['static', /\b(?:static|locked-off|fixed)\s+(?:shot|camera)?\b|固定镜头/i]
    ]
  })

  const HAIR_FACT_PATTERNS = Object.freeze({
    hairLength: [
      ['short', /\bshort(?:[-\s](?:cropped|bobbed))?(?:\s+\w+){0,2}\s+hair(?:cut)?\b|\b(?:pixie|bob)\s+(?:cut|hair(?:cut)?)\b|短发|短发造型|波波头/i],
      ['shoulder', /\bshoulder[-\s]length(?:\s+\w+){0,2}\s+hair\b|齐肩(?:发)?|及肩(?:发)?/i],
      ['long', /\blong(?:\s+straight|\s+wavy|\s+curly)?(?:\s+\w+){0,2}\s+hair(?:cut)?\b|长发|及腰发/i]
    ],
    hairColor: [
      ['silver', /\b(?:silver|white|platinum)(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|银(?:白)?色?头发|白发/i],
      ['black', /\b(?:black|jet-black|raven)(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|黑发/i],
      ['blonde', /\b(?:blond|blonde|golden)(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|金发/i],
      ['brown', /\b(?:brown|brunette|chestnut)(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|棕发|褐色头发/i],
      ['red', /\b(?:red|auburn|ginger)(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|红发/i],
      ['blue', /\bblue(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|蓝发/i],
      ['pink', /\bpink(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|粉发/i],
      ['green', /\bgreen(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|绿发/i],
      ['purple', /\bpurple(?:[-\s]\w+){0,2}\s+hair(?:cut)?\b|紫发/i]
    ]
  })

  const ABSTRACT_EVENT_PATTERN = /\b(?:hack(?:s|ed|ing)?|upload(?:s|ed|ing)?|download(?:s|ed|ing)?|transmit(?:s|ted|ting)?|analy[sz](?:e|es|ed|ing)|detect(?:s|ed|ing)?|track(?:s|ed|ing)?|locat(?:e|es|ed|ing)|connect(?:s|ed|ing)?|decrypt(?:s|ed|ing)?|rewrite(?:s|rewrote|rewritten|writing)?|decid(?:e|es|ed|ing)|reali[sz](?:e|es|ed|ing)|complete(?:s|d|ing)?|fail(?:s|ed|ing)?)\b|上传|下载|传输|破解|入侵|分析|检测|探测|定位|追踪|连接|解密|重写|决定|意识到|完成|失败/i
  const VISIBLE_EVIDENCE_PATTERN = /\b(?:visible|glow(?:s|ing)?|pulse(?:s|d|ing)?|spark(?:s|ing)?|flash(?:es|ing)?|beams?|cables?|wires?|particles?|energy\s+(?:flows?|streams?|pulses?)|light\s+(?:flows?|streams?|ribbons?)|emit(?:s|ted|ting)?|smoke|steam|debris|fragments?|shatter(?:s|ed|ing)?|crack(?:s|ed|ing)?|explode(?:s|d|ing)?|flame|light(?:s|ing)?|reflection|ripple|screen\s+flicker|indicator\s+light|hands?|fingers?|gesture|posture|expression|face|eyes?|kneel(?:s|ed|ing)?|run(?:s|ning)?|turn(?:s|ed|ing)?|reach(?:es|ed|ing)?|grip(?:s|ped|ping)?|drop(?:s|ped|ping)?|collapse(?:s|d|ing)?|recoil(?:s|ed|ing)?)\b|可见|发光|脉冲|火花|闪光|光束|线缆|粒子|能量流|光带|烟雾|碎片|裂纹|爆炸|火焰|灯光|倒影|涟漪|指示灯|手指|手势|姿态|表情|眼神|跪|奔跑|转身|伸手|握紧|掉落|坍塌|后坐力/i
  const READABLE_TEXT_PATTERN = /\b(?:billboard|sign|poster|headline|caption|subtitle)\s+(?:reads?|says?|spells?)\b|\b(?:screen|monitor|display|interface|ui|billboard|sign|poster)\s+(?:shows?|displays?)\b[^.;\n]{0,48}\b(?:readable|legible|written|text|words?|letters?|digits?|numbers?|message|code|percentage|percent)\b|\b(?:readable|legible|written|printed)\s+(?:text|words?|letters?|numbers?|code)\b|\b(?:text|words?|letters?|numbers?|code)\s+(?:reading|showing|saying)\b|\b(?:glowing|floating|falling|streaming|swirling)\s+(?:source\s+)?(?:code|letters?|numbers?|characters?|glyphs?)\b|\b(?:cascading|falling|flowing|scrolling|streaming|glowing|floating|swirling)\s+(?:lines?\s+of\s+)?(?:source\s+)?code\b|\b(?:lines?|columns?|streams?)\s+of\s+(?:source\s+)?code\b|\b(?:source\s+)?code\b[^.;\n]{0,28}\b(?:fills?|cascades?|scrolls?|flows?|rains?)\b|\b(?:progress|completion|upload|download|transfer)\s+(?:bar|ring|meter|indicator(?:s)?)\b|\b\d{1,3}\s*%(?!\w)|百分之\s*[一二三四五六七八九十百零\d]+|广告牌(?:写着|显示)|屏幕(?:写着|显示)|界面(?:写着|显示)|可读文字|清晰文字|字幕显示/i
  const NEGATIVE_TEXT_INSTRUCTION_PATTERN = /\b(?:no|without|avoid|exclude|do\s+not|must\s+not|never|not\s+relying\s+on)\b[^.!?\n]{0,100}?\b(?:readable|legible|text|words?|letters?|numbers?|percentage|percent|code|glyphs?|characters?)\b|(?:不要|不得|禁止|避免|无需|不依赖)[^。！？\n]{0,60}?(?:可读文字|文字|字幕|数字|百分比|代码|字符|字形)/gi
  const NEGATIVE_TEXT_CONTINUATION_PATTERN = /\b(?:or|and)\s+(?:(?:readable|legible|glowing|floating|falling|streaming|swirling|code-like)\s+)?(?:text|words?|letters?|numbers?|labels?|captions?|subtitles?|code|glyphs?|characters?)\b|(?:或|以及|和)(?:可读|发光|漂浮|流动|旋转)?(?:文字|字幕|数字|代码|字符|字形)/gi

  const PROP_DESTROYED_PATTERN = /\b(?:self[-\s]?destruct(?:s|ed|ing)?|destroy(?:s|ed|ing)?|explode(?:s|d|ing)?|shatter(?:s|ed|ing)?|incinerat(?:e|es|ed|ing)|burn(?:s|ed|t|ing)?\s+(?:up|away)|damag(?:e|es|ed|ing)|discard(?:s|ed|ing)?|abandon(?:s|ed|ing)?|lose(?:s|ing)?|lost|leav(?:e|es|ing)\s+behind|left\s+behind|consum(?:e|es|ed|ing)|deplet(?:e|es|ed|ing)|exhaust(?:s|ed|ing)?|spent|empty|breaks?|broke|broken|breaking)\b|自毁|销毁|炸毁|爆炸|粉碎|烧毁|焚毁|丢弃|遗失|抛弃|留在原地|消耗完|耗尽|用尽|损坏|破碎/i
  const PROP_RESIDUAL_PATTERN = /\b(?:debris|fragments?|wreckage|remains?|ashes|ruins?|broken|destroyed|burned|charred|shattered)\b|碎片|残骸|余烬|灰烬|破损|损坏|烧焦|被毁/i
  const PROP_RESTORED_PATTERN = /\b(?:new|another|spare|replacement|repaired|rebuilt|restored|recovered)\b|新的|另一(?:个|件)|备用|替换|修复|重建|恢复|找回/i
  const PROP_USABLE_PATTERN = /\b(?:intact|usable|functional|active|available|carried|equipped|repaired|rebuilt|restored|recovered|replaced|refilled|recharged)\b|完好|可用|正常|启用|携带|装备|修复|重建|恢复|找回|替换|补充|充满/i
  const NO_CHANGE_EVENT_PATTERN = /^(?:none|no\s+change|unchanged|inherited|same\s+as\s+previous|not\s+applicable|n\/?a|无|没有变化|未变化|沿用上一格|继承上一格|不适用)$/i
  const ENDING_PLACEHOLDER_PATTERN = /\b(?:to\s+be\s+continued|tbd|placeholder|keeps?\s+(?:doing|trying)\s+the\s+same|continues?\s+unchanged|nothing\s+changes)\b|待续|占位|继续重复|仍然没有变化/i

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function flattenText(value) {
    if (value == null) return ''
    if (typeof value === 'string' || typeof value === 'number') return cleanText(value)
    if (Array.isArray(value)) return cleanText(value.map(flattenText).join(' '))
    if (typeof value === 'object') return cleanText(Object.values(value).map(flattenText).join(' '))
    return ''
  }

  function comparableStateText(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').replace(/\s+/g, ' ').trim()
  }

  function meaningfulChangeEvent(value) {
    const text = cleanText(value)
    return !!text && !NO_CHANGE_EVENT_PATTERN.test(text)
  }

  function subjectStateFromValue(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    if (!source) return null
    return {
      id: cleanText(source.id || source.subjectId || source.subject_id),
      appearance: cleanText(source.appearance || source.currentAppearance || source.current_appearance),
      state: cleanText(source.state || source.physicalState || source.physical_state),
      changeEvent: cleanText(source.changeEvent || source.change_event || source.changeReason || source.change_reason)
    }
  }

  function structuredSubjectState(shot, options) {
    const settings = options || {}
    const direct = shot && (shot.subjectState || shot.subject_state || shot.continuity && shot.continuity.subjectState)
    const fallback = settings.useSubjectStateFallback === true
      ? settings.subjectState || settings.subjectBaseline || settings.continuity && settings.continuity.subjectState
      : null
    return subjectStateFromValue(direct || fallback)
  }

  function normalizeStructuredProp(value, fallbackId) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
    if (!source) return null
    const id = cleanText(source.id || source.propId || source.prop_id || fallbackId)
    if (!id) return null
    return {
      id,
      name: cleanText(source.name || source.label || id),
      appearance: cleanText(source.appearance || source.design || source.visualIdentity || source.visual_identity),
      state: cleanText(source.state || source.physicalState || source.physical_state),
      location: cleanText(source.location || source.position || source.spatialRelation || source.spatial_relation),
      changeEvent: cleanText(source.changeEvent || source.change_event || source.changeReason || source.change_reason)
    }
  }

  function structuredKeyPropLedger(shot, options) {
    const settings = options || {}
    const direct = shot && (shot.keyProps || shot.key_props || shot.continuity && shot.continuity.keyProps)
    const fallback = settings.useKeyPropFallback === true
      ? settings.structuredKeyProps || settings.keyPropStates || settings.continuity && settings.continuity.keyProps
      : null
    const source = direct != null ? direct : fallback
    const present = Array.isArray(source) || !!(source && typeof source === 'object')
    const items = []
    if (Array.isArray(source)) {
      source.forEach((value) => {
        const normalized = normalizeStructuredProp(value, '')
        if (normalized) items.push(normalized)
      })
    } else if (source && typeof source === 'object') {
      Object.entries(source).forEach(([id, value]) => {
        const normalized = normalizeStructuredProp(value, id)
        if (normalized) items.push(normalized)
      })
    }
    return { present, items }
  }

  function hasStructuredContinuity(shot) {
    return !!(shot && (
      shot.subjectState
      || shot.subject_state
      || Object.prototype.hasOwnProperty.call(shot, 'keyProps')
      || Object.prototype.hasOwnProperty.call(shot, 'key_props')
      || shot.continuity && (shot.continuity.subjectState || Object.prototype.hasOwnProperty.call(shot.continuity, 'keyProps'))
    ))
  }

  function propStateClass(value) {
    const text = cleanText(value)
    if (!text) return ''
    if (PROP_DESTROYED_PATTERN.test(text)) return 'degraded'
    if (PROP_USABLE_PATTERN.test(text)) return 'usable'
    return 'other'
  }

  const PROP_IDENTITY_TOKEN_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'to', 'with', 'without', 'for', 'from', 'in', 'on', 'at', 'by',
    'high', 'tech', 'hightech', 'large', 'small', 'medium', 'matte', 'glowing', 'visible', 'portable', 'rectangular',
    'object', 'item', 'prop', 'device', 'equipment', 'design', 'case'
  ])

  function propIdentityTokens(value) {
    return comparableStateText(value).split(' ').filter((token) => token.length >= 3 && !PROP_IDENTITY_TOKEN_STOP_WORDS.has(token))
  }

  function subjectAppearanceMentionsProp(subjectAppearance, prop) {
    const subjectText = comparableStateText(subjectAppearance)
    if (!subjectText) return false
    const propAppearance = comparableStateText(prop && prop.appearance)
    const propName = comparableStateText(prop && prop.name)
    if (propAppearance.length >= 12 && subjectText.includes(propAppearance)) return true
    if (propName.length >= 5 && subjectText.includes(propName)) return true
    const subjectTokens = new Set(propIdentityTokens(subjectAppearance))
    const nameTokens = new Set(propIdentityTokens(`${prop && prop.name || ''} ${prop && prop.id || ''}`))
    const allTokens = new Set(propIdentityTokens(`${prop && prop.name || ''} ${prop && prop.id || ''} ${prop && prop.appearance || ''}`))
    const nameOverlap = [...nameTokens].filter((token) => subjectTokens.has(token)).length
    const totalOverlap = [...allTokens].filter((token) => subjectTokens.has(token)).length
    return nameOverlap >= 2 || (nameOverlap >= 1 && totalOverlap >= 2)
  }

  const TERMINAL_KEY_PROP_STATE_PATTERN = /\bstate\s*:\s*[^;|.]{0,240}\b(?:destroyed|self[-\s]?destructed|damaged|broken|lost|missing|absent|consumed|depleted|spent|empty|discarded|abandoned)\b|状态\s*[:：]\s*[^；|。]{0,120}(?:销毁|自毁|损坏|破碎|遗失|丢失|缺席|消耗|耗尽|空了|丢弃)/i

  function terminalKeyPropPriorityRule(value) {
    const text = cleanText(value)
    if (!/\bkey\s+prop\s+states?\s*:/i.test(text) || !TERMINAL_KEY_PROP_STATE_PATTERN.test(text)) return ''
    return 'Terminal key-prop state priority: every independently tracked key prop marked damaged, destroyed, lost, consumed, depleted, or absent in the current scene ledger overrides image-reference and identity-lock equipment cues. Render only its current damaged residue or confirmed absence; never restore, attach, carry, or display an intact version unless this scene contains an explicit visible repair, recovery, replacement, or replenishment event.'
  }

  function structuredPropPromptEntry(prop) {
    const stateChange = meaningfulChangeEvent(prop.changeEvent) ? prop.changeEvent : 'none'
    if (propStateClass(prop.state) === 'degraded') {
      return `${prop.name} [${prop.id}]; state: ${prop.state}; location: ${prop.location || 'off-screen or unchanged'}; state change event: ${stateChange}; rendering constraint: the current degraded, destroyed, lost, consumed, or absent state overrides every earlier intact appearance cue; never show an intact or usable version without an explicit visible recovery event`
    }
    return `${prop.name} [${prop.id}]; appearance: ${prop.appearance}; state: ${prop.state}; location: ${prop.location || 'off-screen or unchanged'}; state change event: ${stateChange}`
  }

  function sceneNumber(shot, index) {
    const value = Number(shot && (shot.scene || shot.number))
    return Number.isFinite(value) && value > 0 ? value : index + 1
  }

  function sceneLabel(number) {
    return `SCENE_${String(number).padStart(2, '0')}`
  }

  function shotCameraText(shot) {
    return cleanText([
      shot && (shot.shot_type || shot.shotType || shot.shotSize),
      shot && (shot.camera || shot.angle),
      shot && (shot.composition || shot.subjectPosition || shot.staging)
    ].filter(Boolean).join(', '))
  }

  function extractFeature(text, patterns) {
    const source = cleanText(text)
    for (const [name, pattern] of patterns) {
      if (pattern.test(source)) return name
    }
    return ''
  }

  function cameraFeatures(value) {
    const text = typeof value === 'object' ? shotCameraText(value) : cleanText(value)
    return {
      shotSize: extractFeature(text, CAMERA_FEATURES.shotSize),
      angle: extractFeature(text, CAMERA_FEATURES.angle),
      staging: extractFeature(text, CAMERA_FEATURES.staging),
      motion: extractFeature(text, CAMERA_FEATURES.motion)
    }
  }

  function visualSignature(shot) {
    const features = cameraFeatures(shot)
    const known = [features.shotSize, features.angle, features.staging, features.motion].filter(Boolean)
    if (known.length) return known.join('|')
    return shotCameraText(shot).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim()
  }

  function compiledPromptOverride(shot, options) {
    const settings = options || {}
    const index = Number.isFinite(Number(settings.sceneIndex)) ? Number(settings.sceneIndex) : 0
    const number = sceneNumber(shot, index)
    const collection = settings.compiledPrompts
    if (Array.isArray(collection)) return collection[index]
    if (collection && typeof collection === 'object') {
      return collection[number] || collection[String(number)] || collection[sceneLabel(number)] || collection[shot && shot.id]
    }
    return settings.compiledPrompt
  }

  function compiledPromptForShot(shot, options) {
    const override = compiledPromptOverride(shot, options)
    if (override && typeof override === 'object') return cleanText(override.prompt || override.compiledPrompt || override.finalPrompt)
    if (override != null) return cleanText(override)
    if (options && typeof options.compiledPromptAccessor === 'function') return cleanText(options.compiledPromptAccessor(shot, options.sceneIndex))
    return cleanText(shot && (shot.compiledPrompt || shot.finalPrompt || shot.imagePrompt || shot.prompt))
  }

  function isCompiledValidation(shot, options) {
    const settings = options || {}
    if (settings.validationStage === 'compiled' || settings.requireInlineCamera === true) return true
    if (settings.validationStage === 'planning' || settings.requireInlineCamera === false) return false
    return settings.compiledPrompts != null
      || settings.compiledPrompt != null
      || !!(shot && (shot.compiledPrompt || shot.finalPrompt))
  }

  function cameraIsInline(shot, compiledPrompt) {
    const prompt = cleanText(compiledPrompt)
    const camera = shotCameraText(shot)
    if (!camera || !prompt) return false
    if (prompt.toLowerCase().includes(camera.toLowerCase())) return true
    const hasCameraLabel = /\b(?:camera(?:\s+and\s+composition)?|framing|shot\s+design)\s*:/i.test(prompt) || /镜头(?:与构图|语言)?\s*[:：]/.test(prompt)
    const expected = cameraFeatures(shot)
    const actual = cameraFeatures(prompt)
    const expectedKeys = Object.keys(expected).filter((key) => expected[key])
    if (!expectedKeys.length) return hasCameraLabel
    const matchCount = expectedKeys.filter((key) => expected[key] === actual[key]).length
    return matchCount >= Math.min(2, expectedKeys.length)
  }

  function promptContainsStateValue(prompt, value) {
    const source = comparableStateText(prompt)
    const expected = comparableStateText(value)
    return !!expected && source.includes(expected)
  }

  function subjectStateIsInline(shot, compiledPrompt, options) {
    const subject = structuredSubjectState(shot, options)
    const prompt = cleanText(compiledPrompt)
    if (!subject || !prompt || !/\bsubject\s+state\s*:/i.test(prompt)) return false
    return [subject.id, subject.appearance, subject.state]
      .filter(Boolean)
      .every((value) => promptContainsStateValue(prompt, value))
  }

  function keyPropStatesAreInline(shot, compiledPrompt, options) {
    const ledger = structuredKeyPropLedger(shot, options)
    const prompt = cleanText(compiledPrompt)
    if (!ledger.present || !prompt || !/\bkey\s+prop\s+states?\s*:/i.test(prompt)) return false
    if (!ledger.items.length) return /\bkey\s+prop\s+states?\s*:\s*(?:none|no\s+key\s+props?)\b/i.test(prompt)
    return ledger.items.every((prop) => {
      const requiredValues = propStateClass(prop.state) === 'degraded'
        ? [prop.id, prop.name, prop.state]
        : [prop.id, prop.name, prop.appearance, prop.state]
      return requiredValues.filter(Boolean).every((value) => promptContainsStateValue(prompt, value))
    })
  }

  function validateCompiledPrompt(shot, options) {
    const settings = options || {}
    const compiledPrompt = compiledPromptForShot(shot, settings)
    const cameraText = shotCameraText(shot)
    const compiledStage = isCompiledValidation(shot, settings)
    const warnings = []
    const errors = []
    const addIssue = (code) => (compiledStage ? errors : warnings).push(code)
    if (!compiledPrompt) addIssue('COMPILED_PROMPT_EMPTY')
    if (!cameraText) warnings.push('CAMERA_FIELD_EMPTY')
    else if (!cameraIsInline(shot, compiledPrompt)) addIssue('CAMERA_NOT_INLINE')
    const structuredRequired = settings.requireStructuredContinuity === true || hasStructuredContinuity(shot)
    const subjectState = structuredSubjectState(shot, settings)
    const keyPropLedger = structuredKeyPropLedger(shot, settings)
    if (structuredRequired) {
      if (!subjectState || !subjectState.id || !subjectState.appearance || !subjectState.state) addIssue('SUBJECT_STATE_MISSING')
      else if (!subjectStateIsInline(shot, compiledPrompt, settings)) addIssue('SUBJECT_STATE_NOT_INLINE')
      if (!keyPropLedger.present) addIssue('KEY_PROP_LEDGER_MISSING')
      else if (!keyPropStatesAreInline(shot, compiledPrompt, settings)) addIssue('KEY_PROP_STATE_NOT_INLINE')
    }
    const issues = [
      ...errors.map((code) => Object.freeze({ code, severity: 'ERROR' })),
      ...warnings.map((code) => Object.freeze({ code, severity: 'WARNING' }))
    ]
    return Object.freeze({
      ok: errors.length === 0 && warnings.length === 0,
      status: errors.length ? STATUS.FAIL : (warnings.length ? STATUS.WARNING : STATUS.PASS),
      validationStage: compiledStage ? 'compiled' : 'planning',
      compiledPrompt,
      cameraText,
      cameraInline: !!cameraText && cameraIsInline(shot, compiledPrompt),
      structuredContinuityRequired: structuredRequired,
      subjectStateInline: !!subjectState && subjectStateIsInline(shot, compiledPrompt, settings),
      keyPropStatesInline: keyPropLedger.present && keyPropStatesAreInline(shot, compiledPrompt, settings),
      warnings: Object.freeze(warnings),
      errors: Object.freeze(errors),
      issues: Object.freeze(issues)
    })
  }

  function promptSourceWithoutNegativeTextRules(value) {
    const source = cleanText(value)
    const stripped = source.replace(NEGATIVE_TEXT_INSTRUCTION_PATTERN, ' ')
    return stripped === source ? source : stripped.replace(NEGATIVE_TEXT_CONTINUATION_PATTERN, ' ')
  }

  function dependsOnReadableText(value) {
    return READABLE_TEXT_PATTERN.test(promptSourceWithoutNegativeTextRules(value))
  }

  function extractIdentityFacts(value) {
    const text = flattenText(value)
    const result = {}
    Object.entries(HAIR_FACT_PATTERNS).forEach(([category, patterns]) => {
      const matches = Array.from(new Set(patterns.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)))
      if (matches.length === 1) result[category] = matches[0]
    })
    return result
  }

  function identityConflicts(referenceFacts, shotText) {
    const sceneFacts = extractIdentityFacts(shotText)
    return Object.keys(referenceFacts).filter((category) => sceneFacts[category] && sceneFacts[category] !== referenceFacts[category])
      .map((category) => ({ category, expected: referenceFacts[category], actual: sceneFacts[category] }))
  }

  function normalizeKeyProps(options, shots) {
    const values = []
    const push = (value) => {
      if (typeof value === 'string') value.split(/[,，;；\n]/).forEach((item) => { if (cleanText(item)) values.push(cleanText(item)) })
      else if (Array.isArray(value)) value.forEach(push)
      else if (value && typeof value === 'object') Object.keys(value).forEach(push)
    }
    push(options && options.keyProps)
    shots.forEach((shot) => {
      push(shot && shot.keyProps)
      push(shot && shot.continuity && shot.continuity.keyProps)
    })
    const seen = new Set()
    return values.filter((value) => {
      const key = value.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function textMentionsProp(text, prop) {
    const source = cleanText(text).toLowerCase()
    const target = cleanText(prop).toLowerCase()
    return !!target && source.includes(target)
  }

  function explicitPropState(shot, prop) {
    const states = shot && (shot.propStates || shot.continuity && shot.continuity.propStates)
    if (!states || typeof states !== 'object') return ''
    const key = Object.keys(states).find((name) => cleanText(name).toLowerCase() === cleanText(prop).toLowerCase())
    return key ? cleanText(states[key]) : ''
  }

  function isDestroyedState(value) {
    return PROP_DESTROYED_PATTERN.test(cleanText(value))
  }

  function isResidualOrRestored(value) {
    const text = cleanText(value)
    return PROP_RESIDUAL_PATTERN.test(text) || PROP_RESTORED_PATTERN.test(text)
  }

  function actionSignature(shot) {
    return cleanText(shot && (shot.action || shot.visualEvent || shot.beat || shot.sceneAnchor || shot.prompt))
      .toLowerCase()
      .replace(/\b(?:camera|shot|framing|composition|cinematic|illustration|render|style)\b/g, ' ')
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function compileScenePromptParts(shot, options) {
    const settings = options || {}
    const camera = shotCameraText(shot) || cleanText(settings.cameraFallback)
    const action = cleanText(shot && (shot.action || shot.visualEvent || shot.beat || shot.prompt))
    const consequence = cleanText(shot && (shot.visibleConsequence || shot.result || shot.evidence))
    const space = cleanText(shot && (shot.currentSpace || shot.location || shot.sceneAnchor))
    const staging = cleanText(shot && (shot.spatialStaging || shot.subjectPosition || shot.blocking))
    const identity = cleanText(settings.identityAnchor || shot && (shot.identityAnchor || shot.continuityAnchor))
    const style = cleanText(settings.styleAnchor || shot && (shot.styleAnchor || shot.style))
    const subjectState = structuredSubjectState(shot, settings)
    const keyPropLedger = structuredKeyPropLedger(shot, settings)
    const cameraPart = camera && `Camera and composition: ${camera}.`
    const subjectStatePart = subjectState && subjectState.id && subjectState.appearance && subjectState.state
      ? `Subject state: ${subjectState.id}; appearance: ${subjectState.appearance}; physical state: ${subjectState.state}; state change event: ${meaningfulChangeEvent(subjectState.changeEvent) ? subjectState.changeEvent : 'none'}.`
      : ''
    const keyPropStatePart = keyPropLedger.present
      ? keyPropLedger.items.length
        ? `Key prop states: ${keyPropLedger.items.map(structuredPropPromptEntry).join(' | ')}.`
        : 'Key prop states: none.'
      : ''
    const actionPart = action && `Visible event: ${action}${consequence ? `; visible consequence: ${consequence}` : ''}.`
    const spacePart = (space || staging) && `Spatial staging: ${[space, staging].filter(Boolean).join('; ')}.`
    const identityPart = identity && `Identity and continuity: ${identity}.`
    const stylePart = style && `Visual style: ${style}.`
    const constraintPart = settings.omitConstraint !== true && 'Image-generation constraint: express story information through visible physical action and consequence; do not rely on readable text, letters, numbers, interface copy, or percentages.'
    const parts = [cameraPart, subjectStatePart, keyPropStatePart, actionPart, spacePart, identityPart, stylePart, constraintPart].filter(Boolean)
    return Object.freeze({
      camera: cameraPart || '',
      subjectState: subjectStatePart,
      keyProps: keyPropStatePart,
      action: actionPart || '',
      space: spacePart || '',
      identity: identityPart || '',
      style: stylePart || '',
      constraint: constraintPart || '',
      parts: Object.freeze(parts),
      prompt: parts.join('\n')
    })
  }

  function evaluateShots(inputShots, options) {
    const settings = options || {}
    const shots = Array.isArray(inputShots) ? inputShots : []
    const expectedCount = Number.isFinite(Number(settings.expectedCount)) ? Math.max(1, Number(settings.expectedCount)) : 9
    const structuredContinuityRequired = settings.requireStructuredContinuity === true || shots.some(hasStructuredContinuity)
    const referenceFacts = extractIdentityFacts([settings.identityCues, settings.sourceCues])
    const keyProps = normalizeKeyProps(settings, shots)
    const perScene = shots.map((shot, index) => {
      const number = sceneNumber(shot, index)
      const label = sceneLabel(number)
      const warnings = []
      const errors = []
      const missingFields = REQUIRED_FIELDS.filter((field) => {
        if (field === 'displayCaption') return !cleanText(shot && (shot.displayCaption || shot.caption))
        if (field === 'camera') return !shotCameraText(shot)
        return !cleanText(shot && shot[field])
      })
      if (missingFields.length) errors.push(`${label}:MISSING_FIELDS:${missingFields.join(',')}`)

      const compiled = validateCompiledPrompt(shot || {}, {
        ...settings,
        sceneIndex: index,
        requireStructuredContinuity: structuredContinuityRequired
      })
      compiled.warnings.forEach((warning) => {
        if (warning !== 'CAMERA_FIELD_EMPTY' || !missingFields.includes('camera')) warnings.push(`${label}:${warning}`)
      })
      compiled.errors.forEach((error) => errors.push(`${label}:${error}`))

      const basePrompt = cleanText(shot && (shot.prompt || shot.imagePrompt || shot.finalPrompt || shot.compiledPrompt))
      const imagePrompt = cleanText([basePrompt, compiled.compiledPrompt].filter((value, valueIndex, values) => value && values.indexOf(value) === valueIndex).join(' '))
      const eventText = cleanText([
        shot && (shot.action || shot.visualEvent || shot.beat || shot.prompt),
        shot && (shot.visibleConsequence || shot.result || shot.evidence)
      ].filter(Boolean).join(' '))
      if (dependsOnReadableText(imagePrompt)) warnings.push(`${label}:READABLE_TEXT_DEPENDENCY`)
      if (ABSTRACT_EVENT_PATTERN.test(eventText) && !VISIBLE_EVIDENCE_PATTERN.test(eventText)) {
        warnings.push(`${label}:ABSTRACT_EVENT_WITHOUT_VISIBLE_EVIDENCE`)
      }

      const conflicts = identityConflicts(referenceFacts, imagePrompt)
      conflicts.forEach((conflict) => warnings.push(`${label}:IDENTITY_CONFLICT:${conflict.category}:${conflict.expected}->${conflict.actual}`))

      const subjectState = structuredSubjectState(shot || {}, settings)
      const keyPropLedger = structuredKeyPropLedger(shot || {}, settings)
      if (subjectState && subjectState.appearance) {
        keyPropLedger.items.forEach((prop) => {
          if (propStateClass(prop.state) !== 'degraded') return
          if (subjectAppearanceMentionsProp(subjectState.appearance, prop)) {
            warnings.push(`${label}:DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE:${prop.name || prop.id}`)
          }
        })
      }

      return {
        scene: number,
        label,
        status: errors.length ? STATUS.FAIL : (warnings.length ? STATUS.WARNING : STATUS.PASS),
        missingFields,
        cameraInline: compiled.cameraInline,
        visualSignature: visualSignature(shot || {}),
        actionSignature: actionSignature(shot || {}),
        subjectState,
        keyProps: keyPropLedger.items,
        identityConflicts: conflicts,
        warnings,
        errors
      }
    })

    const globalWarnings = []
    const hardErrors = []
    const addSceneWarning = (index, warning) => {
      const scene = perScene[index]
      if (!scene || !warning || scene.warnings.includes(warning)) return
      scene.warnings.push(warning)
      scene.status = scene.status === STATUS.FAIL ? STATUS.FAIL : STATUS.WARNING
      globalWarnings.push(warning)
    }
    if (shots.length !== expectedCount) hardErrors.push(`SHOT_COUNT_EXPECTED_${expectedCount}:ACTUAL_${shots.length}`)
    perScene.forEach((scene) => hardErrors.push(...scene.errors))

    for (let index = 1; index < perScene.length; index += 1) {
      const current = perScene[index]
      const previous = perScene[index - 1]
      if (current.visualSignature && current.visualSignature === previous.visualSignature) {
        const warning = `${current.label}:ADJACENT_VISUAL_SIGNATURE_REPEAT:${previous.label}`
        current.warnings.push(warning)
        current.status = current.status === STATUS.FAIL ? STATUS.FAIL : STATUS.WARNING
        globalWarnings.push(warning)
      }
      if (current.actionSignature && current.actionSignature === previous.actionSignature) {
        const warning = `${current.label}:ADJACENT_ACTION_REPEAT:${previous.label}`
        current.warnings.push(warning)
        current.status = current.status === STATUS.FAIL ? STATUS.FAIL : STATUS.WARNING
        globalWarnings.push(warning)
      }
    }

    if (structuredContinuityRequired) {
      const baselineValue = settings.subjectBaseline || settings.subjectState || settings.continuity && settings.continuity.subjectState
      let acceptedSubject = subjectStateFromValue(baselineValue)
      shots.forEach((shot, index) => {
        const current = structuredSubjectState(shot || {}, settings)
        if (!current || !current.id || !current.appearance || !current.state) return
        if (!acceptedSubject) {
          acceptedSubject = { ...current }
          return
        }
        const hasChangeEvent = meaningfulChangeEvent(current.changeEvent)
        const acceptedNext = { ...acceptedSubject }
        if (comparableStateText(current.id) !== comparableStateText(acceptedSubject.id)) {
          if (!hasChangeEvent) addSceneWarning(index, `${perScene[index].label}:SUBJECT_IDENTITY_DRIFT_WITHOUT_EVENT:${acceptedSubject.id}->${current.id}`)
          else acceptedNext.id = current.id
        }
        if (comparableStateText(current.appearance) !== comparableStateText(acceptedSubject.appearance)) {
          if (!hasChangeEvent) addSceneWarning(index, `${perScene[index].label}:SUBJECT_APPEARANCE_DRIFT_WITHOUT_EVENT`)
          else acceptedNext.appearance = current.appearance
        }
        if (comparableStateText(current.state) !== comparableStateText(acceptedSubject.state)) {
          if (!hasChangeEvent) addSceneWarning(index, `${perScene[index].label}:SUBJECT_STATE_DRIFT_WITHOUT_EVENT`)
          else acceptedNext.state = current.state
        }
        if (hasChangeEvent) acceptedNext.changeEvent = current.changeEvent
        acceptedSubject = acceptedNext
      })

      const baselineProps = structuredKeyPropLedger(null, {
        structuredKeyProps: settings.structuredKeyProps || settings.keyPropStates || settings.continuity && settings.continuity.keyProps,
        useKeyPropFallback: true
      }).items
      const acceptedProps = new Map(baselineProps.map((prop) => [comparableStateText(prop.id), { ...prop }]))
      shots.forEach((shot, index) => {
        const ledger = structuredKeyPropLedger(shot || {}, settings)
        if (!ledger.present) return
        const currentById = new Map(ledger.items.map((prop) => [comparableStateText(prop.id), prop]))
        acceptedProps.forEach((previous, propId) => {
          if (!currentById.has(propId)) addSceneWarning(index, `${perScene[index].label}:KEY_PROP_LEDGER_DROPPED:${previous.name || previous.id}`)
        })
        ledger.items.forEach((current) => {
          const propId = comparableStateText(current.id)
          const previous = acceptedProps.get(propId)
          const hasChangeEvent = meaningfulChangeEvent(current.changeEvent)
          if (!previous) {
            if (index > 0 && !hasChangeEvent) addSceneWarning(index, `${perScene[index].label}:KEY_PROP_INTRODUCED_WITHOUT_EVENT:${current.name || current.id}`)
            acceptedProps.set(propId, { ...current })
            return
          }
          const acceptedNext = { ...previous }
          if (comparableStateText(current.appearance) !== comparableStateText(previous.appearance)) {
            if (!hasChangeEvent) addSceneWarning(index, `${perScene[index].label}:KEY_PROP_APPEARANCE_DRIFT_WITHOUT_EVENT:${current.name || current.id}`)
            else acceptedNext.appearance = current.appearance
          }
          if (comparableStateText(current.state) !== comparableStateText(previous.state)) {
            if (!hasChangeEvent) {
              addSceneWarning(index, `${perScene[index].label}:KEY_PROP_STATE_DRIFT_WITHOUT_EVENT:${current.name || current.id}:${previous.state}->${current.state}`)
              if (propStateClass(previous.state) === 'degraded' && propStateClass(current.state) === 'usable') {
                addSceneWarning(index, `${perScene[index].label}:PROP_STATE_RECOVERY_RISK:${current.name || current.id}`)
              }
            } else {
              acceptedNext.state = current.state
            }
          }
          if (hasChangeEvent) {
            acceptedNext.location = current.location
            acceptedNext.changeEvent = current.changeEvent
          }
          acceptedProps.set(propId, acceptedNext)
        })
      })
    }

    if (!structuredContinuityRequired) keyProps.forEach((prop) => {
      let destroyedAt = null
      shots.forEach((shot, index) => {
        const scene = perScene[index]
        const prompt = cleanText([
          shot && shot.prompt,
          shot && shot.action,
          shot && shot.visibleConsequence,
          explicitPropState(shot, prop)
        ].filter(Boolean).join(' '))
        if (!textMentionsProp(prompt, prop) && !explicitPropState(shot, prop)) return
        if (isDestroyedState(prompt)) {
          destroyedAt = scene.label
          return
        }
        if (destroyedAt && !isResidualOrRestored(prompt)) {
          const warning = `${scene.label}:PROP_STATE_RECOVERY_RISK:${prop}:AFTER_${destroyedAt}`
          scene.warnings.push(warning)
          scene.status = scene.status === STATUS.FAIL ? STATUS.FAIL : STATUS.WARNING
          globalWarnings.push(warning)
        }
        if (PROP_RESTORED_PATTERN.test(prompt)) destroyedAt = null
      })
    })

    perScene.forEach((scene) => globalWarnings.push(...scene.warnings))
    const warnings = Array.from(new Set(globalWarnings))
    const cameraWarnings = warnings.filter((warning) => /CAMERA_|VISUAL_SIGNATURE/.test(warning))
    const progressionWarnings = warnings.filter((warning) => /ACTION_REPEAT|READABLE_TEXT|ABSTRACT_EVENT|IDENTITY_CONFLICT|PROP_STATE|DEGRADED_PROP|SUBJECT_|KEY_PROP_/.test(warning))

    let endingQuality = hardErrors.length ? STATUS.FAIL : STATUS.PASS
    const finalScene = perScene[perScene.length - 1]
    const finalShot = shots[shots.length - 1]
    const finalText = cleanText(finalShot && (finalShot.action || finalShot.visibleConsequence || finalShot.prompt))
    if (!hardErrors.length && finalScene) {
      const priorActions = perScene.slice(0, -1).map((scene) => scene.actionSignature).filter(Boolean)
      if (ENDING_PLACEHOLDER_PATTERN.test(finalText) || (finalScene.actionSignature && priorActions.includes(finalScene.actionSignature))) {
        const warning = `${finalScene.label}:ENDING_UNRESOLVED_OR_REPEATED`
        if (!finalScene.warnings.includes(warning)) finalScene.warnings.push(warning)
        finalScene.status = finalScene.status === STATUS.FAIL ? STATUS.FAIL : STATUS.WARNING
        if (!warnings.includes(warning)) warnings.push(warning)
        endingQuality = STATUS.WARNING
      }
    }

    const diagnosticIssue = (value, severity) => {
      const parts = cleanText(value).split(':')
      const hasScene = /^SCENE_\d+$/.test(parts[0])
      return Object.freeze({
        code: hasScene ? (parts[1] || 'UNKNOWN') : (parts[0] || 'UNKNOWN'),
        severity,
        scene: hasScene ? Number(parts[0].slice(6)) : null,
        detail: value
      })
    }
    const issues = [
      ...hardErrors.map((value) => diagnosticIssue(value, 'ERROR')),
      ...warnings.map((value) => diagnosticIssue(value, 'WARNING'))
    ]

    return Object.freeze({
      status: hardErrors.length ? STATUS.FAIL : (warnings.length ? STATUS.WARNING : STATUS.PASS),
      structuredContinuityRequired,
      storyProgression: hardErrors.length ? STATUS.FAIL : (progressionWarnings.length ? STATUS.WARNING : STATUS.PASS),
      cameraDiversity: hardErrors.length ? STATUS.FAIL : (cameraWarnings.length ? STATUS.WARNING : STATUS.PASS),
      endingQuality,
      warnings: Object.freeze(warnings),
      warningText: warnings.join('; '),
      hardError: hardErrors[0] || '',
      hardErrors: Object.freeze(hardErrors),
      issues: Object.freeze(issues),
      perScene: Object.freeze(perScene.map((scene) => Object.freeze({
        ...scene,
        subjectState: scene.subjectState ? Object.freeze({ ...scene.subjectState }) : null,
        keyProps: Object.freeze(scene.keyProps.map((item) => Object.freeze({ ...item }))),
        missingFields: Object.freeze(scene.missingFields.slice()),
        identityConflicts: Object.freeze(scene.identityConflicts.map((item) => Object.freeze({ ...item }))),
        warnings: Object.freeze(scene.warnings.slice()),
        errors: Object.freeze(scene.errors.slice()),
        issues: Object.freeze([
          ...scene.errors.map((value) => diagnosticIssue(value, 'ERROR')),
          ...scene.warnings.map((value) => diagnosticIssue(value, 'WARNING'))
        ])
      })))
    })
  }

  return Object.freeze({
    version: '1.1.0',
    STATUS,
    cameraFeatures,
    visualSignature,
    compileScenePromptParts,
    validateCompiledPrompt,
    terminalKeyPropPriorityRule,
    evaluateShots
  })
})
