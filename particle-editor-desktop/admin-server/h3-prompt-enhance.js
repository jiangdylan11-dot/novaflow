// Shared policy with the local Python optimizer. Checks are intentionally
// conservative and do not claim to measure visual generation quality.
const policy = require('../prompt_assistant/h3_prompt_enhance_policy.json');
const instruction = policy.instructions.join('\n');
// The breathing-idle sentence freezes head, arms and body: send it only when the user's own words ask for idle breathing (the rest of its item stays).
const instructionFor = (intentText = '') => /待机|呼吸|\bidle\b|\bbreath(?:e[sd]?|ing)?\b/i.test(String(intentText)) ? instruction : policy.instructions.map(item => item.replace(/^仅呼吸待机[^。]*。/, '')).filter(Boolean).join('\n');
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
// Shot sizes as H3 reads them; the Chinese half keeps the user's own word. 全景 of a whole scene (城市全景) is a wide shot.
const shotSizes = {大特写:['extreme close-up'], 特写:['close-up'], 近景:['medium close-up'], 中景:['medium shot'], 全景:['full shot', 'wide shot'], 远景:['wide shot'], 大远景:['extreme wide shot'], 中近景:['medium close-up'], 近中景:['medium close-up'], 中全景:['medium full shot'], 中远景:['medium-wide shot']};
const shotSizeRule = 'Shot sizes map exactly: ' + Object.entries(shotSizes).map(([zh, [en, scene]]) => zh + ' ' + en + (scene ? ' (' + scene + ' for a whole scene)' : '')).join(', ') + '.';
// Longest first, so 中远景 is not read as 远景.
const sizeWords = Object.keys(shotSizes).sort((a, b) => b.length - a.length).join('|');
const zhWordRule = '颜色词与景别词逐一准确对应英文（如 navy 藏青色、beige 米色、wide shot 远景、full shot 全景、medium close-up 近景、close-up 特写），不改动作和用户原词；开头的官方风格词或风格句同样译成中文（Live-action, cinematic 写实电影风格、2D-animated 二维动画、3D CG 三维 CG、claymation 黏土动画、watercolor 水彩、vintage film 复古胶片；The target video is in a watercolor style 译为“目标视频采用水彩风格”）';
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
const referenceFieldSchema = language => ({type:'object', additionalProperties:false, properties:Object.fromEntries(referenceFields.map(k=>[k,{type:'string',minLength:1,description:(language==='zh'?'本字段是对应英文内容的完整中文翻译。所有说明句必须是简体中文，包括主体定义、任务说明、保留规则中关系枚举后的说明和画面动作；仅素材标签、任务标记、关系枚举以及固定源视频前缀保持英文，不得整句照抄英文，也不得夹带英文单词或短语；'+zhWordRule+'。':'Write the actual H3 field content in English. Preserve source media labels and user-supplied literal dialogue.') + (k==='subject_definitions'?' Define each Subject exactly once, merging its appearance and motion sources; define the source Video separately. Describe identity and appearance only (face, hair, body, clothing, colors, materials, props), not the picture\'s pose, action or background, unless the subject is itself a place or scene. Read each picture closely: hair and headwear, facial expression, clothing and its colours, capes, marks and held items belong to the subject whose picture shows them; never an age or age group. Its noun is the user\'s own word when the user names it (<Picture 2> 中的狐狸 → <Subject 2> is the fox in <Picture 2>, even if its picture looks like a wolf); describe an ornament, crest or emblem you cannot identify by its shape, material and colour (a gold beast-head shoulder guard) rather than naming a creature. ' +(language==='zh' ? '每行写成“<Subject N> 是……”并注明来源，如“<Subject 1> 是 <Picture 1> 中的老渔夫，灰白胡须，身穿黄色雨衣。”' : 'Write each line in the official form "<Subject N> is ..." and name its source, e.g. "<Subject 1> is the old fisherman in <Picture 1>, with a grey beard and a yellow raincoat."'):k==='summary'?' Start with the task tags in brackets, e.g. [reference generation]. Then one short paragraph stating the event with <Subject N> labels: who does what, how the other reacts and how it ends. Use the labels themselves as the actors (<Subject 1> walks toward <Subject 2>), never "the woman from <Subject 1>" or "the girl in <Subject 1>". No duration or "A N-second video" wording.':k==='retention_analysis'?' One rule per defined Subject and source Video; image attributes belong to the Subject using that picture. After the relation and " - ", list the concrete kept features.':k==='detailed_description'?' Open with the style sentence The target video is in a ... style, naming the style the pictures show. Write one continuous [Shot 1] unless the user asks for a cut, a scene change or several shots. ' + (language==='zh' ? '与英文逐句对应。Each shot gives its composition and shot size, the setting and its light, where each subject starts in the frame and its key look at its first appearance, the actions in order, its camera and the sound each action makes, in complete sentences. ' : 'Normally 350-500 English words for a generation task (aim for about 400), even for one shot, in flowing present-tense prose. Each shot gives its composition and shot size, the setting and its light (3-4 sentences); each subject at its first appearance, where it stands and faces and its look as its picture shows: hair, face and expression, clothing and colours, what it holds (3-4 sentences each); the actions in the user\'s order, each with how it starts, develops and ends, the other subject\'s reaction and the secondary motion of hair, cloth and props (8-12 sentences), and before a two-handed action where each held object goes; one camera sentence as the action begins; and the sounds of the actions (2-3 sentences). ') + 'Name every defined subject with its <Subject N> label: characters and objects as the actor of their first action (never "the woman from <Subject 1>"), a place subject as the setting (e.g. "inside <Subject 3>"), a style subject in the opening style sentence (e.g. "in the art style of <Subject 2>"). State the camera of each shot: locked, or its movement, direction and speed.':k==='overall_soundscape'?' The ambience the shown setting really has and the sounds of the visible actions in the order they happen, each named directly with its source (never "can be heard"); N/A only when the user explicitly asks for silence. Never an empty string.':k==='non_diegetic_music'?' Fitting background music by default: instrumentation, tempo, rhythm and dynamics shaped to the action, no mood words; the user\'s own music request wins; N/A only when the user asks for silence or no music. Never an empty string.':'')}])), required:referenceFields});
const referenceEditPolicySchema = {type:'object',additionalProperties:false,properties:{preserveBackground:{type:'boolean'},preserveMotion:{type:'boolean'},sameShapeAppearanceOnly:{type:'boolean'}},required:['preserveBackground','preserveMotion','sameShapeAppearanceOnly']};
const referenceResultSchema = {type:'object', additionalProperties:false, properties:{modelPrompt:referenceFieldSchema('en'),displayPrompt:referenceFieldSchema('zh'),editPolicy:referenceEditPolicySchema},required:['modelPrompt','displayPrompt','editPolicy']};
// A writer's 多参 narrative comes in parts, so its length follows from the structure the official 350-500 words need (a word target
// alone gave 180-270 words, live); validateReferenceResult joins the parts into the official prose. A translation keeps the prose field.
const narrativeSchema = zh => {
  const text = (en, cn = '') => ({type:'string', description:zh ? '对应英文部分的简体中文翻译。' + cn : en});
  const list = (items, en) => ({type:'array', items, description:zh ? '与英文逐条对应。' : en});
  const object = (properties, description) => ({type:'object', additionalProperties:false, properties, required:Object.keys(properties), ...(description ? {description} : {})});
  return object({
    style: text('The official style sentence with its light, naming the style the pictures show with a concrete style word, e.g. The target video is in an anime style with bright daylight.'),
    shots: list(object({
      opening: object({
        frame: text('Starts with its marker, [Shot 1], or for a cut the user asks for its marker, time and the size it cuts to (e.g. [Shot 2] At 00:03.000, the shot cuts to a medium close-up of both), then the composition and shot size in one sentence. A later shot keeps the place, light and clothing and opens on the action still in progress at the cut.', '[Shot N] 与 At 时间原样保留，其后写中文，如 [Shot 2] At 00:03.000 镜头切到两人的近景。'),
        setting: text('One full sentence with a verb: the shared setting with two or three concrete set-dressing details that fit the pictures\' world, e.g. Weathered stone tiles cover the courtyard and red lanterns hang from the eaves; empty in a later shot, which never repeats it.'),
        light: text('One sentence: the light, its direction and the atmosphere (air, dust, leaves, mist); empty in a later shot.')
      }),
      subjects: list(object({
        place: text('One sentence that starts with its <Subject N> label: where it stands in the frame, which way it faces and its pose.'),
        head: text('One sentence that starts with His, Her or Its and describes the hair or headwear, face and expression as they look (read from its own picture; never name the picture).'),
        outfit: text('One sentence that starts with His, Her or Its and describes the clothing, armour, cape or body with colours and materials (read from its own picture; never name the picture).'),
        hands: text('One sentence: what each hand or paw holds or does, as its own picture shows (for a subject without hands, what its body, tail or wings do).')
      }), 'Each subject at its first appearance, one entry per subject; empty in later shots.'),
      camera: text('One sentence in official camera words for the whole shot, set before its beats: how the camera moves (or holds) as the action begins, following the direction of the main action, e.g. The camera pulls out at slow speed as <Subject 1> starts toward it; The camera arcs left around both at slow speed; a static shot only when the user asks for a still camera.'),
      beats: list({type:'string'}, 'The user\'s actions in the user\'s order as 4-6 beats in the shot that carries the main action (2-4 in a short later shot): split each requested action into how it starts, develops and ends, give the other subject\'s reaction its own beat, and let the setting answer (a gust lifts the cape, dust slides from the rock); the ending part gives the final pose. Each beat is two present-tense sentences (about 30-40 words) with a new visible change: the actor named by its label or, when clear, by a pronoun, how it starts from the state the previous beat left (position, pose, what each hand holds, gaze) and how it ends, the other subject\'s reaction and expression, the secondary motion of hair, cloth and props, and the sound it makes in the same sentence (her footsteps crunch on the gravel as she walks). Before a two-handed gesture, one beat first puts each held object away: tucked under an arm (a spear, a staff, a scroll), hung at the belt or sheathed (only a sword or knife); an object is planted upright only in soil, sand or snow and is then taken back before the subject moves on. A beat never only says that something remains, stays, continues or is maintained, and names no camera or time.'),
      ending: text('One or two sentences: where each subject ends, its pose, expression and what it holds, as the result of the last beat (never that it remains, stays or keeps a state).')
    }), 'One entry per shot: a single [Shot 1] unless the user asks for a cut, a scene change or several shots; the actions after a cut belong to its later shot. The program joins the parts in order into the official prose of 350-500 English words.')
  }, zh ? '与英文逐部分、逐条对应的简体中文翻译；' + zhWordRule + '；[Shot N]、At 时间与 <Subject N> 等标签原样保留。' : '');
};
const withNarrative = (schema, zh) => ({...schema, properties:{...schema.properties, detailed_description:narrativeSchema(zh)}});
const referenceWriterSchema = {...referenceResultSchema, properties:{...referenceResultSchema.properties, modelPrompt:withNarrative(referenceFieldSchema('en'), false), displayPrompt:withNarrative(referenceFieldSchema('zh'), true)}};
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
  fields.subject_definitions = [...definitions].map(([label,description])=>label+(/^[:：]/.test(description) ? ': '+description.replace(/^[:：]\s*/, '') : ' '+description)).join('\n');
  fields.retention_analysis = retention;
  return fields;
}
// The user's own words: the source prompt plus the requirement tail after it.
const requirementTail = (options = {}) => (String(options.requirements || '').split(/Source prompt:\n/)[1] || '').slice(String(options.currentPrompt || '').length);
function userIntent(options = {}) {
  return String(options.currentPrompt || '') + '\n' + requirementTail(options);
}
const loopRequested = intent => new RegExp(policy.loopPattern, 'i').test(intent) && !new RegExp(policy.cancelLoopPattern, 'i').test(intent);
const loopClosure = {en:'It ends by returning smoothly to the starting pose and motion phase so the loop joins naturally.', zh:'结束时平滑回到起始姿态与运动相位，使循环自然衔接。'};
const cameraPattern = /镜头|相机|摄像|机位|运镜|跟拍|航拍|俯拍|仰拍|\bcamera\b|\bzoom\b|\bdolly\b|\bpanning\b|\bpans?\b|\btracking\b|\bpush(?:es)?[- ]in\b|\b(?:static|medium|wide|close-up|two)[- ]?shot\b/i;
// A subject looking at the lens (看向镜头, 回头看镜头, 直视镜头, 站在镜头前, waves toward the camera) names no camera behaviour; 镜头前推 / 前移 does.
const namesCamera = text => cameraPattern.test(String(text).replace(/(?:[看望面朝]?向|朝|对着?|[看望视])镜头|镜头前(?![推移进压拉])|\b(?:at|to|toward|towards|into|facing|faces|face)\s+the\s+(?:camera|lens)\b/gi, ''));
// A cut, a scene change or several shots in the user's own words (the local optimizer's asks_cut); a refused cut (不要切镜, no cuts) is none.
const cutAsked = text => /切(?![开菜断割片成碎块肉丝丁])|转场|分镜|(?:[两二三四五多2-5]个|第[二三四五2-5]个?)镜头|多镜头|场景切换|换(?:个|一个)?场景|\[Shot (?:[2-9]|[1-9]\d)\]|【镜头\s*[2-9]】|\bcuts?\b|\bscene change\b|\b(?:two|three|several|multiple|[2-9])\s+shots\b/i
  .test(String(text).replace(/(?:不要|不用|不需要|无需|不必|请勿|勿|不能|不得|别|禁止|避免|没有)[^，。,；;\n]{0,6}?(?:切|转场|分镜|镜头|场景)[^，。,；;\n]*|不(?:再|做|去)?(?:切|转场|分镜|换场景)[^，。,；;\n]*|\b(?:no|not|don[’']t|do not|never|without)\b[^.,;\n]{0,16}?\b(?:cuts?|cutting|shots?|scene changes?)\b[^.,;\n]*/gi, ''));
// A cut time written just before its marker belongs to that marker, with its cut verb:
// "… At 00:03.000 the shot cuts to [Shot 2] a close-up …" → "[Shot 2] At 00:03.000, the shot cuts to a close-up …" (also 00:03.000 时画面切至 [Shot 2]).
// A timed cut written inside a shot with no marker at all ("… her dress. At 00:04.000, the camera cuts to a close-up …") starts its own shot.
const cutClause = /(?:[Tt]he )?(?:shot|camera|view|scene) (?:cuts?|switches|transitions)\b|(?:镜头|画面)(?:切至|切到|切换)/;
// A pure cut to a shot, with nothing else in its sentence: the shot cuts to a close-up of her face; 镜头切到她的脸. A content change
// (the camera switches to slow motion as she crosses the line, 画面切换为夜晚, the scene transitions from day to night) is no cut.
const cutTarget = /(?=(?:an?|the|her|his|its|their|both)\s|<(?:Subject|Picture) \d+>|(?:(?:extreme|medium)[ -])?close[ -]?up|(?:medium|wide|full|long)[ -]shot)/.source;
const pureCut = new RegExp(/(?:[Tt]he )?(?:shot|camera|view|scene) (?:cuts?|switches|transitions) to /.source + cutTarget + /(?:(?!\s(?:as|while|when|then|before|after|until|so|but|where|which)\b|\sand\s+(?:she|he|it|they|<Subject))[^.。!?！？\[\n,;:，；：])+|(?:镜头|画面)(?:切至|切到|切换到|切换至)[^.。!?！？\[\n,;:，；：]+/.source);
const cutMarker = /\[Shot (?:[2-9]|[1-9]\d+)\] At \d{2}:\d{2}\.\d{3}/;
const cutTimesToMarkers = (text, drop) => {
  // A camera cut announced right before its own marker ("At the three-second mark the shot cuts to a close-up. [Shot 2] At 00:03.000, …")
  // is one cut. When the marker restates it (its text opens with a cut or a shot size) a writer's announcement goes, and so does a camera
  // sentence's closing "…, then cuts to a medium close-up" / "，第三秒切至近景"; otherwise the announced cut moves into the marker. Only a
  // pure cut counts; an action (the chef cuts a slice, 她切换频道) stays. The user's own words (no drop) are never dropped, at most moved.
  const restates = new RegExp('^[ \\t]*(?:时|秒)?[ \\t]*[,，]?[ \\t]*(?:' + cutClause.source + '|(?:(?:an?|the) )?(?:' + enSize.source + ')|' + sizeWords + ')', 'i');
  const restatedAfter = (whole, end) => (m => Boolean(m) && restates.test(whole.slice(end + m[0].length)))(new RegExp('^[.。!?！？]\\s*' + cutMarker.source).exec(whole.slice(end)));
  const marked = String(text).replace(new RegExp(/((?:^|[。!?！？\]]\s*|\.(?!\d)\s*)(?:[Tt]he camera|镜头|画面)[^.。!?！？\[\n]*?)[ \t]*[,，][ \t]*(?:(?:and )?then |and |随后|然后|接着|再)?/.source
    + /(?:(?:at|in) [^,.。!?！？\[\n]{0,30}?(?:mark|seconds?),?[ \t]*|在?(?:第[^，。！？\n]{1,6}秒|\d{2}:\d{2}\.\d{3})[ \t]*时?[ \t]*)?/.source
    + '(?:' + /(?:the (?:shot|camera) )?(?:cuts?|switches|transitions) to /.source + cutTarget + /[^.。!?！？\[\n]+|(?:镜头|画面)?(?:切至|切到|切换到|切换至)[^。！？\[\n]+/.source + ')'
    + '(?=[.。!?！？]\\s*' + cutMarker.source + ')', 'g'), (all, head, offset, whole) => drop && restatedAfter(whole, offset + all.length) ? head : all)
    .replace(new RegExp(/(^|[。!?！？]\s*|\.(?!\d)\s*)(?:(?:At|In|at|in) [^.。!?！？\[\n]{0,30}?(?:mark|seconds?|\d{2}:\d{2}\.\d{3}),?\s+|(?:在[ \t]*)?(?:第[^，。！？\n]{1,6}秒|\d{2}:\d{2}\.\d{3})[ \t]*(?:时|秒)?[ \t]*[,，]?[ \t]*)?(?:[Tt]hen,? |随后|然后|接着)?/.source
    + '(' + pureCut.source + ')([.。!?！？])\\s*(' + cutMarker.source + ')' + /([ \t]*(?:时|秒)?[ \t]*[,，]?[ \t]*)([a-z]?)/.source, 'g'),
    (all, lead, cut, stop, marker, gap, next, offset, whole) => restates.test(next + whole.slice(offset + all.length)) ? (drop ? lead + marker + gap + next : all)
      : hanPattern.test(proseOf(cut)) ? lead + marker + ' ' + cut + stop + next : lead + marker + ', ' + cut.charAt(0).toLowerCase() + cut.slice(1) + stop + ' ' + next.toUpperCase()).replace(/(?:\bAt |在)?(\d{2}:\d{2}\.\d{3})[ \t]*(?:时|秒)?[ \t]*[,，]?[ \t]*((?:the (?:shot|camera|view|scene) )?(?:cuts?|switches|transitions|changes)(?: to)?|(?:画面|镜头)?(?:切至|切到|切换到|切换至|切换|切))?\s*(\[Shot (?:[2-9]|[1-9]\d+)\])(?! At \d)[ \t]*/g,
    (_, time, verb, shot) => shot + ' At ' + time + (verb ? (hanPattern.test(verb) ? ' ' + verb : ', ' + verb + ' ') : ' '))
    .replace(/([.。!?！？;；])[ \t]*(?:At |在[ \t]*)?(\d{2}:\d{2}\.\d{3})(?=[ \t]*(?:时|秒)?[ \t]*[,，]?[ \t]*(?:(?:the (?:shot|camera|view|scene) )?(?:cuts?|switches|transitions)\b|(?:画面|镜头)?切))/g, '$1\n[Shot 0] At $2');
  // Renumber in order; text before the first new marker is [Shot 1] even when it has no marker yet.
  let n = /\[Shot (\d+)\]/.exec(marked)?.[1] === '0' ? 1 : 0;
  return marked.includes('[Shot 0]') ? marked.replace(/\[Shot \d+\]/g, () => '[Shot ' + ++n + ']') : marked;
};
// MM:SS.mmm for a cut time in seconds.
const shotStamp = s => { const ms = Math.round(s * 1000); return String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + '.' + String(ms % 1000).padStart(3, '0'); };
// A writer's structured narrative (referenceWriterSchema) reads as the official prose: its parts joined in order, one line per shot.
// Both halves drop the same parts, decided on the English one: a beat that only restates the camera (each shot has its camera
// sentence), a cut announced inside the shot before it, and in a later shot the looks already given (only where each subject now
// stands stays) or a setting and light that only say they continue or copy an earlier shot's. The camera sentence opens the action.
function joinNarrative(value, zh, english) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const items = list => Array.isArray(list) ? list : [];
  const end = text => (line => !line || /[.!?。！？”"」』）)\]]$/.test(line) ? line : /^\[Shot [1-9]\d*\](?: At [\d:.]+)?,?$/.test(line) ? line.replace(/,$/, '') : line + (zh ? '。' : '.'))(String(text ?? '').trim());
  const join = parts => parts.map(end).filter(Boolean).join(zh ? '' : ' ');
  const cameraBeat = [/^(?:the\s+)?camera\b/i, /^(?:镜头|摄影机|摄像机|相机)/];
  const cutNote = zh ? /[^。！？]*(?:镜头|画面)(?:切出|切换|切到|切至)[^。！？]*[。！？]/g : /(?:^|(?<=[.!?]\s))(?:At [^.!?]*?,?\s*)?(?:the )?(?:shot|camera|scene|view) (?:cuts|switches|transitions)\b[^.!?]*[.!?]\s*/gi;
  const shots = items(value.shots), shotsEn = items(english?.shots);
  const words = part => String(part ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const given = (i, key) => shotsEn.slice(0, i).some(shot => words(shot?.opening?.[key]) === words(shotsEn[i]?.opening?.[key]));
  return [end(value.style), ...shots.map((shot, i) => {
    const en = shotsEn[i] || {}, later = i > 0, clean = part => i < shots.length - 1 ? String(part ?? '').replace(cutNote, '').trim() : part;
    const opening = shot?.opening && typeof shot.opening === 'object'
      ? join(['frame', 'setting', 'light'].filter(key => key === 'frame' || !later || !/\b(?:same|continues?|still|remains?)\b/i.test(String(en.opening?.[key] ?? '')) && !given(i, key)).map(key => shot.opening[key])) : shot?.opening;
    const subjects = items(shot?.subjects).map(item => typeof item === 'string' ? item : join((later ? ['place'] : ['place', 'head', 'outfit', 'hands']).map(key => item?.[key])));
    const aligned = items(shot?.beats).length === items(en.beats).length;
    const beats = items(shot?.beats).filter((beat, j) => !(aligned ? cameraBeat[0].test(String(en.beats[j]).trim()) : cameraBeat[zh ? 1 : 0].test(String(beat).trim())));
    const text = join([opening, ...subjects, clean(shot?.camera), ...beats.map(clean), clean(shot?.ending)]);
    return /^\[Shot [1-9]\d*\]/.test(text) ? text : '[Shot ' + (i + 1) + '] ' + text;
  })].filter(Boolean).join('\n');
}
const joinNarratives = pair => pair && ['modelPrompt', 'displayPrompt'].some(key => pair[key]?.detailed_description && typeof pair[key].detailed_description === 'object') ? {...pair,
  modelPrompt:{...pair.modelPrompt, detailed_description:joinNarrative(pair.modelPrompt.detailed_description, false, pair.modelPrompt.detailed_description)},
  displayPrompt:{...pair.displayPrompt, detailed_description:joinNarrative(pair.displayPrompt.detailed_description, true, pair.modelPrompt?.detailed_description)}} : pair;
function validateReferenceResult(value, options = {}) {
  const pair = joinNarratives(referenceResult(value));
  if (!pair) {
    const compiled = compileReferenceFields(value, options);
    return validateReference(typeof compiled === 'string' ? compiled : JSON.stringify(compiled), options);
  }
  const serialize = v => typeof v === 'string' ? v : JSON.stringify(v);
  let modelPrompt = validateReference(serialize(compileReferenceFields(pair.modelPrompt, {...options,requireChineseOutput:false})), {...options,requireChineseOutput:false,writerPair:!options.displayIsSource});
  // displayIsSource: the display half is the user source itself (translate-only), so its language is not gated.
  let displayPrompt = validateReference(serialize(compileReferenceFields(pair.displayPrompt, {...options,requireChineseOutput:true})), {...options,requireChineseOutput:!options.displayIsSource,writerPair:!options.displayIsSource});
  // Mirror the local compiler's defaults so a provider result is completed, not
  // rejected: a requested loop gets its closure, a generated shot its camera.
  const appendNarrative = (text, sentence) => text.replace(/(detailed_description:\n[\s\S]*?)(?=\n\noverall_soundscape:)/, m => appendSentence(m, sentence));
  const narrativeOf = text => text.split('detailed_description:')[1]?.split('overall_soundscape:')[0] || '';
  const intent = userIntent(options);
  if (loopRequested(intent) && !new RegExp(policy.closurePattern, 'i').test(narrativeOf(modelPrompt))) {
    modelPrompt = appendNarrative(modelPrompt, loopClosure.en);
    if (!new RegExp(policy.closurePattern, 'i').test(narrativeOf(displayPrompt))) displayPrompt = appendNarrative(displayPrompt, loopClosure.zh);
  }
  if (!/summary:\s*\[[^\]]*\bvideo editing\b/.test(modelPrompt) && !namesCamera(narrativeOf(modelPrompt) + intent)) {
    modelPrompt = appendNarrative(modelPrompt, baseCamera.en);
    if (!namesCamera(narrativeOf(displayPrompt))) displayPrompt = appendNarrative(displayPrompt, baseCamera.zh);
  }
  // Shot sizes follow the words (the user's in the display, the display's in English); each retention line names its shots.
  const model = referenceFieldsOf(modelPrompt), display = referenceFieldsOf(displayPrompt), own = ownWords(intent);
  // A writer's display: the program writes the common English words in Chinese and sets a swapped subject colour back.
  if (!options.displayIsSource) recolour(model.subject_definitions, referenceFields.map(key => fixDisplayWords(display[key], own)), modelPrompt).forEach((text, i) => { display[referenceFields[i]] = text; });
  for (const key of ['summary', 'detailed_description']) {
    if (!options.displayIsSource) display[key] = keepUserSize(display[key], intent);
    model[key] = matchSizes(model[key], display[key]);
  }
  if (!options.displayIsSource) for (const [fields, zh] of [[model, false], [display, true]]) markAppearances(fields, model.detailed_description, zh);
  modelPrompt = referenceTextOf(model);
  displayPrompt = referenceTextOf(display);
  // A writer's pair (strictPair, the Grok edge) gets the gates of the base pairs; a translation keeps its source as the display.
  const displayIssues = [];
  if (options.strictPair) {
    const shots = text => (text.match(/\[Shot \d+\](?: At [\d:.]+)?/g) || []).join('|');
    // Official ref guide 5.2: a generation task's detailed_description is normally 350-500 English words; clearly short is a defect.
    // Dialogue-dense content fits its spoken timeline first, and a video edit scales with its source.
    const words = (model.detailed_description.replace(/<(?:Subject|Picture|Video|Audio) \d+>|\[Shot \d+\]|\bAt \d{2}:\d{2}\.\d{3}/g, '').match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
    const short = words < referenceMinWords && spokenOf(modelPrompt).length < 40 && !/summary:\s*\[[^\]]*\bvideo (?:editing|continuation)\b/.test(modelPrompt);
    displayIssues.push(...(options.displayIsSource ? [] : [englishLeft(displayPrompt, intent) && referenceChineseIssue, coloursSwapped(model.subject_definitions, display.subject_definitions) && baseIssue.colour].filter(Boolean)));
    const gates = [shots(model.detailed_description) !== shots(display.detailed_description) && baseIssue.pairShots,
      spokenOf(modelPrompt) !== spokenOf(displayPrompt) && baseIssue.pairLiterals,
      ...(options.displayIsSource ? [] : [tagList(model.detailed_description) && baseIssue.prose,
        /^N\/A\.?$/i.test(model.overall_soundscape) && !silenceAsked(intent) && baseIssue.silence, short && baseIssue.short, cutMissing(model.detailed_description, intent) && baseIssue.cut,
        cutEmpty(model.detailed_description + '\n' + display.detailed_description) && baseIssue.cutTarget,
        heldObject(model.subject_definitions + '\n' + model.detailed_description, intent) && baseIssue.held])];
    // Display slips ride along with a content failure; alone they cost no rewrite (see the end).
    failIssues(gates.some(Boolean) ? [...gates, ...displayIssues] : []);
  }
  const narrative = model.detailed_description;
  const prose = narrative.replace(/<d>[\s\S]*?<\/d>|<(?:Picture|Video|Audio|Subject) \d+>|\[Shot \d+\]|"[^"\n]*"|“[^”\n]*”/g, '');
  const han = (prose.match(/[\u3400-\u9fff]/g)||[]).length;
  if (han > 8 && (prose.match(/[A-Za-z]{2,}/g)||[]).join('').length < han * 2) throw new Error('H3 模型侧提示词需要英文正文，中文内容仅用于编辑器显示');
  const bindings = text => [...text.matchAll(/^<(Subject|Video|Picture|Audio) ([1-9]\d*)>[^\n:]*:\s*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b/gm)].map(m=>[m[1],m[2],m[3]].join(':')).sort().join('|');
  const sources = text => text.split('summary:')[0].split('\n').filter(l=>/^<Subject \d+>/.test(l)).map(l=>[l.match(/^<Subject \d+>/)[0],...[...new Set(l.match(/<(?:Picture|Video|Audio) \d+>/g)||[])].sort()].join('|')).sort().join('\n');
  const tasks = text => /summary:\s*\[([^\]]+)\]/.exec(text)?.[1].split(/\s*\+\s*/).sort().join('|');
  if (bindings(modelPrompt) !== bindings(displayPrompt) || sources(modelPrompt) !== sources(displayPrompt) || tasks(modelPrompt) !== tasks(displayPrompt)) throw new Error('H3 中英文提示词的素材关系不一致');
  if (displayIssues.length) throw displayOnly(displayIssues, [...new Set([...displaySlips(referenceFields.map(key => display[key]), own),
    ...[...subjectLines(display.subject_definitions)].filter(([id, line]) => coloursSwapped(subjectLines(model.subject_definitions).get(id) || '', line)).map(([, line]) => line.trim())])]);
  const editPolicy = pair.editPolicy ? referenceEditPolicy(pair.editPolicy) : null;
  if (editPolicy && !/<Picture [1-9]\d*>/.test(modelPrompt)) editPolicy.sameShapeAppearanceOnly = false;
  return JSON.stringify({modelPrompt,displayPrompt,...(editPolicy ? {editPolicy} : {})});
}
// Drop the space a sentence reflow leaves after a Chinese full stop or before Chinese after a dialogue block; quoted dialogue stays verbatim.
function joinChineseSentences(text) {
  return String(text).replace(/(<d>[\s\S]*?<\/d>)[ \t]+(?=[\u3400-\u9fff])|(<d>[\s\S]*?<\/d>|“[^”]*”|"[^"\n]*")|([。！？])[ \t]+(?=\S)/gu, (all, spoken, quoted, stop) => spoken || quoted || stop);
}
// The editor shows a cut time and a spoken line the Chinese way, 【镜头 2】（第 4 秒） and (S1) 说：“出发吧。”, and every compile reads
// them back as the official [Shot 2] At 00:04.000 and <d>[Chinese] 出发吧。</d>. A line whose tag is not the one its words give
// ([Japanese]) or that holds a quote mark or a tag stays a <d> block, so the way back is exact; old displays (At 00:04.000, <d>) still read.
const spokenLead = /([(（]S[1-9]\d*(?:,\s*S[1-9]\d*)*[)）][^“”"<>\n。！？.!?]{0,40}?[：:][ \t]*)/.source;
const lineTag = words => hanPattern.test(words) ? 'Chinese' : 'English';
const shownMarks = text => text.replace(/\[Shot ([1-9]\d*)\](?: At (\d{2}):(\d{2})\.(\d{3}),?)?[ \t]*/g, (_, n, m, s, ms) => '【镜头 ' + n + '】'
  + (m == null ? '' : '（第 ' + Number((Number(m) * 60 + Number(s) + Number(ms) / 1000).toFixed(3)) + ' 秒）'))
  .replace(new RegExp(spokenLead + /<d>\[(Chinese|English)\] ([^“”"<\n]+?)<\/d>/.source, 'g'), (all, lead, tag, words) => tag === lineTag(words) ? lead + '“' + words + '”' : all);
const readMarks = text => text.replace(/【镜头\s*([1-9]\d*)】[ \t]*(?:[（(][ \t]*第?[ \t]*(\d+(?:\.\d+)?)[ \t]*秒[ \t]*(?:时|处)?[ \t]*[）)][ \t]*)?(?=(\S?))/g,
  (_, n, seconds, next) => '[Shot ' + n + ']' + (seconds ? ' At ' + shotStamp(Number(seconds)) : '') + (next && !/[,，、)）]/.test(next) ? ' ' : ''))
  .replace(new RegExp(spokenLead + /[“"]([^“”"<\n]+)[”"]/.source, 'g'), (_, lead, words) => lead + '<d>[' + lineTag(words) + '] ' + words + '</d>');
const referenceDisplayFields = ['主体定义', '任务说明', '保留规则', '画面与动作', '环境声音', '背景音乐'];
const referenceDisplayTerms = {
  'reference generation': '参考生成', 'keyframe completion': '关键帧补全', 'video editing': '视频编辑',
  'video continuation': '视频续写', 'audio reuse': '音频复用', 'audio reference': '音频参考',
  fully_preserved: '完全保留', partially_preserved: '部分保留', attribute_transfer: '属性迁移', weak_reference: '弱参考',
  fully_copy: '完整复用', partially_copy: '部分复用', reference: '参考',
};
function toReferenceDisplay(value) {
  let text = String(value || '').replace(/\r\n/g, '\n');
  // Each section starts right under its heading, whether its value began on the field line or the next one.
  referenceFields.forEach((field, i) => { text = text.replace(new RegExp('^' + field + ':[ \\t]*\\n?', 'gm'), '【' + referenceDisplayFields[i] + '】\n'); });
  // 【镜头 1】 is followed directly by its text, a cut time reads （第 4 秒）; a
  // definition ends its sentence before 素材来源 instead of a bare space.
  text = shownMarks(text.replace(/<Subject ([1-9]\d*)>/g, '<主体 $1>'))
    .replace(/The target video is an edited version of (<Video [1-9]\d*>|@视频参考)\./g, '输出视频由 $1 编辑而成。')
    .replace(/Source assets:/g, '素材来源：').replace(/([^\s。！？；;，,：:、.!?])[ \t]+素材来源：/g, '$1。素材来源：').replace(/The shot shows (<主体 [1-9]\d*>)\./g, '画面中呈现 $1。').replace(/The shot features ((?:<主体 [1-9]\d*>(?:, | and )?)+)\./g, (_, list) => '画面中有 ' + list.replace(/, | and /g, '、') + '。')
    .replace(/^(<主体 [1-9]\d*>) is /gm, '$1：').replace(/^(<主体 [1-9]\d*>) appearance from ([^\n:：]+?)\s*[:：]\s*/gm, (_, subject, from) => subject + '：外观来自 ' + from.trim().replace(/\s*(?:,|\band\b)\s*/g, '、') + '，').replace(/^N\/A\.?$/gm, '无');
  text = text.replace(/\[([^\]\n]+)\]/g, (all, terms) => terms.split(/\s*\+\s*/).every(t => referenceDisplayTerms[t]) ? '[' + terms.split(/\s*\+\s*/).map(t => referenceDisplayTerms[t]).join(' + ') + ']' : all);
  // Chinese sentences follow each other without a space; in 画面与动作 each subject's sentence and each later shot starts a line.
  text = joinChineseSentences(text)
    .replace(/(^【画面与动作】\n)([\s\S]*?)(?=\n【(?:环境声音|背景音乐)】|$(?![\s\S]))/m, (_, head, body) => head + body.replace(/([。！？])(?=<主体 [1-9]\d*>)/g, '$1\n').replace(/\s*(【镜头 (?:[2-9]|[1-9]\d+)】)/g, '\n$1'));
  return text.replace(/:\s*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b/g, (_, term) => ': ' + referenceDisplayTerms[term]);
}
function fromReferenceDisplay(value) {
  let text = String(value || '').replace(/\r\n/g, '\n');
  if (!/^【主体定义】/m.test(text)) return text;
  referenceDisplayFields.forEach((field, i) => { text = text.replace(new RegExp('^【' + field + '】[ \\t]*', 'gm'), referenceFields[i] + ':\n'); });
  const reverse = Object.fromEntries(Object.entries(referenceDisplayTerms).map(([key, val]) => [val, key]));
  text = readMarks(text.replace(/<主体 ([1-9]\d*)>/g, '<Subject $1>'))
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
      if (words.length >= 8 && words.join('').length > han * 2) throw new Error(referenceChineseIssue);
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
  // Without a source video the task can only be reference generation; a
  // missing [task] prefix is filled in from the uploads below instead of failing.
  const inferTasks = !task && inventory && !media(inventory[1]).some(t => t.startsWith('<Video '));
  if (!inferTasks && (!tasks.length || tasks.some(t => !['reference generation','keyframe completion','video editing','video continuation','audio reuse','audio reference'].includes(t)))) throw new Error('H3 多参缺少明确任务关系');
  if (inventory) {
    // The uploads decide the task list: no video means nothing to edit or
    // continue, no audio means no audio task. Trim the guess instead of failing.
    const reconciled = reconcileReferenceTasks(tasks, media(inventory[1]));
    if (reconciled.join(' + ') !== tasks.join(' + ')) {
      tasks = reconciled;
      fields.summary = '[' + tasks.join(' + ') + ']' + (task ? fields.summary.slice(task[0].length) : ' ' + fields.summary);
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
  // A single explicitly defined subject is unambiguous, and so is generation
  // without a source video, where every defined subject is visible content.
  // State that the shot shows it without changing appearance or action.
  const unbound = ids.filter(id => !fields.detailed_description.includes('<Subject ' + id + '>'));
  if (unbound.length && (ids.length === 1 || !tasks.some(t => t.startsWith('video ')))) {
    const names = unbound.map(id => '<Subject ' + id + '>');
    fields.detailed_description = fields.detailed_description.replace('[Shot 1]', '[Shot 1] The shot features ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + '.');
  }
  if (ids.some(id => !fields.detailed_description.includes('<Subject ' + id + '>'))) throw new Error('H3 多参镜头必须引用已定义主体');
  if (!fields.detailed_description.includes('[Shot 1]')) throw new Error('H3 多参缺少镜头描述');
  // "In a watercolor style, [Shot 1] ..." (or no stop at all) leaves the style sentence unfinished.
  fields.detailed_description = fields.detailed_description.replace(/([^\s.。!?！？,，])\s*[,，]?\s*(\[Shot 1\])/, (_, last, shot) => last + (/[\u3400-\u9fff]/.test(last) ? '。' : '.') + ' ' + shot);
  fields.detailed_description = cutTimesToMarkers(fields.detailed_description, options.writerPair);
  // Later shots need a cut time. When the model gives none, space the cuts the user asked for evenly; a later shot
  // the user never asked for (a writer splitting the beats of one action) continues the shot before it.
  const shotCount = (fields.detailed_description.match(/\[Shot [1-9]\d*\]/g) || []).length;
  if (shotCount > 1 && !/\[Shot \d+\] At \d/.test(fields.detailed_description)) {
    fields.detailed_description = !options.displayIsSource && !cutAsked(userIntent(options))
      ? fields.detailed_description.replace(/(\S?)\s*\[Shot (?:[2-9]|[1-9]\d+)\]\s*/g, (_, last) => last + (!last || /[\u3400-\u9fff。！？，；：]/.test(last) ? '' : ' '))
      : fields.detailed_description.replace(/\[Shot ([2-9]|[1-9]\d+)\]/g, (tag, n) => tag + ' At ' + shotStamp(Number(options.durationSeconds || 30) * (n - 1) / shotCount));
  }
  let cutAt = 0;
  for (const m of fields.detailed_description.matchAll(/\[Shot \d+\] At (\d+):(\d+)\.(\d+)/g)) {
    const at = Number(m[1])*60 + Number(m[2]) + Number('0.'+m[3]);
    if (at > Number(options.durationSeconds || 30)) throw new Error('H3 多参镜头超出所选时长');
    if (at <= cutAt) throw new Error(baseIssue.shotTime);
    cutAt = at;
  }
  // The English half (a Chinese name may appear in it) reads like the official guide: one line per shot, "<Subject N> is ..." definitions.
  // Its language is read from the prose alone: <Subject N>, [Shot N] and At times are not English words.
  const prose = proseOf(fields.detailed_description).replace(/<(?:Subject|Picture|Video|Audio) \d+>|\[Shot \d+\]|\bAt \d{2}:\d{2}\.\d{3}/g, '');
  if (!options.requireChineseOutput && (prose.match(/[A-Za-z]/g) || []).length > (prose.match(/[\u3400-\u9fff]/g) || []).length * 2) {
    // The official style opening: "In a watercolor style." reads "The target video is in a watercolor style."
    fields.detailed_description = officialEnglish(fields.detailed_description.replace(/^In (an? [^.\n[]*?\bstyle\b[^.\n[]*?)\.\s*(?=\[Shot 1\])/, 'The target video is in $1. '))
      .replace(/\s*\n\s*\n\s*(?=\[Shot )/g, '\n').replace(/[ \t]*\n\s*\n\s*/g, ' ');
    fields.subject_definitions = fields.subject_definitions.replace(/^(<Subject [1-9]\d*>(?: \(S\d+\))?)[ \t]*[：:][ \t]*(?:(An?|The|an?|the) )?(?=(.))/gm,
      (_, id, article, next) => id + ' is ' + (article ? article.toLowerCase() + ' ' : /[a-z]/.test(next) ? 'the ' : ''));
  }
  return referenceFields.map(k => k + ':\n' + fields[k]).join('\n\n');
}
const baseIssue = {
  sections: 'H3 提示词需要画面与动作、环境声音和背景音乐三个字段',
  shotOrder: 'H3 镜头编号必须从 [Shot 1] 起连续递增',
  shotTime: 'H3 镜头切换时间必须严格递增且在所选时长内',
  subject: 'H3 文生、图生和首尾帧提示词不能使用 <Subject N> 主体标签',
  chinese: '请将画面与动作、环境声音和背景音乐改为简体中文，保留原台词和媒体标签',
  english: 'H3 中文显示稿夹带英文单词，请译为简体中文，仅台词、屏幕文字和媒体标签保持原样',
  pairShots: 'H3 中英文提示词的镜头或切换时间不一致',
  pairLiterals: 'H3 中英文提示词的台词或屏幕文字不一致',
  pairCoverage: 'H3 英文提示词遗漏了中文内容，请逐句完整翻译每个镜头',
  silence: 'H3 环境声音只有用户要求静音时才能写 N/A，请写出与画面一致的具体环境声和动作声',
  prose: 'H3 英文提示词需要完整句子，不能用逗号堆叠标签',
  colour: 'H3 中文显示稿的颜色与英文不一致，请逐词准确翻译颜色',
  short: 'H3 多参画面与动作过短，请按官方指南写到 350-500 个英文单词',
  offFrame: 'H3 动作去往画面外的物体，但镜头或方向与之矛盾，请让镜头随主体移向它',
  pose: 'H3 画面中的姿态没有动作过渡（如落地后直接坐着、爪子未抬起就被舔），请补上这一步动作',
  held: 'H3 双手动作前手里仍握着物品，请先交代物品放到哪里',
  cut: 'H3 用户要求的切镜没有写成单独的镜头，请在要求的时间写出 [Shot N]',
  cutTarget: 'H3 切镜没有写出切到的画面，请写明切到的景别和主体',
};
// Short: under 280 words, 80% of the official 350 (the structured first answers measure about 250-470 words; a repair asks for the rest).
const referenceMinWords = 280;
const referenceChineseIssue = '请将多参主体、任务说明、保留规则和画面动作改为简体中文，保留原台词和媒体标签';
// Only return application-owned messages. Provider text must never become a
// diagnostic or a repair instruction, even when it resembles an error message.
const validationIssues = [
  ['sections', [baseIssue.sections, baseIssue.silence, baseIssue.short, baseIssue.offFrame, baseIssue.pose, baseIssue.held, baseIssue.cut, baseIssue.cutTarget]],
  ['timeline', [baseIssue.shotOrder, baseIssue.shotTime, baseIssue.pairShots]],
  ['references', [baseIssue.subject]],
  ['language', [baseIssue.chinese, baseIssue.english, baseIssue.pairCoverage, baseIssue.prose, baseIssue.colour]],
  ['dialogue', [baseIssue.pairLiterals]],
  ['language', [referenceChineseIssue]],
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

// Parses the five sections from text or JSON; shared by the validator and the legacy converter.
function parseFormat(value) {
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
  return {text, sections};
}
const legacyDurationPattern = /(?:时长\s*[:：]?\s*|duration\s*[:：]?\s*|lasts?\s+)?(\d+(?:\.\d+)?)\s*(?:秒|s\b|seconds?\b)/i;
function validateFormat(value, options = {}) {
  const {text, sections} = parseFormat(value);
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
  const taskDuration = legacyDurationPattern.exec(sections[0]);
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
// Verified fact slots of a reverse narrative: per-frame group headings and slot labels.
const legacyFactHeading = '<Picture [12]>(?: (?:\\+|与|and) <Picture [12]>)?(?: (?:共同|首帧|尾帧|shared|opening frame|ending frame))?[:：]';
const legacyFactLabel = '(?:主体\\d+|关系|场景|画面|光色材质|敏感可见事实|类型|可见人物)[：:]|(?:Subject \\d+|Relations|Scene|Framing|Look|Visible sensitive facts|Type|Visible people):';
// The prompt workflow reflows a legacy narrative into long space-joined paragraphs. Put each fact slot
// back on its own line (one line per slot inside a frame group, one paragraph per slot otherwise),
// start the text after the facts on a new paragraph, and join Chinese sentences without spaces.
function relayoutLegacyFacts(visual) {
  const grouped = new RegExp(legacyFactHeading, 'u').test(visual);
  return joinChineseSentences(String(visual)
    .replace(new RegExp(`[ \\t]*\\n*[ \\t]*(${legacyFactHeading})\\s*`, 'gu'), '\n\n$1\n')
    .replace(new RegExp(`(。|\\.(?=[ \\t\\n]))[ \\t]*\\n?[ \\t]*(?=${legacyFactLabel})`, 'gu'), grouped ? '$1\n' : '$1\n\n')
    .replace(new RegExp(`(^|\\n)((?:${legacyFactLabel})[^\\n]*?(?:。|\\.(?=[ \\t\\n])))[ \\t]*\\n?[ \\t]*(?=[^\\s<])(?!${legacyFactLabel})`, 'gu'), '$1$2\n\n'))
    .replace(/\n{3,}/g, '\n\n').trim();
}
// Presentation only: call after the legacy visual-fact and H3 protocol gates.
// Keep all validated narrative and audio values; never run a second model pass.
function fromValidatedLegacy(text, options = {}) {
  if (String(text).trim().startsWith('【任务定位】')) return validateFormat(text, options);
  const fields = [...String(text).matchAll(/^(integrated_multimodal_description|overall_soundscape|non_diegetic_music)\s*:\s*/gm)];
  if (fields.length !== 3) throw new Error('反推结果缺少已验证的 H3 字段');
  const values = Object.fromEntries(fields.map((m,i)=>[m[1],String(text).slice(m.index+m[0].length,fields[i+1]?.index ?? text.length).trim()]));
  const visual=relayoutLegacyFacts(values.integrated_multimodal_description);
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
    // Static fact paragraphs (subjects, relations, scene, framing, look and per-frame fact groups) stay in the overall description only.
    const staticFact=new RegExp(`^(?:${legacyFactHeading}|${legacyFactLabel})`, 'u');
    const joinSentences=(a,b)=>a+(a && !/[。！？]$/u.test(a)?' ':'')+b;
    const motion=simpleUserMotion || paragraphs.slice(1).filter(p=>!staticFact.test(p) && !/^到 \d.*秒|^By \d|^镜头保持固定|^The camera holds/u.test(p)).reduce(joinSentences,'') || '动作从首帧姿态轻缓开始，以小幅、连续的姿态变化自然推进。';
    const finalAction=simpleUserMotion.match(/(?:最后|最终|结束时)[^。.!]+[。.!]?/u)?.[0] || '延续上述状态和构图，结束片段。';
    phases=[
      `${edges[0]}-${edges[1]}s：以 <Picture 1> 为起始帧，开始执行上述动作，保持原文指定的身份和构图。`,
      `${edges[1]}-${edges[2]}s：${speech.length?joinSentences(motion,'同步完成上述台词与口型。'):motion}`,
      `${edges[2]}-${edges[3]}s：${fl2v?'收束至 <Picture 2> 的结束姿态和构图。':finalAction}`
    ];
  }
  const overall=visual.replace(/\[Shot \d+\](?:\s+At\s+\d{2}:\d{2}\.\d{3},?)?/g,'').trim();
  return validateFormat(JSON.stringify({task,speakers:definitions,description:overall+'\n\n'+phases.join('\n\n'),dialogue,constraints:`1. 保持上述人物身份、参考帧绑定及原文明确的约束。\n2. 环境与动作声音：${values.overall_soundscape}\n3. 配乐：${values.non_diegetic_music}`}),options);
}
// Base modes (text_video / image_video / first_last) use the official three fields for H3
// and the 多参 labels in the editor: 【参考帧对齐】【画面与动作】(【镜头 N】)【环境声音】【背景音乐】.
const baseFields = ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music'];
const baseDisplayFields = ['参考帧对齐', '画面与动作', '环境声音', '背景音乐'];
const baseInstruction = policy.baseInstructions.join('\n');
const baseResultInstruction = 'Return a bilingual object with modelPrompt and displayPrompt. Both contain the same three H3 fields integrated_multimodal_description, overall_soundscape and non_diegetic_music, without the reference-alignment line. modelPrompt has English prose for H3; Chinese appears only inside <d>...</d> and double-quoted on-screen text. displayPrompt is its faithful Simplified Chinese translation for the editor. Keep every [Shot N] marker and At MM:SS.mmm time, <Picture N> tag, speaker ID, <d> block and quoted text identical in both. Do not add creative changes while translating.';
const baseTranslateInstruction = 'Translate only. The source prompt is a finished Simplified Chinese H3 prompt in the three fields integrated_multimodal_description, overall_soundscape and non_diegetic_music. Return modelPrompt as its faithful English translation and displayPrompt as the unchanged Chinese source. Keep the same shots, [Shot N] markers and At MM:SS.mmm times, <Picture N> tags, speaker IDs such as (S1), every <d>...</d> block and every double-quoted on-screen text exactly as written; N/A stays N/A. Where the Chinese names a camera move, use the official camera vocabulary: push in, pull out, pan, truck, tilt, pedestal, arc shot, tracking shot, static shot, zoom, shake, POV or roll, with small/large amplitude and at slow/fast speed. ' + shotSizeRule + ' Add, remove, reorder or improve nothing, and do not write the reference-alignment line.';
const baseFieldNotes = {
  en: ['English, in complete present-tense sentences, never a comma list of tags; about 110-170 words for five seconds and about 25 more per further second. Starts with [Shot 1] and an opening that sets up the scene: the official style word, a comma and the initial composition with its shot size (with an opening frame no shot size: the subject as shown in <Picture 1>), the subject\'s look, pose and place, the setting and the light, before the first action begins; the camera sentence as the second sentence, joined to the first action, a gentle move unless the user asks for a still camera or a final frame shares the opening framing; then the user\'s actions in order, each continuing from the state the one before left and enriched with the expression, secondary motion and atmosphere that serve it, and a clear ending state (with a final frame, exactly the state <Picture 2> shows). Later shots only for a requested cut: [Shot N] At MM:SS.mmm, the camera cuts to the size and subject of the new shot (e.g. [Shot 2] At 00:03.000, the camera cuts to a close-up of her face). Dialogue as (S1) says: <d>[Language] verbatim words</d> at the moment it is spoken; on-screen text verbatim in double quotes. Only the supplied <Picture N> tags, never <Subject N>.',
    '1-4 English sentences of the ambience the shown setting really has and the sounds of the visible actions in the order they happen, each named directly with its source, no dialogue and no description of what is seen. N/A only when the user asks for silence. Never an empty string.',
    'Fitting background music by default: 1-3 English sentences on instrumentation, tempo, rhythm and dynamics shaped to the action, no mood words. The user\'s own music request wins; N/A only when the user asks for silence or no music. Never an empty string.'],
  zh: '本字段是对应英文内容的完整简体中文翻译，说明句全部使用简体中文，' + zhWordRule + '；[Shot N]、At 时间、<Picture N>、(S1)、<d>…</d> 与引号内文字和英文完全一致，N/A 保持 N/A。',
};
const baseFieldSchema = language => ({type:'object', additionalProperties:false, properties:Object.fromEntries(baseFields.map((k, i) => [k, {type:'string', minLength:1, description:language === 'zh' ? baseFieldNotes.zh : baseFieldNotes.en[i]}])), required:baseFields});
const baseResultSchema = {type:'object', additionalProperties:false, properties:{modelPrompt:baseFieldSchema('en'), displayPrompt:baseFieldSchema('zh')}, required:['modelPrompt','displayPrompt']};
const baseAnchors = {
  open: {en:'The shot begins in the position and framing established by <Picture 1>.', zh:'画面从 <Picture 1> 的位置与构图开始。'},
  close: {en:'At the end of the shot, the action settles into the pose, spacing, and composition established by <Picture 2>.', zh:'结尾时，动作落定在 <Picture 2> 的姿态、位置与构图。'},
};
const baseCamera = {en:'The camera holds a static shot and the framing stays stable.', zh:'镜头固定，构图保持稳定。'};
const hanPattern = /[\u3400-\u9fff]/;
// Dialogue blocks and quoted on-screen text stay verbatim in every language.
const literalSplit = /(<d>[\s\S]*?<\/d>|"[^"\n]*"|“[^”\n]*”)/;
const outsideLiterals = (text, edit) => text.split(literalSplit).map((part, i) => i % 2 ? part : edit(part)).join('');
const proseOf = text => text.split(literalSplit).filter((_, i) => !(i % 2)).join(' ');
// Shot sizes: the display keeps the size the user asked the camera for (切到近景, 近景镜头; a 远景 background is no request),
// and each English size follows the display word of its own shot. A 前景/中景/后景 layer description is no shot size.
const zhSize = new RegExp(sizeWords, 'g');
const enSize = /\b(?:(?:extreme|medium)[ -])?close[ -]?ups?\b|\b(?:medium(?:[ -](?:wide|full|long))?|full(?:[ -]body)?|extreme[ -](?:wide|long)|wide|long)[ -]shots?\b/gi;
const enSizeName = phrase => (p => /close/.test(p) ? (/extreme/.test(p) ? 'extreme close-up' : /medium/.test(p) ? 'medium close-up' : 'close-up')
  : /medium/.test(p) ? (/wide|long/.test(p) ? 'medium-wide shot' : /full/.test(p) ? 'medium full shot' : 'medium shot') : /full/.test(p) ? 'full shot' : /extreme/.test(p) ? 'extreme wide shot' : 'wide shot')(phrase.toLowerCase());
// Each requested size, and whether the user cuts to it (切到近景): that one belongs to a later shot.
const userSizes = text => [...proseOf(String(text)).replace(new RegExp('(?:不要|不用|不能|不得|别|勿|禁止|避免|没有|不)[^，。,；;\\n]{0,8}?(?:' + sizeWords + ')', 'g'), '')
  .matchAll(new RegExp('(切)?(?:切|推|拉|到|至|给|用|镜头)[^，。,；;\\n]{0,6}?(' + sizeWords + ')|(' + sizeWords + ')(?:镜头|画面)', 'g'))].map(m => ({size:m[2] || m[3], cut:Boolean(m[1]) || /切/.test(m[0])}));
function keepUserSize(display, intent) {
  const own = [...new Map(userSizes(intent).map(item => [item.size, item])).values()];
  if (own.length !== 1 || proseOf(display).includes(own[0].size) || /前景|后景/.test(display)) return display;
  const sizes = text => [...new Set(proseOf(text).match(zhSize) || [])];
  const parts = display.split(/(?=\[Shot [1-9]\d*\])/);
  // The shot that carries a size: a cut size goes only to the one later shot that names a size (never the opening): the size it cuts to
  // (切到女神的特写), or its only size; otherwise the whole text names one size.
  const cutTo = text => new RegExp('切[^，。,；;\\n]{0,8}?(' + sizeWords + ')').exec(proseOf(text))?.[1] || (sizes(text).length === 1 ? sizes(text)[0] : null);
  const targets = parts.map((part, i) => i).filter(i => /^\[Shot (?:[2-9]|[1-9]\d+)\]/.test(parts[i]) && sizes(parts[i]).length);
  const at = own[0].cut ? (targets.length === 1 && cutTo(parts[targets[0]]) ? targets[0] : null) : sizes(display).length === 1 ? -1 : null;
  if (at === null) return display;
  const swap = (text, used) => outsideLiterals(text, part => part.split(used).join(own[0].size));
  return at < 0 ? swap(display, sizes(display)[0]) : parts.map((part, i) => i === at ? swap(part, cutTo(part)) : part).join('');
}
function matchSizes(model, display) {
  const split = text => String(text).split(/(?=\[Shot [1-9]\d*\])/), shots = split(display), parts = split(model);
  if (parts.length !== shots.length) return model;
  // The English sizes already are the display's, in any order ("pushes in to a close-up, starting from a wide shot"): nothing to fix.
  const fits = (found, wanted) => !found.length || wanted.some((names, i) => names.includes(found[0]) && fits(found.slice(1), wanted.filter((_, j) => j !== i)));
  return parts.map((part, i) => {
    const wanted = /前景|后景/.test(shots[i]) ? [] : (proseOf(shots[i]).match(zhSize) || []).map(word => shotSizes[word]);
    const found = (proseOf(part).match(enSize) || []).map(enSizeName);
    if (!wanted.length || found.length !== wanted.length || fits(found, wanted)) return part;
    let n = 0;
    return outsideLiterals(part, text => text.replace(new RegExp('\\b(?:(an?|An?)\\s+)?(' + enSize.source + ')', 'gi'), (all, article, phrase) => {
      const want = wanted[n++];
      return want.includes(enSizeName(phrase)) ? all : (article ? article[0] + (/^[aeiou]/.test(want[0]) ? 'n ' : ' ') : '') + want[0];
    }));
  }).join('');
}
const referenceFieldsOf = text => {
  const heads = [...String(text).matchAll(new RegExp('^(' + referenceFields.join('|') + '):\\n', 'gm'))];
  return Object.fromEntries(heads.map((m, i) => [m[1], text.slice(m.index + m[0].length, heads[i + 1]?.index ?? text.length).trim()]));
};
const referenceTextOf = fields => referenceFields.map(k => k + ':\n' + fields[k]).join('\n\n');
// Official retention: <Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - ...
// The shots are read from the narrative; a list the writer wrote (appears in / 出现在) is replaced.
function markAppearances(fields, narrative, zh) {
  const shots = narrative.split(/(?=\[Shot [1-9]\d*\])/).filter(part => part.startsWith('[Shot '));
  fields.retention_analysis = fields.retention_analysis.replace(/^(<Subject [1-9]\d*>)[ \t]*(?:[(（]\s*(?:appears in|出现在|出现于)[^)）\n]*[)）][ \t]*)?(?=[:：])/gm, (all, id) => {
    const seen = shots.filter(part => part.includes(id)).map(part => part.match(/^\[Shot [1-9]\d*\]/)[0]);
    return seen.length ? id + (zh ? '（出现在 ' + seen.join('、') + '）' : ' (appears in ' + seen.join(', ') + ')') : all;
  });
}
// One error for all failing gates: its message is the first, error.issues lists them for the one repair call.
function failIssues(issues) {
  const failed = issues.filter(Boolean);
  if (failed.length) throw Object.assign(new Error(failed[0]), {issues:failed});
}
const spokenOf = text => [...String(text).matchAll(/<d>([\s\S]*?)<\/d>/g)].map(m => m[1].replace(/^\s*\[[^\]\n]*\]\s*/, '')).sort().join('\n');
const silenceAsked = text => /静音|无声|没有(?:任何)?声音|不要(?:任何)?声音|去掉(?:所有|全部)?声音|silen(?:t|ce)|no sound|mute/i.test(text);
// A telegraphic list of tags ("3D CG render, girl on steps, cat on lower step, eyes closed, ..."): long, comma-stacked, article-free,
// and most of its phrases name nobody who acts ("her cloak ripples, sparks drift from her lantern, embers glow" is prose).
// A place the action goes to that stays outside a still frame, or a jump up onto something below the frame: the requested action
// happens off-screen or against its own geometry. It counts only when a subject walks, runs, leaps or heads to or onto the thing placed
// there (a table stands off-screen to the right … the cat leaps onto the table; walks to a bowl just outside the frame): a glance, a voice,
// a shadow, an exit (walks out of the frame), an off-screen voiceover and the edge of a thing (off the edge of the table) name no place to go.
// A camera that widens or turns toward it (pull out, zoom out, pan, truck, tilt, track, follow) shows it; a push-in, zoom-in or dolly-in never does.
const frameEdge = (side, words = 'beyond|past|outside|below|off') => '\\b(?:' + words + ')\\s+(?:the\\s+)?' + side + '(?:edge|border)s?\\b(?!\\s+of\\s+(?!(?:(?:the|an?|its|his|her|their)\\s+)?(?:frame|shot|screen|picture|view)\\b))';
const offPlace = new RegExp(frameEdge('(?:(?:left|right|top|upper|bottom|lower)\\s+)?', 'beyond|past|outside|below|above|off') + '|\\b(?:outside|beyond|out\\s+of|below|above)\\s+(?:the\\s+)?(?:frame|shot|view|screen)\\b|\\boff[- ]?screen\\b|\\bout\\s+of\\s+frame\\b', 'i');
const moveTo = /\b(?:(?:walk|leap|jump|climb|clamber|crawl|pounce|trot|dash|stroll|dart|rush|scamper|bound)(?:s|es|ed|t|ing)?|hops?|hopped|hopping|steps?|stepped|stepping|moves?|moved|moving|races?|raced|racing|runs?|running|ran|springs?|springing|sprang|heads|headed|heading|go(?:es|ing)?|went)(?:\s+(?:and\s+)?(?:up|down|over|across|back|straight|right|left|(?:up|down|for|back)wards?|\w+ly))*\s+(?:to|toward|towards|onto|into|on\s+to)\s+([^,.;!?]*)/gi;
const notPlace = /^(?:the|an?|its|his|her|their|this|that|at|of|in|on|with|from|up|down|left|right|side|edge|frame|shot|screen|camera|lens|viewer|front|center|centre|middle|foreground|background|distance|height|level|top|bottom)$/;
const belowFrame = new RegExp(frameEdge('(?:bottom|lower)\\s+') + '|' + frameEdge('', 'below') + '|\\bbelow the frame\\b', 'i');
const offFrame = text => {
  const prose = proseOf(text).replace(/\b(?:walk|run|leap|jump|hop|move|crawl|step|trot|dash|stroll|dart|rush|scamper|go|went|exit|leav|disappear)\w*\b[^.;,]{0,20}?\b(?:out\s+of|off)\s+(?:the\s+)?(?:frame|shot|screen|view)\b|\boff[- ]?screen\s+(?:voice\w*|narrat\w*|speaker)|\bvoice\w*\s+(?:from\s+)?off[- ]?screen\b/gi, ' ');
  const placed = prose.split(/(?<=[.!?])\s+/).filter(sentence => offPlace.test(sentence));
  const goes = placed.length > 0 && [...prose.matchAll(moveTo)].some(m => {
    const target = m[1].split(/\s+(?:as|while|when|and|then|before|after|until|where|which|so|but)\b/i)[0];
    const words = (target.toLowerCase().match(/[a-z]{3,}/g) || []).filter(word => !notPlace.test(word));
    return offPlace.test(target) || /^\s*(?:it|them)\s*$/i.test(target) || words.some(word => placed.some(sentence => new RegExp('\\b' + word + '\\b', 'i').test(sentence)));
  });
  return belowFrame.test(prose) && /\b(?:jump|leap|hop|spring|climb|clamber)(?:s|ed|ing)?\b[^.;]{0,30}\b(?:up|upward|upwards|onto)\b/i.test(prose)
    || goes && !/\b(?:pans?|panning|trucks?|trucking|tilts?|tilting|tracks?|tracking|follows?|following|pedestals?|arcs?)\b|\b(?:pull|push|zoom|dolly|dollie)\w*\s+(?:out|back)\b/i.test(prose);
};
// A pose no written action produced: a subject that rises, jumps or lands and is later seated, or a raised paw that nothing lifted.
// The first sentence establishes the opening frame, so its poses stand.
const poseJump = text => {
  const prose = proseOf(text), first = prose.search(/[.!?](?=\s|$)/);
  const lastBefore = (pattern, end) => Math.max(-1, ...[...prose.slice(0, end).matchAll(pattern)].map(m => m.index));
  // A noun after its article names no new movement (the camera trucks right to follow the jump).
  const moved = /(?<!\b(?:the|a|an|its|his|her|their)\s)\b(?:rises?|rising|gets? up|stands? up|lands?|landing|leaps?|leaping|jumps?|jumping|springs?|springing|hops?|hopping|walks?|walking|runs?|running|climbs?|climbing|pounces?)\b/gi;
  const sat = /\b(?:sits?|sitting|settles?|settling|lowers (?:its|his|her) (?:hindquarters|haunches|rump))\b/gi;
  return [...prose.matchAll(/\bseated\b|\b(?:remains?|stays?|still|keeps?)\s+sitting\b/gi)].some(m => m.index > first && lastBefore(moved, m.index) > Math.max(first, lastBefore(sat, m.index)))
    || [...prose.matchAll(/\b(?:raised|lifted|upraised)\s+(?:(?:front|hind|back|left|right)\s+){0,2}(paw|hand|arm|leg|foot|hoof)s?\b/gi)].some(m => m.index > first
      && !new RegExp('\\b(?:rais|lift|bring|brought|curl|pick)\\w*\\b[^.;]{0,40}\\b' + m[1], 'i').test(prose.slice(0, m.index)));
};
// A camera cut the user asks for (切到近景, 转场, cut to) that stayed inside one shot ("at the 3-second mark the camera cuts to ..."):
// the request is dropped. Cutting a cake (切蛋糕) asks for no shot.
const cutMissing = (text, intent) => cutAsked(intent) && /切(?:到|至|换|镜)|转场|分镜|第[二三四五2-5]个?镜头|多镜头|\bcuts? to\b|\bscene change\b/i.test(intent) && !/\[Shot (?:[2-9]|[1-9]\d+)\]/.test(text);
// A cut to nothing (the shot cuts to ., 镜头切到 ...): the writer copied a placeholder and the size it cuts to is lost.
const cutEmpty = text => /\b(?:cuts?|switch(?:es)?|transitions?) to[ \t]*(?:\.{2,}|…|(?=[.,;:!?\n]|$))|(?:切到|切至|切换到|切换至)[ \t]*(?:\.{2,}|…|(?=[。，；：！？,.;:!?\n]|$))/m.test(proseOf(text));
// A two-handed gesture the user asks for (抱拳, 鼓掌, clap, salute) while a subject still holds something: a beat before it puts the
// object away (planted, leaned, tucked, sheathed, passed to the other hand); a spear or staff is never sheathed.
const handheld = '(?:weapon|sword|spear|staff|blade|saber|sabre|knife|knives|dagger|axe|shield|lance|halberd|trident|fan|cup|bowl|umbrella|lantern|book|scroll|flower|bouquet|basket|stick|cane|pole|rod|wand|torch|bottle|phone|bag|box|tray|flag|banner|brush)(?:e?s)?';
const twoHandedGesture = /抱拳|拱手|作揖|合掌|合十|拍手|鼓掌|击掌|\b(?:clap|clasp|salute|applaud)/i;
const heldObject = (text, intent) => {
  if (!twoHandedGesture.test(intent)) return false;
  const prose = proseOf(text), at = prose.search(/\b(?:salut\w*|clasp\w*|clap\w*|applau\w*|palms? together)\b|\bfists?\b[^.;]{0,50}\bpalms?\b|\bpalms?\b[^.;]{0,50}\bfists?\b/i);
  const before = at < 0 ? '' : prose.slice(0, at);
  // The last mention of a held object before the gesture; the put-away is read after it (set dressing in the opening never counts).
  const held = [...before.matchAll(new RegExp('\\b(?:hold|grip|carr|clutch|wield|grasp)\\w*\\b[^.;]{0,40}\\b' + handheld + '\\b|\\b' + handheld + '\\b[^.;]{0,40}\\b(?:held|gripped|clutched|grasped|in (?:his|her|its|their|the) (?:right|left) hands?)\\b', 'gi'))].at(-1);
  return /\bsheath\w*\b[^.;]{0,40}\b(?:spear|staff|pole|polearm|halberd|lance|trident|glaive)s?\b|\b(?:spear|staff|pole|polearm|halberd|lance|trident|glaive)s?\b[^.;]{0,25}\bsheath/i.test(prose) || Boolean(held)
    && !/\b(?:plant|set|lay|lays|laid|plac|lean|sheath|tuck|sling|hang|stick|driv|stand|rest|prop)\w*\b[^.;]{0,50}\b(?:ground|floor|earth|sheath|scabbard|under|against|upright|vertical\w*|back|hip|shoulder|belt|waist)\b|\b(?:pass|transfer|shift|switch|mov|tak)\w*\b[^.;]{0,40}\b(?:other|left|free) hand\b/i.test(before.slice(held.index + held[0].length));
};
// A slow sway of a tail or hair is silent (policy): a soundscape sentence that gives one a sound leaves both halves.
const swaySound = [/^(?:\W*[\w'’-]+){0,5}?\W*\b(?:tail|hair|mane|whiskers)\b[^.!?]*\b(?:sway|swing|swish|flick|drift|wave|flutter)/i, /^[^。！？]{0,8}(?:猫尾|尾巴|尾部|头发|长发|发丝|秀发|鬃毛|胡须)[^。！？]*(?:摆|摇|甩|飘|拂|扫)/];
// With an opening frame the framing is the picture's: a still camera names no shot size the user did not ask for.
const stillSize = (line, zh) => zh
  ? line.replace(new RegExp('(固定|静止)的?(?:' + sizeWords + ')', 'g'), '$1').replace(new RegExp('(?:' + sizeWords + ')(?=的?(?:固定|静止))', 'g'), '')
  : officialEnglish(line.replace(new RegExp('\\b(static|still|fixed|locked|stationary)\\s+in\\s+an?\\s+(?:' + enSize.source + ')', 'gi'), '$1')
    .replace(new RegExp('\\b(static|still|fixed|locked)\\s+(?:' + enSize.source + ')', 'gi'), '$1 shot'));
const tagList = text => proseOf(text).replace(/\[Shot \d+\](?: At [\d:.]+,?)?|<(?:Picture|Subject) \d+>/g, ' ').split(/[.!?](?=\s|$)/)
  .some(sentence => { const phrases = sentence.split(','); return phrases.length >= 5 && (sentence.match(/[A-Za-z]+/g) || []).length >= 18 && !/\b(?:a|an|the)\b/i.test(sentence)
    && phrases.filter(phrase => !/\b(?:her|his|its|their|this|that|these|those|she|he|it|they|is|are|was|were|has|have)\b/i.test(phrase)).length > phrases.length / 2; });
// English words left in a Chinese display: lower-case prose words. Labels, markers, task tags, relations, the user's own words and
// professional terms, which are written in capitals or with digits (CG, 3D, 4K, HDR, VFX, POV), stay.
const ownWords = intent => new Set((String(intent).match(/[A-Za-z]+/g) || []).map(word => word.toLowerCase()));
const englishWords = (text, own, min = 3) => (proseOf(String(text)).replace(/^[a-z_]+:$/gm, '').replace(/The shot (?:features|shows)[^.。]*[.。]|Source assets:|The target video is an edited version of/g, '')
  .replace(/<(?:Subject|Picture|Video|Audio) \d+>|\[[^\]\n]*\]|\bAt \d{2}:\d{2}\.\d{3}|\b(?:fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\b|N\/A/g, '')
  .match(/[A-Za-z]+/g) || []).filter(word => word.length >= min && word === word.toLowerCase() && !own.has(word));
const englishLeft = (text, intent) => englishWords(text, ownWords(intent)).length > 0;
// The words a display most often leaves in English (official style words, cut and camera phrases, shot sizes, speech verbs, colours,
// materials and sounds): the program writes them in Chinese, so only a rarer word costs the one small fix call.
const displayTerms = Object.entries({
  'the (?:shot|camera|scene|view) (?:cuts|switches|transitions|changes) to(?: an?| the)?': '镜头切到', 'the (?:shot|camera) cuts': '镜头切换', 'the camera holds a static shot': '镜头保持固定',
  'live-action, cinematic': '写实电影风格', 'live-action': '写实', cinematic: '电影感', '2d-animated': '二维动画', claymation: '黏土动画', 'watercolou?r': '水彩', 'vintage film': '复古胶片', anime: '动漫',
  'extreme close-ups?': '大特写', 'medium close-ups?': '近景', 'close-ups?': '特写', 'medium-wide shot': '中远景', 'medium full shot': '中全景', 'medium shot': '中景', 'full shot': '全景', 'extreme wide shot': '大远景', 'wide shot': '远景', 'static shot': '固定镜头', 'tracking shot': '跟拍镜头',
  'says in an off-screen voiceover': '以画外音说', says: '说', whispers: '低声说', shouts: '喊道', asks: '问', 'rest(?:s|ing)': '放',
  teal: '青绿色', turquoise: '绿松石色', cyan: '青色', navy: '藏青色', beige: '米色', ivory: '象牙白', cream: '奶油色', amber: '琥珀色', crimson: '深红色', scarlet: '猩红色', maroon: '酒红色', magenta: '品红色',
  lavender: '淡紫色', lilac: '丁香紫', violet: '紫罗兰色', olive: '橄榄绿', emerald: '翠绿色', khaki: '卡其色', charcoal: '炭灰色', golden: '金色', gold: '金色', silver: '银色', bronze: '青铜色', copper: '铜色',
  red: '红色', orange: '橙色', yellow: '黄色', green: '绿色', blue: '蓝色', purple: '紫色', pink: '粉色', brown: '棕色', black: '黑色', white: '白色', 'gr[ae]y': '灰色',
  marble: '大理石', granite: '花岗岩', wooden: '木质', wood: '木头', gravel: '碎石', 'cobblestones?': '鹅卵石', stone: '石头', brick: '砖', concrete: '水泥', glass: '玻璃', steel: '钢', metallic: '金属质感', metal: '金属', brass: '黄铜',
  velvet: '天鹅绒', silk: '丝绸', satin: '缎面', leather: '皮革', denim: '牛仔布', chiffon: '雪纺', lace: '蕾丝', linen: '亚麻', wool: '羊毛', cotton: '棉布', moss: '苔藓', 'petals?': '花瓣',
  whoosh: '呼啸声', swish: '嗖嗖声', 'thuds?': '闷响', 'rustl(?:e|es|ing)': '沙沙声', 'chim(?:e|es|ing)': '叮当声', 'clinks?': '叮当声', creak: '吱呀声', hum: '嗡嗡声', 'whir(?:s|ring)?': '呼呼声',
  'patter(?:s|ing)?': '啪嗒声', 'crunch(?:es|ing)?': '嘎吱声', 'clatter(?:s|ing)?': '哐啷声', footsteps: '脚步声', 'room tone': '室内环境声', breeze: '微风', purr: '呼噜声', 'clicks?': '咔嗒声', 'splash(?:es)?': '水花声',
  faint: '细微的', subtle: '细微的', soft: '柔和的', softly: '轻轻地', gentle: '轻柔的', gently: '轻轻地', slowly: '缓缓地', steadily: '平稳地', bright: '明亮的', dim: '昏暗的',
}).map(([en, zh]) => [new RegExp('^(?:' + en + ')$', 'i'), zh, en]);
const termPattern = new RegExp('([ \\t]*)((?:\\b(?:an?|the)[ \\t]+)?)\\b(' + displayTerms.map(([, , en]) => en).sort((a, b) => b.length - a.length).join('|') + ')\\b([ \\t]*)', 'gi');
const hanOrMark = ch => /[\u3400-\u9fff，。、；：！？“”（）]/.test(ch);
function fixDisplayWords(text, own) {
  return outsideLiterals(String(text), part => part.replace(termPattern, (all, before, article, word, after, offset, whole) => {
    // Lower-case words only, as englishWords reads them: a capital is a name or a professional term (Golden Gate, RED); a phrase may open its sentence.
    const lower = word === word.toLowerCase() || /[\s,-]/.test(word) && word.slice(1) === word.slice(1).toLowerCase();
    const zh = !lower || article !== article.toLowerCase() || own.has(word.toLowerCase()) ? '' : displayTerms.find(([pattern]) => pattern.test(word))?.[1];
    if (!zh) return all;
    const prev = whole.charAt(offset - 1), next = whole.charAt(offset + all.length);
    // The article of a replaced word goes with it, and two replaced words join (镜头切到近景); other spaces and single letters stay (A 字裙, 走向镜头 她停下).
    // A sound word before its own 声 or 响 (轻柔的 crunching 声响) keeps one: 嘎吱声响, not 嘎吱声声响.
    return (!prev || hanOrMark(prev) ? '' : before) + '\u0002' + (/[声响]/.test(next) ? zh.replace(/[声响]$/, '') : zh) + '\u0003' + (!next || hanOrMark(next) ? '' : after);
  }).replace(/\u0003[ \t]+\u0002/g, '').replace(/[\u0002\u0003]/g, '').replace(/(\bAt \d{2}:\d{2}\.\d{3})[ \t]*(?:(?:时|秒)[ \t]*[,，]?|[,，])[ \t]*/g, '$1 ').replace(/(?<=(?:镜头|摄影机|摄像机|相机)[^。！？\n]{0,20})(?<![所可难得用足借据予加])以(?:缓慢|较慢|慢(?=的?速))(?:的?速度|速)?/g, '缓慢')
    .replace(/(?<=(?:镜头|摄影机|摄像机|相机)[^。！？\n]{0,20})(?<![所可难得用足借据予加])以(?:快速|较快|快(?=的?速))(?:的?速度|速)?/g, '快速')
    .replace(/镜头(?:最后|最终)?以((?:(?!直到|开场|开始|拍摄|时)[^。！？，,；;\n]){2,40}?)结束(?=[。！？，,；;\n]|$)/g, '最后画面停在$1').replace(/环境室调[声音]?/g, '室内环境声').replace(/中景近景/g, '近景')
    // A size the cut phrase left with its English "of" (镜头切到特写 of <Subject 2>, 近景 of both) reads the Chinese way.
    .replace(new RegExp('(' + sizeWords + ')[ \\t]+of[ \\t]+(?:(both|them)|(<(?:Subject|Picture) [1-9]\\d*>))', 'g'), (_, size, both, tag) => (both ? '两人' : tag + ' ') + '的' + size)).replace(/(<(?:Subject|Picture|Video|Audio) [1-9]\d*>)(?=[\u3400-\u9fff])/g, '$1 ').replace(/([\u3400-\u9fff])(?=<(?:Subject|Picture|Video|Audio) [1-9]\d*>)/g, '$1 ');
}
// The display sentences that still carry an English word, with each such word marked ⟦word⟧: the one small fix call rewrites
// only these, and removing the marks gives the sentence back.
const sentencesOf = text => outsideLiterals(String(text), part => part.replace(/([。！？])/g, '$1\u0001')).split(/\u0001|\n/).map(s => s.trim()).filter(Boolean);
const displaySlips = (values, own) => [...new Set(values.flatMap(value => sentencesOf(value).map(sentence => {
  // A slipped sentence marks its short English words too (近景 ⟦of⟧ ⟦both⟧), so the fix call rewrites the whole phrase.
  const words = englishWords(sentence, own).length ? new Set(englishWords(sentence, own, 2)) : new Set();
  return words.size ? outsideLiterals(sentence, part => part.replace(/(?<![A-Za-z_])[A-Za-z]+(?![A-Za-z_])/g, word => words.has(word) ? '⟦' + word + '⟧' : word)) : '';
}).filter(Boolean)))];
// A display slip alone never costs a rewrite: the pair is kept, and only its slips go to the fix call (error.h3Slips).
const displayOnly = (issues, slips) => Object.assign(new Error(issues[0]), {issues, h3DisplayOnly:true, h3Slips:slips});
// Colour families; a subject whose display names another colour than its English definition (teal → 青铜色) was mistranslated.
// Words that only contain a colour character name no colour: 金属, 白皙, 白天, 青年, 青春, 黑暗 (and 藏青 is navy).
const colours = [['red|crimson|scarlet', '红|赤|绯'], ['orange', '橙|橘'], ['yellow', '黄'], ['green|olive|emerald', '绿|翠|橄榄'], ['teal|cyan|turquoise|aqua', '(?<!藏)青(?!铜|年|春)|蓝绿|松石|水鸭'],
  ['blue|navy|azure', '蓝|藏青'], ['purple|violet|lavender|lilac', '紫'], ['pink', '粉'], ['brown|chestnut', '棕|褐|咖啡|栗'], ['black|dark(?=[ -]hair)', '黑(?!暗)'], ['white', '白(?!皙|天)'],
  ['gr[ae]y', '灰'], ['gold(?:en)?|blonde?', '金(?!属)'], ['silver', '银'], ['bronze', '青铜|古铜'], ['copper', '(?<![青古])铜']].map(([en, zh]) => [new RegExp('\\b(?:' + en + ')\\b', 'i'), new RegExp(zh)]);
const subjectLines = text => new Map(String(text).split('\n').map(line => [/^<Subject [1-9]\d*>/.exec(line.trim())?.[0], line]).filter(([id]) => id));
// An accepted Chinese rendering of an English hair colour is no swap (grey or silver hair is 花白 or 白发, white hair 银发, blonde 金黄),
// but only inside a hair, fur or beard word: a blonde girl's 黄色连衣裙 is still a swap.
const renderings = [[/\b(?:gr[ae]y|silver)\b[^,.;]{0,12}\b(?:hair|haired|beard|bearded|mane|fur|whiskers)\b/i, '白'], [/\bwhite\b[^,.;]{0,12}\b(?:hair|haired|beard|bearded|mane|fur|whiskers)\b/i, '银'], [/\bblonde?\b/i, '黄']];
const hairColours = /[花灰白银金黄]+色?的?(?=[长短卷直]?(?:头发|发丝|发(?![光出生现亮射着起动抖烫热])|胡须|胡子|须|毛(?![衣呢线毯巾笔])|鬃))|(?<=头发|发丝|胡须|胡子|毛发|鬃毛)[花灰白银金黄]+/g;
// accepted: the characters of the hair words that render the English (白 of 白发 for silver hair); they are neither extra nor missing.
function colourDiff(line, zhLine) {
  const accepted = renderings.map(([english, ch]) => [english.exec(line)?.[0], ch]).filter(([said, ch]) => said && (zhLine.match(hairColours) || []).some(word => word.includes(ch)));
  const shown = zhLine.replace(hairColours, word => accepted.some(([, ch]) => word.includes(ch)) ? '' : word);
  return {missing:colours.filter(([en, zh]) => en.test(line) && !zh.test(zhLine) && !accepted.some(([said]) => en.test(said))),
    extra:colours.filter(([en, zh]) => zh.test(shown) && !en.test(line)), accepted:accepted.map(([, ch]) => ch)};
}
function coloursSwapped(model, display) {
  const chinese = subjectLines(display);
  return [...subjectLines(model)].some(([id, line]) => chinese.has(id) && (diff => diff.missing.length && diff.extra.length)(colourDiff(line, chinese.get(id))));
}
// A colour a subject's display line names in place of its English colours (teal and copper → 青铜) is set back, outside quotes, dialogue
// and accepted hair words, when the English names that wrong colour nowhere: in the subject's own definition and retention lines, and in
// the summary and narrative as a whole colour word (青铜色, 青铜金属, 青铜身体) in a sentence about it (naming it, or opening with 它/他/她/其).
const colourNames = ['红', '橙', '黄', '绿', '青绿', '蓝', '紫', '粉', '棕', '黑', '白', '灰', '金', '银', '青铜', '铜'];
function recolour(model, display, english) {
  const chinese = subjectLines(display[0]);
  for (const [id, line] of subjectLines(model)) {
    const {missing, extra, accepted} = colourDiff(line, chinese.get(id) || '');
    if (!missing.length || extra.length !== 1 || extra[0][0].test(english)) continue;
    const right = missing.map(item => colourNames[colours.indexOf(item)]).join('与'), held = [];
    const swap = (part, wrong) => part.replace(hairColours, word => accepted.some(ch => word.includes(ch)) ? (held.push(word), '\u0004') : word).replace(wrong, right).replace(/\u0004/g, () => held.shift());
    for (const i of [0, 2]) display[i] = display[i].split('\n').map(text => text.trim().startsWith(id) ? outsideLiterals(text, part => swap(part, new RegExp(extra[0][1].source, 'g'))) : text).join('\n');
    const word = new RegExp('(?:' + extra[0][1].source + ')(?=色|金属|机身|外壳|身体)', 'g');
    for (const i of [1, 3]) display[i] = outsideLiterals(display[i], part => part.replace(/[^。！？\n]+[。！？]?/g, sentence => sentence.includes(id) || /^\s*(?:\[Shot \d+\](?: At [\d:.]+)?\s*)?(?:它|他|她|其)/.test(sentence) ? swap(sentence, word) : sentence));
  }
  return display;
}
// The official English wording (H3 guides): a later shot names its cut, a still camera holds a static shot, a vertical camera pan is a tilt.
const cutVerb = /\b(?:cut|cuts|cutting|transitions?|changes?|switch(?:es)?|dissolves?|fades?|wipes?)\b/i;
// "cuts to" takes a shot (a close-up of…, a wide shot…); a clause (she turns…) follows "the shot cuts." as its own sentence.
const shotPhrase = /^(?:(?:an?|the)\s+)?(?:[\w'-]+\s+){0,2}?(?:close-?ups?|shots?|views?|angles?|pov)\b/i;
// A still-camera rewrite ends its clause; a camera move later in the sentence (as it tracks, while pushing in) keeps the model's words.
const stillEnd = /(?=\s*(?:[.,;!]|$|(?:and|as|while|with|during)\b))(?![^.;!?\n]*\b(?:track|follow|push|pull|pan|tilt|orbit|circl|zoom|dolly|truck|arc|crane|pedestal|drift|glid|sweep|rotat)\w*)/.source;
const officialEnglish = text => outsideLiterals(String(text), part => part
  .replace(/(\[Shot (?:[2-9]|[1-9]\d+)\] At \d{2}:\d{2}\.\d{3})[ \t]*,?[ \t]*(?=([^.;!?\n]*))/g, (_, head, clause) => head + ', ' + (!clause.trim() || cutVerb.test(clause) ? '' : shotPhrase.test(clause.trim()) ? 'the shot cuts to ' : 'the shot cuts. '))
  .replace(/\b(the|The) (?:view|scene|frame|picture|image|footage) (cuts|switches|transitions|changes) to\b/g, '$1 shot $2 to')
  .replace(/(\b[Tt]he (?:shot|camera) cuts to )(A|An|The)\b/g, (_, cut, article) => cut + article.toLowerCase())
  .replace(/(the shot cuts\. )([a-z])/g, (_, cut, letter) => cut + letter.toUpperCase())
  .replace(new RegExp(/\b(?:(the|The) camera|Camera) (?:remains|stays|is|keeps|holds) (?:completely |fully |perfectly )?(?:a )?(?:static|still|stationary|motionless|locked(?: off)?|fixed)(?: in (?:place|position))?(?: shot)?(?: throughout(?: the (?:shot|clip|video))?)?/.source + stillEnd, 'g'), (_, article) => (article || 'The') + ' camera holds a static shot')
  .replace(new RegExp(/\b(?:(the|The) camera|Camera) (?:holds|maintains|keeps|retains|preserves) (?:its |the |a )?(?:(?:steady|stable|fixed|same|initial|original|current) )?(?:(?:(?:extreme |medium )?close-up|(?:medium(?:-wide| full)?|full|wide) shot) )?(?:composition|framing)\b/.source + stillEnd, 'g'), (_, article) => (article || 'The') + ' camera holds a static shot')
  // ", static shot" as a trailing label, not an adjective list ("ending on a wide, static shot").
  .replace(/(?<!\b(?:a|an)\s+[\w-]+),\s*(?:a\s+)?static shot(?=\s*(?:[.;!]|$))/gi, '. The camera holds a static shot')
  .replace(/\b((?:[Cc]amera|[Ss]hot|[Ii]t) (?:\w+ly )?)pan(s|ned|ning)? (down|up)(?:wards?)?\b/g, (_, subject, suffix = '', direction) => subject + 'tilt' + ({ned:'ed', ning:'ing'}[suffix] ?? suffix) + ' ' + direction)
  // A camera move reads with the official speed words: pull out (not back), at slow or fast speed, no vague smoothly or steadily.
  .replace(cameraSpeed, (_, camera, before, verb, direction, after, speed) => camera + ' ' + verb + (/^pull/.test(verb) && direction === ' back' ? ' out' : direction)
    + (/slow/.test(speed) || /slowly|gently/.test(before + after) ? ' at slow speed' : /fast/.test(speed) || /quickly|rapidly/.test(before + after) ? ' at fast speed' : '')));
const cameraSpeed = new RegExp('\\b([Cc]amera)((?: (?:slowly|smoothly|steadily|gently|quickly|rapidly))*) ((?:pan|track|truck|tilt|push|pull|dolly|dollie|move|drift|glide|zoom|arc|pedestal|crane|follow|orbit|rise|descend|sweep)(?:s|es|ed|ing|ned|ning)?)'
  + '((?: (?:in|out|back|left|right|up|down|forward|backward|closer))?)((?: (?:slowly|smoothly|steadily|gently|quickly|rapidly))*)((?: at (?:an? )?(?:slow|fast|medium|moderate|steady|constant|even|matching) (?:speed|pace))?)\\b', 'g');
function baseModeName(mode) {
  const name = String(mode || '').toLowerCase();
  return /^(?:text_video|t2va?)$/.test(name) ? 'text_video' : /^(?:image_video|i2va?)$/.test(name) ? 'image_video' : /^(?:first_last|fl2va?)$/.test(name) ? 'first_last' : '';
}
const baseModeOf = options => baseModeName(options.mode || options.h3Mode || options.minimaxH3Mode);
function baseAlignmentLine(mode, durationSeconds, finalShot = 1) {
  const name = baseModeName(mode);
  return name === 'image_video' ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
    : name === 'first_last' ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${finalShot || 1}) aligns with the ${Number(durationSeconds).toFixed(2)}-second mark of the target video.` : '';
}
function baseDisplayAlignment(mode, durationSeconds) {
  const name = baseModeName(mode), duration = Number(durationSeconds);
  return name === 'image_video' ? '<Picture 1> 是视频第 0.00 秒的起始画面，完整参考。'
    : name === 'first_last' ? '<Picture 1> 对齐视频第 0.00 秒（开头）；<Picture 2> 对齐' + (duration > 0 ? `第 ${duration.toFixed(2)} 秒（结尾）。` : '视频结尾。') : '';
}
// Ends the text's last sentence and appends the next; Chinese sentences follow without a space.
function appendSentence(text, sentence) {
  const head = String(text || '').trim().replace(/[，,；;：:、]+$/, '');
  if (!head) return sentence;
  const han = hanPattern.test(head.replace(/<[^<>]*>/g, '').match(/[\u3400-\u9fffA-Za-z][^\u3400-\u9fffA-Za-z]*$/)?.[0] || '');
  const ended = /(?:[。！？.!?…”"」』）)]|<\/d>)$/.test(head) ? head : head + (han ? '。' : '.');
  return ended + (/[。！？]$/.test(ended) || (/[”」』）>]$/.test(ended) && hanPattern.test(sentence.charAt(0))) ? '' : ' ') + sentence;
}
// Fields form: a JSON object or `name: value` blocks, with any alignment line before them (dropped) or the editor display.
function parseBaseFields(value) {
  const source = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  const shown = /^【参考帧对齐】[ \t]*\n?([^\n]*)/m.exec(source)?.[1] || '';
  const text = fromBaseDisplay(source).trim().replace(/^```(?:json|text)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  if (text.startsWith('{')) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return null; }
    if (!parsed || !baseFields.some(k => typeof parsed[k] === 'string')) return null;
    return {fields:Object.fromEntries(baseFields.map(k => [k, String(parsed[k] ?? '').trim()])), alignment:String(parsed.reference_alignment || '').trim()};
  }
  const headers = [...text.matchAll(/^[ \t]*(integrated_multimodal_description|overall_soundscape|non_diegetic_music)[ \t]*[:：][ \t]*/gm)];
  if (!headers.length || new Set(headers.map(m => m[1])).size !== headers.length) return null;
  const fields = Object.fromEntries(baseFields.map(k => [k, '']));
  headers.forEach((m, i) => { fields[m[1]] = text.slice(m.index + m[0].length, headers[i + 1]?.index ?? text.length).trim(); });
  return {fields, alignment:text.slice(0, headers[0].index).trim() || shown.trim()};
}
const serializeBase = fields => baseFields.map(k => k + ': ' + fields[k]).join('\n\n');
// Layout only, never fails: one line per shot, [Shot 1] first, cut times, <Picture N> tags, <d> language tags, N/A.
// writerPair: a writer's answer, whose cut announced again before its marker goes (the user's own text is never dropped).
function normalizeBase(fields, duration, writerPair) {
  // A frame tag stands apart from Chinese (<Picture 1> 中的猫), so its editor alias reads as a word.
  const out = Object.fromEntries(baseFields.map(k => [k, outsideLiterals(String(fields[k] || '').replace(/\r\n/g, '\n').trim().replace(/[ \t]*\n\s*/g, '\n'), part => part.replace(/(^|[^<\w])Picture ([1-9])\b(?!>)/g, '$1<Picture $2>')
    .replace(/(<Picture [1-9]>)(?=[\u3400-\u9fff])/g, '$1 ').replace(/([\u3400-\u9fff])(?=<Picture [1-9]>)/g, '$1 '))
    .replace(/<d>(?!\s*\[[A-Za-z][\w -]*\])\s*([\s\S]*?)<\/d>/g, (_, words) => '<d>[' + (hanPattern.test(words) ? 'Chinese' : 'English') + '] ' + words + '</d>')]));
  for (const k of baseFields.slice(1)) if (/^(?:无|N\/A|none)[。.]?$/i.test(out[k]) || (k === 'non_diegetic_music' && !out[k])) out[k] = 'N/A';
  let text = cutTimesToMarkers(out.integrated_multimodal_description, writerPair).replace(/\[\s*shot\s*([1-9]\d*)\s*\](?:[ \t]*at[ \t]*(\d{1,2}):(\d{2})\.(\d{3})[ \t]*[,，]?)?\s*(?=([\s\S]?))/gi, (_, n, m, s, ms, next) => {
    const time = m == null || (n === '1' && !+m && !+s && !+ms) ? '' : ' At ' + m.padStart(2, '0') + ':' + s + '.' + ms;
    return '[Shot ' + n + ']' + time + (time && !hanPattern.test(next) ? ', ' : ' ');
  }).replace(/\s*(\[Shot (?:[2-9]|[1-9]\d+)\])/g, '\n$1').trim();
  const first = text.indexOf('[Shot 1]');
  // "Watercolor style, [Shot 1] ..." keeps the style sentence, behind the marker.
  if (first < 0) text = '[Shot 1] ' + text;
  else if (first > 0 && !text.slice(0, first).includes('[Shot')) text = '[Shot 1] ' + appendSentence(text.slice(0, first), text.slice(first + 8).trim());
  const count = (text.match(/\[Shot \d+\]/g) || []).length;
  if (count > 1 && duration > 0 && !/\[Shot \d+\] At \d/.test(text)) {
    text = text.replace(/\[Shot ([2-9]|[1-9]\d+)\] ?(?=([\s\S]?))/g, (_, n, next) => '[Shot ' + n + '] At ' + shotStamp(duration * (n - 1) / count) + (hanPattern.test(next) ? ' ' : ', '));
  }
  return {...out, integrated_multimodal_description:relayoutBaseFacts(text.trim())};
}
const inferBaseMode = parsed => /Picture 2/.test(parsed.alignment + parsed.fields.integrated_multimodal_description) ? 'first_last' : /Picture 1/.test(parsed.alignment + parsed.fields.integrated_multimodal_description) ? 'image_video' : 'text_video';
const alignmentDuration = alignment => Math.max(0, ...[...String(alignment).matchAll(/(\d+(?:\.\d+)?)\s*(?:-second mark|秒|seconds?)/g)].map(m => Number(m[1])));
// Old five-section prompts (history, old engines) → fields form, deterministically.
function legacyBase(text, options = {}) {
  if (!/^\s*(?:【任务定位】|\{\s*"task"\s*:)/.test(text)) return null;
  const {sections} = parseFormat(text);
  const mode = baseModeOf(options) || (/首尾帧|FL2V|first[_ ]last/i.test(sections[0]) ? 'first_last' : /图生|图片到视频|I2V|image[_ ]video/i.test(sections[0]) ? 'image_video' : 'text_video');
  const phases = sections[2].split(/\n+/).map(p => p.replace(/^\s*\d+(?:\.\d+)?\s*[-–—~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：]\s*/, '').trim()).filter(Boolean);
  // A real speaker identity (<Subject 1> = (S1)，机械少女) introduces the line; a generic placeholder does not. It ends at the next definition.
  const identities = Object.fromEntries([...sections[1].matchAll(/<Subject [1-9]\d*>\s*=\s*\((S[1-9]\d*)\)\s*[，,、:：]?\s*([^\n；;]*?)(?=\s*[；;，,]?\s*<Subject [1-9]\d*>\s*=|[；;\n]|$)/g)]
    .map(m => [m[1], m[2].replace(/[。.]\s*$/, '').replace(/^(?:画面|<Picture [12]>\s*)中的?/, '').trim()]).filter(([, name]) => name && !/原文|说这句台词|说话者|说话的角色/.test(name)));
  const dialogue = [...sections[3].matchAll(/\((S[1-9]\d*)\)\s*[:：]\s*[“"]([^”"]+)[”"]/g)].map(m => `${identities[m[1]] ? identities[m[1]] + ' ' : ''}(${m[1]}) 说：<d>${m[2]}</d>`);
  const speaking = phases.findIndex((p, i) => i && /说|开口|speak|says?\b|talk/i.test(p));
  phases.splice(speaking < 0 ? phases.length : speaking + 1, 0, ...dialogue);
  // 【连续性与约束】 items are meta rules (official rule 9); only the sound and music lines carry content.
  const audio = {};
  for (const item of sections[4].split(/\n+/)) {
    const sound = /^\s*(?:\d+\s*[.、．)）]\s*)?(环境与动作声音|配乐)\s*[:：]\s*(.*)$/.exec(item);
    if (sound) audio[sound[1]] = sound[2].trim();
  }
  const narrative = phases.reduce((all, sentence) => appendSentence(all, sentence), '').replace(/<Subject [1-9]\d*>\s*(?:=\s*)?/g, '');
  return {mode, duration:Number(options.durationSeconds ?? legacyDurationPattern.exec(sections[0])?.[1]) || undefined,
    text:serializeBase({integrated_multimodal_description:'[Shot 1] ' + narrative, overall_soundscape:audio['环境与动作声音'] || '与画面动作一致的自然环境声和动作声。', non_diegetic_music:audio['配乐'] || 'N/A'})};
}
function readBase(value, options = {}) {
  const text = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  const legacy = legacyBase(text, options), parsed = parseBaseFields(legacy ? legacy.text : text);
  return parsed && {parsed, mode:baseModeOf(options) || legacy?.mode || inferBaseMode(parsed),
    duration:Number(options.durationSeconds ?? (legacy?.duration || alignmentDuration(parsed.alignment))) || undefined};
}
// Local reverse fact slots → readable sentences, one per line, that translate into official prose; prose
// paragraphs pass through. The style comes first, scene/framing/look read as sentences, FL2V frame groups
// become time phrases, and without a motion line one neutral sentence carries the opening into the ending.
const countWord = /^(?:[一二两三四五六七八九十几数多]+|\d+)\s*[名位只个头条匹辆架群对件张把]$/;
const styleWord = /风格|画风|插画|渲染|写实|动画|动漫|卡通|摄影|水彩|油画|国风|像素|二次元|漫画|\b(?:CG|3D|2D|style|illustration|render(?:ing|ed)?|anime|cartoon|photo(?:graphy|realistic)?|watercolor)\b/i;
const factLeads = {场景:'场景是', 画面:'画面为', 光色材质:'光色与质感为', Scene:'The scene is ', Framing:'The framing is ', Look:'The look is '};
const groupLeads = {shared:['两帧中都有', '两帧中，', 'Both frames show ', 'In both frames, '], open:['开头画面 <Picture 1> 中，', '开头画面 <Picture 1> 中，', 'In the opening frame <Picture 1>, ', 'In the opening frame <Picture 1>, '], close:['结尾画面 <Picture 2> 中，', '结尾画面 <Picture 2> 中，', 'In the ending frame <Picture 2>, ', 'In the ending frame <Picture 2>, ']};
const factTransition = {zh:'随后画面从开头状态连续、自然地过渡到结尾状态。', en:'The shot then moves continuously and naturally from the opening state into the ending state.'};
function relayoutBaseFacts(narrative) {
  if (!new RegExp(`(?:^|[\\n\\]。.] ?)(?:${legacyFactHeading}|${legacyFactLabel})`, 'u').test(narrative)) return narrative;
  const heading = new RegExp(`^(${legacyFactHeading})\\s*(.*)$`, 'u'), fact = new RegExp(`^(${legacyFactLabel}|随后[：:]|Then:)\\s*(.*)$`, 'u');
  return narrative.split(/(?=\[Shot [1-9]\d*\])/).map(shot => {
    const head = /^\[Shot [1-9]\d*\](?: At [\d:.]+,?)? ?/.exec(shot)?.[0] || '';
    const styles = [], lines = [], motions = [];
    let group = '', lead = false, english = false, moved = false, closing = -1;
    for (const raw of relayoutLegacyFacts(shot.slice(head.length)).split(/\n+/)) {
      // The camera the user asked for reads as a sentence, not behind a label.
      let text = raw.replace(/按用户运镜[：:]\s*/g, '').trim();
      if (!text) continue;
      const title = heading.exec(text);
      if (title) {
        group = /<Picture [12]>.*<Picture [12]>|共同|shared/.test(title[1]) ? 'shared' : /<Picture 2>|尾帧|ending/.test(title[1]) ? 'close' : 'open';
        english = /shared|opening|ending|\band\b/.test(title[1]);
        if (group === 'close') closing = lines.length;
        lead = true;
        text = title[2].trim();
        if (!text) continue;
      }
      const slot = fact.exec(text);
      let sentence = text, subject = false, motion = false;
      if (slot) {
        const label = slot[1].slice(0, -1), latin = /^[A-Z]/.test(label);
        let parts = slot[2].split(/\s*[；;]\s*/).map(part => part.replace(/^(?:[\u4e00-\u9fff]{1,4}[：:]|(?:count|pose|action)\s+)/, '')).filter(Boolean);
        // Shared style facts open the shot; a frame's own style and the rest of the look stay in its sentence.
        if (/^(?:光色材质|Look)$/.test(label) && group !== 'open' && group !== 'close') parts = parts.flatMap(part => part.replace(/[。.]$/, '').split(/\s*[，,]\s*/)).filter(atom => !styleWord.test(atom) || (styles.includes(atom) || styles.push(atom), false));
        // A count belongs to its identity: 一名红色战甲女性, not 一名，红色战甲女性.
        let value = parts.reduce((all, part, i) => all + (i && !countWord.test(parts[i - 1]) ? (latin ? ', ' : '，') : '') + part, '');
        if (!value.replace(/[。！？.!?]/g, '')) continue;
        if (!/[。！？.!?]$/.test(value)) value += latin ? '.' : '。';
        subject = /^(?:主体\d+|Subject \d+)$/.test(label);
        motion = /^(?:随后|Then)$/.test(label);
        sentence = factLeads[label] ? factLeads[label] + value : motion ? label + (latin ? ', ' : '，') + value : value;
      }
      // FL2V: the motion between the frames is told before the ending frame, not after it.
      if (motion && closing >= 0) { motions.push(sentence); continue; }
      moved = moved || motion;
      if (lead && group) {
        sentence = groupLeads[group][(english ? 2 : 0) + (subject ? 0 : 1)] + (english ? sentence.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()) : sentence);
        lead = false;
      }
      lines.push(sentence);
    }
    // The neutral transition only when neither a motion line nor the inventory's own transition sentence tells it.
    if (closing >= 0) lines.splice(closing, 0, ...(motions.length ? motions : moved || lines.slice(closing).some(line => /自然延续|过渡|抵达尾帧|\bcontinu|\btransition|\bresolves into\b/i.test(line)) ? [] : [factTransition[english ? 'en' : 'zh']]));
    if (styles.length) lines.unshift(styles.join(english ? ', ' : '，') + (english ? '.' : '。'));
    return head + lines.join('\n');
  }).join('\n');
}
function toBaseDisplay(value, options = {}) {
  const pair = referenceResult(value), source = pair ? pair.displayPrompt : value;
  const base = readBase(source, options);
  if (!base) return typeof source === 'string' ? source : JSON.stringify(source ?? '');
  const fields = normalizeBase(base.parsed.fields, base.duration), alignment = baseDisplayAlignment(base.mode, base.duration);
  const audio = text => text === 'N/A' ? '无' : joinChineseSentences(text);
  return [alignment && '【参考帧对齐】\n' + alignment,
    '【画面与动作】\n' + shownMarks(joinChineseSentences(fields.integrated_multimodal_description)),
    '【环境声音】\n' + audio(fields.overall_soundscape), '【背景音乐】\n' + audio(fields.non_diegetic_music)].filter(Boolean).join('\n\n');
}
function fromBaseDisplay(value) {
  let text = String(value ?? '').replace(/\r\n/g, '\n');
  if (!/^【画面与动作】/m.test(text) || /^【主体定义】/m.test(text)) return text;
  text = text.replace(/^【参考帧对齐】[\s\S]*?(?=^【画面与动作】)/m, '');
  baseDisplayFields.slice(1).forEach((field, i) => { text = text.replace(new RegExp('^【' + field + '】[ \\t]*\\n?', 'gm'), baseFields[i] + ': '); });
  text = readMarks(text);
  const parsed = parseBaseFields(text);
  return parsed ? serializeBase(normalizeBase(parsed.fields)) : text;
}
function checkBase(value, options = {}) {
  const base = readBase(value, options);
  if (!base) throw new Error(baseIssue.sections);
  const {mode} = base, duration = base.duration ?? 30;
  if (!(duration >= 1 && duration <= 30)) throw new Error('H3 时长必须为 1-30 秒');
  const fields = normalizeBase(base.parsed.fields, duration, options.writerPair);
  let text = fields.integrated_multimodal_description;
  if (!text.replace(/\[Shot \d+\]/g, '').trim() || !fields.overall_soundscape) throw new Error(baseIssue.sections);
  let previous = 0;
  [...text.matchAll(/\[Shot (\d+)\](?: At (\d{2}):(\d{2})\.(\d{3}))?/g)].forEach((m, i) => {
    if (Number(m[1]) !== i + 1) throw new Error(baseIssue.shotOrder);
    const at = m[2] == null ? NaN : Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    if (i ? !(at > previous && at < duration) : m[2] != null) throw new Error(baseIssue.shotTime);
    if (i) previous = at;
  });
  const all = baseFields.map(k => fields[k]).join('\n');
  if (/<Subject [1-9]\d*>/.test(all)) throw new Error(baseIssue.subject);
  const allowed = mode === 'first_last' ? ['<Picture 1>', '<Picture 2>'] : mode === 'image_video' ? ['<Picture 1>'] : [];
  if ((all.match(/<(?:Picture|Video|Audio) [1-9]\d*>/g) || []).some(t => !allowed.includes(t))) throw new Error('参考媒体标签缺失或引用了未提供的媒体');
  if (options.language === 'en' && hanPattern.test(proseOf(all))) throw new Error('H3 模型侧提示词需要英文正文，中文内容仅用于编辑器显示');
  if (options.language === 'zh' && baseFields.some(k => {
    const prose = proseOf(fields[k]).replace(/<(?:Picture|Video|Audio) \d+>|\[Shot \d+\](?: At [\d:.]+)?|\(S\d+(?:,\s*S\d+)*\)|N\/A/g, '');
    const words = prose.match(/[A-Za-z]{2,}/g) || [];
    return words.length >= 8 && words.join('').length > (prose.match(/[\u3400-\u9fff]/g) || []).length * 2;
  })) throw new Error(baseIssue.chinese);
  if (options.language === 'en') text = officialEnglish(text);
  // Every supplied frame is named in the narrative: the opening frame after the style sentence, the final frame at the end.
  const language = options.language || (hanPattern.test(proseOf(text)) ? 'zh' : 'en');
  if (allowed.length && !text.includes('<Picture 1>')) text = text.replace(/^\[Shot 1\] ?([^\n]*)/, (_, line) => {
    // The first sentence ends outside dialogue and quoted text ("出发吧。" inside <d> is not the end).
    let offset = 0, end = -1;
    line.split(literalSplit).some((part, i) => {
      const stop = i % 2 ? null : /[。！？]|[.!?](?=\s|$)/.exec(part);
      if (stop) end = offset + stop.index + 1;
      offset += part.length;
      return stop;
    });
    const rest = end < 0 ? '' : line.slice(end).trim();
    return '[Shot 1] ' + (rest ? appendSentence(appendSentence(line.slice(0, end), baseAnchors.open[language]), rest) : appendSentence(line, baseAnchors.open[language]));
  });
  if (allowed.length > 1 && !text.includes('<Picture 2>')) text = appendSentence(text, baseAnchors.close[language]);
  fields.integrated_multimodal_description = text;
  return {fields, mode, duration, language};
}
function validateBaseFields(value, options = {}) {
  return serializeBase(checkBase(value, options).fields);
}
function composeBaseModelPrompt(value, options = {}) {
  const pair = referenceResult(value);
  const {fields, mode, duration} = checkBase(pair ? pair.modelPrompt : value, {...options, language:'en'});
  const shots = fields.integrated_multimodal_description.match(/\[Shot (\d+)\]/g) || ['[Shot 1]'];
  const flat = text => (mode === 'first_last' ? text.replace(/<Picture ([12])>/g, 'Picture $1') : text).replace(/\s*\n\s*/g, ' ');
  const line = baseAlignmentLine(mode, duration, shots[shots.length - 1].match(/\d+/)[0]);
  return (line ? line + '\n\n' : '') + baseFields.map(k => k + ': ' + flat(fields[k])).join('\n\n');
}
// Speech the user quotes (说：“…”, 喊道“…”, says "…") or writes as <d> reaches H3 in a <d> block or quoted text. The requirement
// decides by what it says: silence (沉默, 不开口) drops the lines; a clause that changes the dialogue (把“出发吧。”改成“…”, 让她改说“…”,
// 去掉台词) replaces them with the new lines it quotes, one of which must arrive; a clause that keeps them (保留原台词) changes nothing.
function requiredLines(options = {}) {
  const clean = line => line.trim().replace(/[。！？.!?，,]+$/, '');
  const source = [...String(options.currentPrompt || '').matchAll(/(?:说|道|喊|问|唱|\b(?:says?|asks?|shouts?|sings?))\s*[:：,，]?\s*[“"]([^”"\n]+)[”"]|<d>(?:\s*\[[^\]\n]*\])?\s*([\s\S]*?)<\/d>/gi)].map(m => clean(m[1] || m[2])).filter(Boolean);
  const tail = requirementTail(options);
  if (/沉默|不开口|不说话|不出声|无台词|静音|no dialogue|\bsilent\b|\bsilence\b/i.test(tail)) return {lines:[]};
  const fresh = [...tail.matchAll(/[“"]([^”"\n]+)[”"]/g)].map(m => clean(m[1])).filter(line => line && !source.includes(line));
  // Each clause with its quotes masked: a quoted source line reads as 台词, a new line as “”.
  const changes = tail.replace(/[“"]([^”"\n]+)[”"]/g, (_, line) => source.includes(clean(line)) ? '台词' : '“”').split(/[，。；！？,;!?\n]|\.(?=\s|$)/)
    .some(clause => (/台词|对白|对话|说的?话|dialogue|speech|\blines?\b/i.test(clause) || /“”/.test(clause) && /说|讲|喊|问|唱|念|\b(?:say|says|said|ask|asks|shout|shouts|sing|sings)\b/i.test(clause))
      && !/保留|保持|不变|不[要用]?改|别改|\bkeep|\bunchanged\b/i.test(clause));
  return changes ? {lines:fresh, any:true} : {lines:source};
}
function validateBaseResult(value, options = {}) {
  const pair = referenceResult(value);
  // displayIsSource: the display half is the user source itself (translate-only), so its language is not gated.
  const writerPair = !options.displayIsSource;
  const results = pair ? [checkBase(pair.modelPrompt, {...options, language:'en', writerPair}), checkBase(pair.displayPrompt, {...options, language:options.displayIsSource ? undefined : 'zh', writerPair})] : [checkBase(value, options)];
  // English words left in the Chinese half of a writer's pair: the program writes the common ones in Chinese (faint, says, thud);
  // professional capitals (3D, CG) and the user's own words stay. Official 4.6: the soundscape is N/A only when the user asks for silence.
  const issues = [], displayIssues = [], own = ownWords(userIntent(options));
  if (pair && !options.displayIsSource) {
    for (const k of baseFields) results[1].fields[k] = fixDisplayWords(results[1].fields[k], own);
    if (options.strictPair && baseFields.some(k => englishWords(results[1].fields[k], own).length)) displayIssues.push(baseIssue.english);
    if (/^N\/A\.?$/i.test(results[0].fields.overall_soundscape.trim()) && !silenceAsked(userIntent(options))) issues.push(baseIssue.silence);
    const sounds = results.map((r, i) => r.fields.overall_soundscape.split(i ? /(?<=[。！？])/ : /(?<=[.!?])\s+/)), silent = sounds.map((parts, i) => parts.filter(part => swaySound[i].test(part.trim())));
    if (silent[0].length && silent[0].length === silent[1].length && silent[0].length < sounds[0].length)
      results.forEach((r, i) => { r.fields.overall_soundscape = sounds[i].filter(part => !silent[i].includes(part)).join(i ? '' : ' ').trim(); });
  }
  // Mirror validateReferenceResult: complete a requested loop closure and a default camera, never reject for them.
  const intent = userIntent(options), narrativeOf = r => r.fields.integrated_multimodal_description;
  const complete = (missing, sentences) => {
    if (missing(narrativeOf(results[0]))) for (const r of results) if (r === results[0] || missing(narrativeOf(r))) r.fields.integrated_multimodal_description = appendSentence(narrativeOf(r), sentences[r.language]);
  };
  if (loopRequested(intent)) complete(text => !new RegExp(policy.closurePattern, 'i').test(text), loopClosure);
  complete(text => !namesCamera(text + intent), baseCamera);
  if (pair) {
    if (!options.displayIsSource && results[0].mode !== 'text_video' && !userSizes(intent).length)
      for (const r of results) r.fields.integrated_multimodal_description = narrativeOf(r).replace(/^[^\n]*/, line => stillSize(line, r.language === 'zh'));
    if (!options.displayIsSource) results[1].fields.integrated_multimodal_description = keepUserSize(narrativeOf(results[1]), intent);
    results[0].fields.integrated_multimodal_description = matchSizes(narrativeOf(results[0]), narrativeOf(results[1]));
    if (options.strictPair && !options.displayIsSource && tagList(narrativeOf(results[0]))) issues.push(baseIssue.prose);
    if (options.strictPair && !options.displayIsSource && offFrame(narrativeOf(results[0]))) issues.push(baseIssue.offFrame);
    if (options.strictPair && !options.displayIsSource && poseJump(narrativeOf(results[0]))) issues.push(baseIssue.pose);
    if (options.strictPair && !options.displayIsSource && cutMissing(narrativeOf(results[0]), intent)) issues.push(baseIssue.cut);
    if (options.strictPair && !options.displayIsSource && cutEmpty(narrativeOf(results[0]) + '\n' + narrativeOf(results[1]))) issues.push(baseIssue.cutTarget);
    if (options.strictPair && !options.displayIsSource && heldObject(narrativeOf(results[0]), intent)) issues.push(baseIssue.held);
  }
  failIssues(issues.length ? [...issues, ...displayIssues] : []);
  const [model, display] = results.map(r => serializeBase(r.fields));
  // Speech quoted in one half may be a <d>[Chinese] …</d> block in the other: compare the words, not the language tag.
  const literals = text => [...text.matchAll(/<d>([\s\S]*?)<\/d>|"([^"\n]*)"|“([^”\n]*)”/g)].map(m => m[1]?.replace(/^\s*\[[^\]\n]*\]\s*/, '') ?? m[2] ?? m[3]).sort().join('\n');
  if (pair) {
    const shots = text => (text.match(/\[Shot \d+\](?: At [\d:.]+)?/g) || []).join('|');
    const tokens = text => [...new Set(text.match(/<Picture [1-9]\d*>/g) || [])].sort().join('|');
    if (shots(model) !== shots(display)) throw new Error(baseIssue.pairShots);
    if (tokens(model) !== tokens(display)) throw new Error('H3 中英文提示词的素材关系不一致');
    if (literals(model) !== literals(display)) throw new Error(baseIssue.pairLiterals);
    // A faithful English shot has about 3-4 letters per Chinese character (every real pair measured ≥ 2.6); far fewer means a dropped block.
    const shotTexts = r => narrativeOf(r).split(/(?=\[Shot [1-9]\d*\])/).map(shot => proseOf(shot).replace(/<(?:Picture|Video|Audio) \d+>|\[Shot \d+\](?: At [\d:.]+,?)?/g, ''));
    const [english, chinese] = results.map(shotTexts);
    if (chinese.some((shot, i) => (english[i].match(/[A-Za-z]/g) || []).length < (shot.match(/[\u3400-\u9fff]/g) || []).length * 2.5 - 40)) throw new Error(baseIssue.pairCoverage);
  }
  // quotedLines: false — a reverse result is rebuilt from the pictures; its refinement is the answer that keeps the lines.
  const {lines, any} = options.quotedLines === false ? {lines:[]} : requiredLines(options);
  if (lines.length && !lines[any ? 'some' : 'every'](line => literals(model).includes(line))) throw new Error('原台词未完整保留');
  if (displayIssues.length) throw displayOnly(displayIssues, displaySlips(baseFields.map(k => results[1].fields[k]), own));
  return pair ? JSON.stringify({modelPrompt:model, displayPrompt:display}) : model;
}
module.exports = { instruction, instructionFor, validate, sectionNames, sectionFields, formatInstruction, validateFormat, fromValidatedLegacy, requiresChineseOutput, validationIssue, referenceFields, referenceInstruction, isReferenceMode, validateReference, toReferenceDisplay, fromReferenceDisplay, referenceResultInstruction, referenceResultSchema, referenceWriterSchema, twoHandedGesture, referenceResult, validateReferenceResult, referenceFrames, baseFields, baseDisplayFields, baseModeName, baseInstruction, baseResultInstruction, baseTranslateInstruction, baseResultSchema, baseAlignmentLine, baseDisplayAlignment, parseBaseFields, validateBaseFields, composeBaseModelPrompt, toBaseDisplay, fromBaseDisplay, validateBaseResult };
