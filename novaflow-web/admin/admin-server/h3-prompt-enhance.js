// Shared policy with the local Python optimizer. Checks are intentionally
// conservative and do not claim to measure visual generation quality.
const policy = require('../prompt_assistant/h3_prompt_enhance_policy.json');
const instruction = policy.instructions.join('\n');
function narrative(value) {
  let text = String(value || '');
  const detailed = /【递进式详细提示词】\s*([\s\S]*?)(?=【台词】|$)/.exec(text);
  if (detailed) text = detailed[1].replace(/^\s*\d+(?:\.\d+)?\s*[-–—~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：]?/gm, '');
  const match = /(?:^|\n)\s*(?:integrated_multimodal_description|detailed_description)\s*:\s*([\s\S]*?)(?=\n\s*[a-z][a-z0-9_]*\s*:|$)/.exec(text);
  if (match) text = match[1];
  return text.replace(/\[Shot\s+\d+\](?:\s+At\s+\d{2}:\d{2}\.\d{3})?/gi, '')
    .replace(/<(?:Picture|Video|Audio|Subject) \d+>/gi, '')
    .replace(new RegExp(policy.genericPaddingPattern, 'gi'), '');
}
const compact = value => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
function validate(output, source, userRequirement = '') {
  if (new RegExp(policy.formatOnlyPattern, 'i').test(userRequirement)) return output;
  const beforeText = narrative(source), afterText = narrative(output);
  const before = compact(beforeText), after = compact(afterText);
  if (before) {
    const pairs = value => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
    const oldPairs = pairs(before), newPairs = pairs(after);
    const novel = [...newPairs].filter(pair => !oldPairs.has(pair));
    if (!after.split(before).join('') || (before.length >= 40 && novel.length < 6 && after.length >= before.length * 0.9)) {
      throw new Error(policy.noChangeMessage);
    }
  }
  if (new RegExp(policy.loopPattern, 'i').test(beforeText + '\n' + userRequirement)
      && !new RegExp(policy.cancelLoopPattern, 'i').test(userRequirement || beforeText)
      && !new RegExp(policy.closurePattern, 'i').test(afterText)) throw new Error(policy.loopMessage);
  return output;
}
const sectionNames = ['任务定位', '说话者', '递进式详细提示词', '台词', '连续性与约束'];
const sectionFields = ['task', 'speakers', 'description', 'dialogue', 'constraints'];
const formatInstruction = policy.formatInstructions.join('\n');
const referenceFields = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
const referenceInstruction = policy.referenceInstructions.join('\n');
const referenceResultInstruction = 'Return a bilingual object with modelPrompt, displayPrompt and editPolicy. The two prompts contain the same six H3 fields. editPolicy contains only the three internal booleans defined in the instructions. modelPrompt has English prose for H3; displayPrompt is its faithful Simplified Chinese translation for the editor. Keep every media tag, subject ID, task, retention relation, time, direction, dialogue and constraint identical in meaning. Do not add creative changes while translating.';
function referenceFrames(value, requirements = '') {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 13) throw new Error('H3 参考画面数量无效');
  const labels = new Set((requirements.match(/^Available resource labels:[^\n]*/im)?.[0] || '').match(/<(?:Picture|Video) [1-9]\d*>/g) || []);
  const seen = new Map();
  let bytes = 0;
  return value.map(item => {
    const label = String(item?.label || '');
    const dataUrl = String(item?.dataUrl || '');
    if (!labels.has(label) || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('H3 参考画面与素材不匹配');
    bytes += dataUrl.length;
    if (dataUrl.length > 2500000 || bytes > 16000000) throw new Error('H3 参考画面过大');
    if (label.startsWith('<Picture')) {
      if (seen.has(label)) throw new Error('H3 参考图重复');
      seen.set(label, 0);
      return {label, dataUrl};
    }
    const timeSeconds = Number(item?.timeSeconds);
    const previous = seen.get(label);
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 15 || (previous != null && timeSeconds <= previous)) throw new Error('H3 参考视频帧时间无效');
    seen.set(label, timeSeconds);
    return {label, dataUrl, timeSeconds};
  });
}
const referenceFieldSchema = language => ({type:'object', additionalProperties:false, properties:Object.fromEntries(referenceFields.map(k=>[k,{type:'string',minLength:1,description:(language==='zh'?'本字段是对应英文内容的完整中文翻译。所有说明句必须是简体中文，包括任务说明和保留属性；仅素材标签、任务标记、关系枚举以及固定源视频前缀保持英文，不得整句照抄英文。':'Write the actual H3 field content in English. Preserve source media labels and user-supplied literal dialogue.') + (k==='subject_definitions'?' Define each Subject exactly once, merging its appearance and motion sources; define the source Video separately.':k==='retention_analysis'?' One rule per defined Subject and source Video; image attributes belong to the Subject using that picture.':k==='overall_soundscape'||k==='non_diegetic_music'?' Use N/A for absent or unrequested audio, never an empty string.':'')}])), required:referenceFields});
const referenceEditPolicySchema = {type:'object',additionalProperties:false,properties:{preserveBackground:{type:'boolean'},preserveMotion:{type:'boolean'},sameShapeAppearanceOnly:{type:'boolean'}},required:['preserveBackground','preserveMotion','sameShapeAppearanceOnly']};
const referenceResultSchema = {type:'object', additionalProperties:false, properties:{modelPrompt:referenceFieldSchema('en'),displayPrompt:referenceFieldSchema('zh'),editPolicy:referenceEditPolicySchema},required:['modelPrompt','displayPrompt','editPolicy']};
function referenceEditPolicy(value) {
  return Object.fromEntries(['preserveBackground','preserveMotion','sameShapeAppearanceOnly'].map(key=>[key,value?.[key]===true]));
}
function referenceResult(value) {
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1').trim()) : value; } catch (_) {}
  if (parsed && Object.hasOwn(parsed,'modelPrompt') && Object.hasOwn(parsed,'displayPrompt')) return parsed;
  return null;
}
function compileReferenceFields(value, options) {
  let fields;
  try { fields = typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { return value; }
  if (!fields || Array.isArray(fields) || typeof fields !== 'object') return value;
  fields = {...fields};
  const explicitAudio = /<Audio [1-9]\d*>/.test(options.requirements || '') || /声音|音频|音乐|配乐|\b(?:sound|audio|music)\b/i.test((options.currentPrompt || '') + (options.userRequirement || ''));
  for (const key of ['overall_soundscape','non_diegetic_music']) {
    if (!explicitAudio && (fields[key] == null || fields[key] === '')) fields[key] = 'N/A';
  }
  if (typeof fields.subject_definitions !== 'string' || typeof fields.retention_analysis !== 'string') return fields;
  // Multiple sentences about the same ID are one subject, not new identities.
  const definitions = new Map();
  for (const line of fields.subject_definitions.split(/\r?\n/).filter(l=>l.trim())) {
    const match = /^(<(?:Subject|Video|Picture|Audio) [1-9]\d*>)(.*)$/.exec(line.trim());
    if (!match) return fields;
    definitions.set(match[1], [definitions.get(match[1]), match[2].trim()].filter(Boolean).join('; '));
  }
  let retention = fields.retention_analysis;
  const subjects = [...definitions].filter(([id])=>id.startsWith('<Subject '));
  // Task markers follow the model's actual bindings, not a phrase the user
  // must type. An appearance image attached to a Subject is guidance.
  if (typeof fields.summary === 'string' && subjects.some(([,description])=>/<Picture [1-9]\d*>/.test(description))) {
    fields.summary = fields.summary.replace(/^\[([^\]]+)\]/, (prefix, content)=>{
      const tasks = content.split(/\s*\+\s*/);
      return tasks.includes('video editing') && !tasks.includes('reference generation')
        ? '[' + [...tasks, 'reference generation'].join(' + ') + ']' : prefix;
    });
  }
  // Move an image-attribute rule only when the model binds that picture to
  // exactly one subject and has not already supplied a subject rule.
  retention = retention.split(/\r?\n/).map(line=>{
    const picture = /^(<Picture [1-9]\d*>)(?:[^:]*):\s*(attribute_transfer|fully_preserved|partially_preserved|weak_reference)\b/.exec(line);
    if (!picture) return line;
    const owners = subjects.filter(([,description])=>description.includes(picture[1]));
    if (owners.length!==1 || retention.split(/\r?\n/).some(l=>l.startsWith(owners[0][0]))) return line;
    return line.replace(picture[1],owners[0][0]);
  }).join('\n');
  const sourceVideo = /(?:The target video is an edited version of\s*|目标视频是\s*|输出视频由\s*)(<Video [1-9]\d*>)/.exec(fields.summary || '')?.[1];
  if (sourceVideo && !definitions.has(sourceVideo) && retention.split('\n').some(l=>l.startsWith(sourceVideo))) {
    definitions.set(sourceVideo, options.requireChineseOutput ? '：本次编辑的源视频。' : ': The source video for this edit.');
  }
  fields.subject_definitions = [...definitions].map(([label,description])=>label+' '+description).join('\n');
  fields.retention_analysis = retention;
  return fields;
}
function validateReferenceResult(value, options = {}) {
  const pair = referenceResult(value);
  if (!pair) {
    const compiled = compileReferenceFields(value, options);
    return validateReference(typeof compiled === 'string' ? compiled : JSON.stringify(compiled), options);
  }
  const serialize = v => typeof v === 'string' ? v : JSON.stringify(v);
  let modelPrompt = validateReference(serialize(compileReferenceFields(pair.modelPrompt, {...options,requireChineseOutput:false})), {...options,requireChineseOutput:false});
  let displayPrompt = validateReference(serialize(compileReferenceFields(pair.displayPrompt, {...options,requireChineseOutput:true})), {...options,requireChineseOutput:true});
  // Mirror the local compiler's defaults so a provider result is completed, not
  // rejected: a requested loop gets its closure, a generated shot its camera.
  const appendNarrative = (text, sentence) => text.replace(/(detailed_description:\n[\s\S]*?)(?=\n\noverall_soundscape:)/, m => m.trimEnd() + ' ' + sentence);
  const narrativeOf = text => text.split('detailed_description:')[1]?.split('overall_soundscape:')[0] || '';
  const sourcePrompt = String(options.currentPrompt || '');
  const userTail = (String(options.requirements || '').split(/Source prompt:\n/)[1] || '').slice(sourcePrompt.length);
  const intent = sourcePrompt + '\n' + userTail;
  if (new RegExp(policy.loopPattern, 'i').test(intent) && !new RegExp(policy.cancelLoopPattern, 'i').test(intent)
      && !new RegExp(policy.closurePattern, 'i').test(narrativeOf(modelPrompt))) {
    modelPrompt = appendNarrative(modelPrompt, 'It ends by returning smoothly to the starting pose and motion phase so the loop joins naturally.');
    if (!new RegExp(policy.closurePattern, 'i').test(narrativeOf(displayPrompt))) displayPrompt = appendNarrative(displayPrompt, '结束时平滑回到起始姿态与运动相位，使循环自然衔接。');
  }
  const cameraPattern = /镜头|相机|摄像|机位|运镜|\bcamera\b|\bzoom\b|\bdolly\b|\bpanning\b/i;
  if (!/summary:\s*\[[^\]]*\bvideo editing\b/.test(modelPrompt) && !cameraPattern.test(narrativeOf(modelPrompt) + intent)) {
    modelPrompt = appendNarrative(modelPrompt, 'The camera remains static and the framing stays stable.');
    if (!cameraPattern.test(narrativeOf(displayPrompt))) displayPrompt = appendNarrative(displayPrompt, '镜头固定，构图保持稳定。');
  }
  const narrative = modelPrompt.split('detailed_description:')[1]?.split('overall_soundscape:')[0] || '';
  const prose = narrative.replace(/<d>[\s\S]*?<\/d>|<(?:Picture|Video|Audio|Subject) \d+>|\[Shot \d+\]|"[^"\n]*"|“[^”\n]*”/g, '');
  const han = (prose.match(/[\u3400-\u9fff]/g)||[]).length;
  if (han > 8 && (prose.match(/[A-Za-z]{2,}/g)||[]).join('').length < han * 2) throw new Error('H3 模型侧提示词需要英文正文，中文内容仅用于编辑器显示');
  const bindings = text => [...text.matchAll(/^<(Subject|Video|Picture|Audio) ([1-9]\d*)>[^\n:]*:\s*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b/gm)].map(m=>[m[1],m[2],m[3]].join(':')).sort().join('|');
  const sources = text => text.split('summary:')[0].split('\n').filter(l=>/^<Subject \d+>/.test(l)).map(l=>[l.match(/^<Subject \d+>/)[0],...[...new Set(l.match(/<(?:Picture|Video|Audio) \d+>/g)||[])].sort()].join('|')).sort().join('\n');
  const tasks = text => /summary:\s*\[([^\]]+)\]/.exec(text)?.[1].split(/\s*\+\s*/).sort().join('|');
  if (bindings(modelPrompt) !== bindings(displayPrompt) || sources(modelPrompt) !== sources(displayPrompt) || tasks(modelPrompt) !== tasks(displayPrompt)) throw new Error('H3 中英文提示词的素材关系不一致');
  const editPolicy = pair.editPolicy ? referenceEditPolicy(pair.editPolicy) : null;
  if (editPolicy && !/<Picture [1-9]\d*>/.test(modelPrompt)) editPolicy.sameShapeAppearanceOnly = false;
  return JSON.stringify({modelPrompt,displayPrompt,...(editPolicy ? {editPolicy} : {})});
}
const referenceDisplayFields = ['主体定义', '任务说明', '保留规则', '画面与动作', '环境声音', '背景音乐'];
const referenceDisplayTerms = {
  'reference generation': '参考生成', 'keyframe completion': '关键帧补全', 'video editing': '视频编辑',
  'video continuation': '视频续写', 'audio reuse': '音频复用', 'audio reference': '音频参考',
  fully_preserved: '完全保留', partially_preserved: '部分保留', attribute_transfer: '属性迁移', weak_reference: '弱参考',
  fully_copy: '完整复用', partially_copy: '部分复用', reference: '参考',
};
function toReferenceDisplay(value) {
  let text = String(value || '').replace(/\r\n/g, '\n');
  referenceFields.forEach((field, i) => { text = text.replace(new RegExp('^' + field + ':[ \\t]*', 'gm'), '【' + referenceDisplayFields[i] + '】\n'); });
  text = text.replace(/<Subject ([1-9]\d*)>/g, '<主体 $1>').replace(/\[Shot ([1-9]\d*)\]/g, '【镜头 $1】')
    .replace(/The target video is an edited version of (<Video [1-9]\d*>|@视频参考)\./g, '输出视频由 $1 编辑而成。')
    .replace(/Source assets:/g, '素材来源：').replace(/The shot shows (<主体 [1-9]\d*>)\./g, '画面中呈现 $1。')
    .replace(/^(<主体 [1-9]\d*>) is /gm, '$1：').replace(/^N\/A\.?$/gm, '无');
  text = text.replace(/\[([^\]\n]+)\]/g, (all, terms) => terms.split(/\s*\+\s*/).every(t => referenceDisplayTerms[t]) ? '[' + terms.split(/\s*\+\s*/).map(t => referenceDisplayTerms[t]).join(' + ') + ']' : all);
  return text.replace(/:\s*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b/g, (_, term) => ': ' + referenceDisplayTerms[term]);
}
function fromReferenceDisplay(value) {
  let text = String(value || '').replace(/\r\n/g, '\n');
  if (!/^【主体定义】/m.test(text)) return text;
  referenceDisplayFields.forEach((field, i) => { text = text.replace(new RegExp('^【' + field + '】[ \\t]*', 'gm'), referenceFields[i] + ':\n'); });
  const reverse = Object.fromEntries(Object.entries(referenceDisplayTerms).map(([key, val]) => [val, key]));
  text = text.replace(/<主体 ([1-9]\d*)>/g, '<Subject $1>').replace(/【镜头 ([1-9]\d*)】/g, '[Shot $1]')
    .replace(/输出视频由 (<Video [1-9]\d*>|@视频参考) 编辑而成。/g, 'The target video is an edited version of $1.')
    .replace(/素材来源：/g, 'Source assets:').replace(/^无$/gm, 'N/A');
  text = text.replace(/\[([^\]\n]+)\]/g, (all, terms) => terms.split(/\s*\+\s*/).every(t => reverse[t]) ? '[' + terms.split(/\s*\+\s*/).map(t => reverse[t]).join(' + ') + ']' : all);
  return text.replace(/[:：]\s*(完全保留|部分保留|属性迁移|弱参考|完整复用|部分复用|参考)(?=\s|[-—]|$)/gm, (_, term) => ': ' + reverse[term]);
}
function isReferenceMode(options = {}) {
  return /^(?:ref2va|r2v|multi_reference|full_reference)$/i.test(String(options.mode || options.minimaxH3Mode || options.h3Mode || ''));
}
function reconcileReferenceTasks(tasks, allowed) {
  const has = prefix => allowed.some(label => label.startsWith(prefix));
  const kept = [];
  for (const raw of tasks) {
    const task = String(raw).trim().toLowerCase();
    if ((task === 'video editing' || task === 'video continuation') && !has('<Video ')) continue;
    if ((task === 'audio reuse' || task === 'audio reference') && !has('<Audio ')) continue;
    if (task === 'keyframe completion' && !has('<Picture ')) continue;
    if (!kept.includes(task)) kept.push(task);
  }
  if (!kept.some(task => ['reference generation', 'keyframe completion', 'video editing', 'video continuation'].includes(task))) kept.unshift('reference generation');
  return kept;
}
function validateReference(value, options = {}) {
  let text = fromReferenceDisplay(value).trim().replace(/^```(?:json|text)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  if (text.startsWith('{')) {
    const parsed = JSON.parse(text);
    if (Object.keys(parsed).some(k => !referenceFields.includes(k)) || referenceFields.some(k => typeof parsed[k] !== 'string' || !parsed[k].trim())) throw new Error('H3 多参需要完整的六个参考字段');
    text = referenceFields.map(k => k + ':\n' + parsed[k].trim()).join('\n\n');
  }
  const headers = [...text.matchAll(/^([a-z][a-z0-9_]*):[ \t]*/gm)];
  if (headers.length !== referenceFields.length || headers.some((m, i) => m[1] !== referenceFields[i])) throw new Error('H3 多参需要完整的六个参考字段');
  const fields = Object.fromEntries(headers.map((m, i) => [m[1], text.slice(m.index + m[0].length, headers[i + 1]?.index ?? text.length).trim()]));
  if (Object.values(fields).some(v => !v)) throw new Error('H3 多参字段不能为空');
  fields.summary = fields.summary.replace(/^(\[[^\]]+\]\s*)(?:目标视频是\s*(<Video [1-9]\d*>)\s*的编辑版本|输出视频由\s*(<Video [1-9]\d*>)\s*编辑而成)[。.]?/, (_, prefix, first, second) => prefix + 'The target video is an edited version of ' + (first || second) + '.');
  fields.summary = fields.summary.replace(/^(\[[^\]]+\]\s*The target video is an edited version of <Video [1-9]\d*>)。/, '$1.');
  fields.retention_analysis = fields.retention_analysis.replace(/：\s*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b/g, ': $1');
  if (options.requireChineseOutput) {
    for (const field of ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description']) {
      const prose = fields[field].replace(/<(?:Picture|Video|Audio|Subject) \d+>|<d>.*?<\/d>|\[[^\]]+\]|The target video is an edited version of|\([^)]*\)|fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy/g, '');
      const words = prose.match(/[A-Za-z]{2,}/g) || [];
      const han = (prose.match(/[\u3400-\u9fff]/g) || []).length;
      if (words.length >= 8 && words.join('').length > han * 2) throw new Error('请将多参主体、任务说明和画面动作改为简体中文，保留原台词和媒体标签');
    }
  }
  const inventory = String(options.requirements || '').match(/^Available resource labels:([^\n]*)/im);
  const media = v => [...new Set(v.match(/<(?:Picture|Video|Audio) [1-9]\d*>/g) || [])];
  if (inventory) {
    const allowed = media(inventory[1]), used = media(text);
    if (used.some(t => !allowed.includes(t))) throw new Error('H3 多参引用与已上传素材不一致');
  }
  const definitions = [...fields.subject_definitions.matchAll(/^<Subject ([1-9]\d*)>[^\n]+/gm)];
  const ids = definitions.map(m => Number(m[1]));
  if (ids.some((id, i) => id !== i + 1) || [...text.matchAll(/<Subject ([1-9]\d*)>/g)].some(m => !ids.includes(Number(m[1])))) throw new Error('H3 多参主体缺少独立定义');
  for (const m of definitions) {
    if (/<(?:Picture|Video) [1-9]\d*>/.test(inventory?.[1] || text) && !/<(?:Picture|Video) [1-9]\d*>/.test(m[0])) throw new Error('H3 多参主体必须说明外观或动作的素材来源');
  }
  const task = /^\[([^\]]+)\]/.exec(fields.summary);
  let tasks = task?.[1].split(/\s*\+\s*/) || [];
  if (!tasks.length || tasks.some(t => !['reference generation','keyframe completion','video editing','video continuation','audio reuse','audio reference'].includes(t))) throw new Error('H3 多参缺少明确任务关系');
  if (inventory) {
    // The uploads decide the task list: no video means nothing to edit or
    // continue, no audio means no audio task. Trim the guess instead of failing.
    const reconciled = reconcileReferenceTasks(tasks, media(inventory[1]));
    if (reconciled.join(' + ') !== tasks.join(' + ')) {
      tasks = reconciled;
      fields.summary = '[' + tasks.join(' + ') + ']' + fields.summary.slice(task[0].length);
      text = referenceFields.map(k => k + ':\n' + fields[k]).join('\n\n');
    }
  }
  if (tasks.includes('reference generation') && text.includes('<Picture ') && !ids.length) throw new Error('H3 多参主体缺少独立定义');
  if (tasks.includes('video editing') && !/^\[[^\]]+\]\s*The target video is an edited version of <Video [1-9]\d*>(?:\.|\s)/.test(fields.summary)) throw new Error('H3 视频编辑必须指定源视频');
  const tracked = [...fields.subject_definitions.matchAll(/^<(Subject|Picture|Video|Audio) ([1-9]\d*)>/gm)];
  for (const m of tracked) {
    const line = fields.retention_analysis.split('\n').find(l => l.trim().startsWith(m[0]));
    const relation = m[1] === 'Audio' ? /:\s*(?:fully_copy|partially_copy|reference|weak_reference)\b/ : /:\s*(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference)\b/;
    if (!line || !relation.test(line)) throw new Error('H3 多参缺少主体或声音的保留规则');
  }
  // A single explicitly defined subject is unambiguous. Bind its prose to the
  // existing ID without changing appearance or action. Never guess with many.
  if (ids.length === 1 && !/<Subject [1-9]\d*>/.test(fields.detailed_description)) {
    fields.detailed_description = fields.detailed_description.replace('[Shot 1]', '[Shot 1] The shot shows <Subject 1>.');
  }
  if (ids.some(id => !fields.detailed_description.includes('<Subject ' + id + '>'))) throw new Error('H3 多参镜头必须引用已定义主体');
  if (!fields.detailed_description.includes('[Shot 1]')) throw new Error('H3 多参缺少镜头描述');
  for (const m of fields.detailed_description.matchAll(/\[Shot \d+\] At (\d+):(\d+)\.(\d+)/g)) {
    if (Number(m[1])*60 + Number(m[2]) + Number('0.'+m[3]) > Number(options.durationSeconds || 30)) throw new Error('H3 多参镜头超出所选时长');
  }
  return referenceFields.map(k => k + ':\n' + fields[k]).join('\n\n');
}
// Only return application-owned messages. Provider text must never become a
// diagnostic or a repair instruction, even when it resembles an error message.
const validationIssues = [
  ['language', ['请将多参主体、任务说明和画面动作改为简体中文，保留原台词和媒体标签']],
  ['references', ['H3 中英文提示词的素材关系不一致']],
  ['language', ['H3 模型侧提示词需要英文正文，中文内容仅用于编辑器显示']],
  ['references', ['H3 多参引用与已上传素材不一致', 'H3 多参主体缺少独立定义', 'H3 多参主体必须说明外观或动作的素材来源', 'H3 多参缺少主体或声音的保留规则', 'H3 多参镜头必须引用已定义主体']],
  ['sections', ['H3 多参需要完整的六个参考字段', 'H3 多参字段不能为空']],
  ['references', ['H3 多参缺少明确任务关系', 'H3 视频编辑必须指定源视频']],
  ['timeline', ['H3 多参缺少镜头描述', 'H3 多参镜头超出所选时长']],
  ['language', ['请将任务定位、整体描述、时间段及约束改为简体中文，保留原台词和媒体标签']],
  ['sections', ['五段提示词字段缺失或为空', '请按任务定位、说话者、递进式详细提示词、台词、连续性与约束输出完整五段', '五段提示词内容不能为空']],
  ['timeline', ['详细提示词缺少分时段动作', '动作时间段必须从 0 连续递进且不超过所选时长', '动作时间段未覆盖完整时长']],
  ['duration', ['H3 时长必须为 1-30 秒', '任务定位时长与当前设置不一致']],
  ['references', ['参考媒体标签缺失或引用了未提供的媒体', '缺少首帧图片绑定', '缺少尾帧图片绑定']],
  ['speakers', ['说话者定义必须从 <Subject 1> = (S1) 连续编号', '存在未定义的说话者']],
  ['dialogue', ['说话时间线与台词冲突', '台词须使用 (S1)：“...” 或无台词', '原台词未完整保留']],
  ['enhancement', [policy.noChangeMessage, policy.loopMessage]],
];
function validationIssue(error) {
  const message = String(error?.message || '');
  for (const [reason, messages] of validationIssues) {
    if (messages.includes(message)) return {reason, message};
  }
  return {reason:'contract_invalid', message:'返回内容未通过 H3 协议校验'};
}
function requiresChineseOutput(userRequirement = '') {
  const request = String(userRequirement).replace(/(?:不要|禁止|不得|不用|无需|不使用)[^。\n，；;]{0,20}(?:英文|English)[^。\n，；;]*/gi, '')
    .replace(/do not[^.\n]{0,30}english[^.\n]*/gi, '');
  return !/(?:用|使用|改为|输出|写成|以).{0,6}英文|英文.{0,6}(?:输出|提示词|撰写)|(?:write|respond|output|return).{0,20}(?:in )?english|^(?:英文|english)$/i.test(request.trim());
}

function validateFormat(value, options = {}) {
  let text = String(value || '').trim().replace(/^```(?:json|text|plaintext)?\s*\n([\s\S]*?)\n```$/i, '$1').trim().replace(/\\(?=<(?:Picture|Video|Audio|Subject) )/g, '');
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/[（(\[【]?(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—~～至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[）)\]】]?\s*[:：]/gi, '$1-$2s：');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {}
  if (parsed && typeof parsed === 'object') {
    if (sectionFields.some(field => typeof parsed[field] !== 'string' || !parsed[field].trim()) || Object.keys(parsed).some(field => !sectionFields.includes(field))) throw new Error('五段提示词字段缺失或为空');
    text = sectionNames.map((name, i) => `【${name}】\n${parsed[sectionFields[i]].trim()}`).join('\n\n');
  }
  text = text.replace(new RegExp(`^(${sectionNames.join('|')})\\s*[:：]\\s*`, 'gm'), '【$1】\n')
    .replace(/([^\n\d.])(\d+(?:\.\d+)?\s*[-–—~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：])/g, '$1\n\n$2');
  text = text.replace(/（(S[1-9]\d*)）/g, '($1)');
  const headers = [...text.matchAll(/^\s*【([^】]+)】[ \t]*[:：]?[ \t]*/gm)];
  if (headers.length !== 5 || headers.some((m, i) => m[1] !== sectionNames[i]) || text.slice(0, headers[0].index).trim()) throw new Error('请按任务定位、说话者、递进式详细提示词、台词、连续性与约束输出完整五段');
  const sections = headers.map((m, i) => text.slice(m.index + m[0].length, headers[i + 1]?.index ?? text.length).trim());
  if (sections.some(s => !s)) throw new Error('五段提示词内容不能为空');
  if (options.requireChineseOutput) {
    const modeNames = { full_reference:'多参视频', multi_reference:'多参视频', ref2va:'多参视频', image_video:'图生视频', i2va:'图生视频', first_last:'首尾帧视频', fl2va:'首尾帧视频', text_video:'文生视频', t2va:'文生视频' };
    sections[0] = sections[0].replace(/\b(full_reference|multi_reference|Ref2VA|image_video|I2VA|first_last|FL2VA|text_video|T2VA)\b/gi, mode => modeNames[mode.toLowerCase()]);
    for (const index of [0, 1, 2, 4]) {
      for (const paragraph of sections[index].split(/\n+/)) {
        const prose = paragraph.replace(/<(?:Picture|Video|Audio|Subject) \d+>/g, '').replace(/\b(?:S\d+|I2VA|FL2VA|T2VA|Ref2VA|N\/A)\b/g, '');
        const words = prose.match(/[A-Za-z]{2,}/g) || [];
        const han = (prose.match(/[\u3400-\u9fff]/g) || []).length;
        if (words.length >= 8 && words.join('').length > han * 2) throw new Error('请将任务定位、整体描述、时间段及约束改为简体中文，保留原台词和媒体标签');
      }
    }
  }
  const duration = Number(options.durationSeconds);
  if (!Number.isFinite(duration) || duration < 1 || duration > 30) throw new Error('H3 时长必须为 1-30 秒');
  const ranges = [...sections[2].matchAll(/^\s*(\d+(?:\.\d+)?)\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[:：]\s*(.+)/gm)];
  let end = 0;
  if (!ranges.length) throw new Error('详细提示词缺少分时段动作');
  for (const range of ranges) {
    if (Math.abs(Number(range[1]) - end) > 0.051 || Number(range[2]) <= Number(range[1]) || Number(range[2]) > duration + 0.051) throw new Error('动作时间段必须从 0 连续递进且不超过所选时长');
    end = Number(range[2]);
  }
  if (Math.abs(end - duration) > 0.051) throw new Error('动作时间段未覆盖完整时长');
  const taskDuration = /(?:时长\s*[:：]?\s*|duration\s*[:：]?\s*|lasts?\s+)?(\d+(?:\.\d+)?)\s*(?:秒|s\b|seconds?\b)/i.exec(sections[0]);
  if (!taskDuration || Math.abs(Number(taskDuration[1]) - duration) > 0.051) throw new Error('任务定位时长与当前设置不一致');
  // Camera direction is generation guidance, not a literal-keyword validity rule.
  const mode = String(options.mode || options.minimaxH3Mode || '').toLowerCase();
  const i2v = ['i2va', 'image_video', 'i2v'].includes(mode), fl2v = ['fl2va', 'first_last', 'fl2v'].includes(mode);
  const requirements = String(options.requirements || '');
  const source = String(options.currentPrompt || options.sourcePrompt || '');
  const inventory = /^Available resource labels:([^\n]*)/im.exec(requirements);
  const tokens = value => [...new Set(String(value).match(/<(?:Picture|Video|Audio) [1-9]\d*>/g) || [])];
  const allowed = i2v ? ['<Picture 1>'] : fl2v ? ['<Picture 1>', '<Picture 2>'] : tokens(inventory ? inventory[1] : (source + '\n' + requirements));
  const used = tokens(text);
  if (used.some(t => !allowed.includes(t)) || allowed.some(t => !used.includes(t))) throw new Error('参考媒体标签缺失或引用了未提供的媒体');
  if (i2v || fl2v) {
    const anchors = sections[0] + '\n' + sections[2];
    if (!/<Picture 1>[^\n。]{0,100}(?:起始|首帧|开始|starting|opening|first frame)|(?:起始|首帧|starting|opening)[^\n。]{0,100}<Picture 1>/i.test(anchors)) throw new Error('缺少首帧图片绑定');
    if (fl2v && !/<Picture 2>[^\n。]{0,100}(?:末帧|尾帧|终帧|结束|final|last frame)|(?:末帧|尾帧|终帧|final)[^\n。]{0,100}<Picture 2>/i.test(anchors)) throw new Error('缺少尾帧图片绑定');
  }
  const definitions = [...sections[1].matchAll(/<Subject ([1-9]\d*)>\s*=\s*\(S([1-9]\d*)\)/g)];
  if (definitions.some((m, i) => Number(m[1]) !== i + 1 || m[1] !== m[2])) throw new Error('说话者定义必须从 <Subject 1> = (S1) 连续编号');
  const subjectUses = [...text.matchAll(/<Subject ([1-9]\d*)>|\bS([1-9]\d*)\b/g)].map(m => Number(m[1] || m[2]));
  if (subjectUses.some(n => !definitions.some(m => Number(m[1]) === n))) throw new Error('存在未定义的说话者');
  const spoken = [...sections[3].matchAll(/\(S([1-9]\d*)\)\s*[:：]\s*[“"]([^”"]+)[”"]/g)];
  if (spoken.length && /无台词|无对白|完全静音|no dialogue|complete silence/i.test(sections[2])) throw new Error('说话时间线与台词冲突');
  if (!spoken.length && !/^(?:无台词|无对白|无|N\/A|None|No dialogue)[。.]?$/i.test(sections[3])) throw new Error('台词须使用 (S1)：“...” 或无台词');
  for (const m of source.matchAll(/\(S[1-9]\d*\)\s*[:：]\s*[“"]([^”"]+)[”"]/g)) {
    if (!sections[3].includes(m[1])) throw new Error('原台词未完整保留');
  }
  return sectionNames.map((name, i) => `【${name}】\n${sections[i]}`).join('\n\n');
}
// Presentation only: call after the legacy visual-fact and H3 protocol gates.
// Keep all validated narrative and audio values; never run a second model pass.
function fromValidatedLegacy(text, options = {}) {
  if (String(text).trim().startsWith('【任务定位】')) return validateFormat(text, options);
  const fields = [...String(text).matchAll(/^(integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:\s*/gm)];
  if (fields.length !== 3) throw new Error('反推结果缺少已验证的 H3 字段');
  const values = Object.fromEntries(fields.map((m,i)=>[m[1],String(text).slice(m.index+m[0].length,fields[i+1]?.index ?? text.length).trim()]));
  const visual=values.integrated_multimodal_description;
  const duration=Number(options.durationSeconds);
  const fl2v=['first_last','fl2va','fl2v'].includes(String(options.mode || '').toLowerCase());
  const ratio=String(options.currentPrompt || '').match(/\b\d{1,2}:\d{1,2}\b/)?.[0];
  const task=`${fl2v?'首尾帧视频':'图生视频'}，时长${duration}秒${ratio?'，'+ratio:''}。<Picture 1> 为起始首帧${fl2v?'，<Picture 2> 为结束尾帧':''}。`;
  const speech=[...visual.matchAll(/\(S([1-9]\d*)\)\s*[:：]\s*[“"]([^”"]+)[”"]/g)];
  const speakers=[...new Set(speech.map(m=>Number(m[1])))].sort((a,b)=>a-b);
  const definitions=speakers.map(n=>`<Subject ${n}> = (S${n})，原文中对应的说话者。`).join('\n') || '无说话者';
  const dialogue=speech.map(m=>`(S${m[1]})：“${m[2]}”`).join('\n') || '无台词';
  const shots=[...visual.matchAll(/\[Shot (\d+)\](?:\s+At\s+(\d{2}):(\d{2})\.(\d{3}),?)?/g)];
  let phases=[];
  if(shots.length>1) {
    phases=shots.map((m,i)=>({start:i===0?0:Number(m[2])*60+Number(m[3])+Number(m[4])/1000,body:visual.slice(m.index+m[0].length,shots[i+1]?.index ?? visual.length).trim()}));
    if(phases.at(-1).start===duration) {phases[phases.length-2].body+='\n'+phases.pop().body;}
    phases=phases.map((p,i)=>`${p.start}-${phases[i+1]?.start ?? duration}s：${p.body}`);
  } else {
    const edges=[0,Number((duration/3).toFixed(3)),Number((duration*2/3).toFixed(3)),duration];
    const userMotion=String(options.userPrompt || '').trim();
    const simpleUserMotion=userMotion && !/【|\[Shot|\d\s*[-–]\s*\d.*(?:s|秒)/u.test(userMotion) ? userMotion : '';
    const paragraphs=visual.replace(/\[Shot \d+\]/g,'').split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
    const motion=simpleUserMotion || paragraphs.slice(1).filter(p=>!/^到 \d.*秒|^By \d|^镜头保持固定|^The camera holds/u.test(p)).join(' ') || '动作从首帧姿态轻缓开始，以小幅、连续的姿态变化自然推进。';
    const finalAction=simpleUserMotion.match(/(?:最后|最终|结束时)[^。.!]+[。.!]?/u)?.[0] || '延续上述状态和构图，结束片段。';
    phases=[
      `${edges[0]}-${edges[1]}s：以 <Picture 1> 为起始帧，开始执行上述动作，保持原文指定的身份和构图。`,
      `${edges[1]}-${edges[2]}s：${motion}${speech.length?' 同步完成上述台词与口型。':''}`,
      `${edges[2]}-${edges[3]}s：${fl2v?'收束至 <Picture 2> 的结束姿态和构图。':finalAction}`
    ];
  }
  const overall=visual.replace(/\[Shot \d+\](?:\s+At\s+\d{2}:\d{2}\.\d{3},?)?/g,'').trim();
  return validateFormat(JSON.stringify({task,speakers:definitions,description:overall+'\n\n'+phases.join('\n\n'),dialogue,constraints:`1. 保持上述人物身份、参考帧绑定及原文明确的约束。\n2. 环境与动作声音：${values.overall_soundscape}\n3. 配乐：${values.non_diegetic_music}`}),options);
}
module.exports = { instruction, validate, sectionNames, sectionFields, formatInstruction, validateFormat, fromValidatedLegacy, requiresChineseOutput, validationIssue, referenceFields, referenceInstruction, isReferenceMode, validateReference, toReferenceDisplay, fromReferenceDisplay, referenceResultInstruction, referenceResultSchema, referenceResult, validateReferenceResult, referenceFrames };
