(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NovaFlowXiaotaoPromptSource = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The caller supplies only explicit prompt content from the current turn,
  // never an unscoped scan of the conversation or an old project's content.
  const text = value => typeof value === 'string' ? value.trim() : '';
  const comparable = value => text(value).normalize('NFKC').replace(/\s+/g, ' ');
  const pageRef = /(?:页面|当前(?:页面|输入框|提示词)|输入框|编辑器|下方|下面)/;
  const chatRef = /(?:对话|聊天|我(?:刚才|之前|上面|刚刚)?(?:发|说|写|输入)的|上面那段)/;
  const revision = /^(?:(?:请|麻烦|帮我|给我|那就|再|把它|把画面|将其|将画面)[，,。\s]*)*(?:改成|改为|换成|换为|调整成|调整为|增加|加入|添加|去掉|移除|删除|保留|保持|强调|弱化|缩短|延长)/;
  const operationOnly = /^(?:(?:请|麻烦|帮我|给我|把|将|对|一下|下|再|只|仅|直接|当前|页面|输入框|下面|下方|对话|聊天|里的|中的|这段|这个|该|的|首尾帧|首尾|视频|画面|绘图|生图|编辑|风格|音乐|音效|音频|ui|UI|布局|角色|提示词|提示语|提示|prompt|优化|润色|改写|整理|完善|增强|一下|即可|就好|生成草稿)[\s，,。.!！：:、]*)+$/i;

  function isPromptConversation(instruction) {
    const request=text(instruction),head=request.split(/[:：]/,1)[0];
    // Inspect the instruction, never the prompt text following an explicit
    // colon. A complaint mentioning an action is not permission to run it.
    const explicit=/^(?:(?:请|麻烦|帮我|给我|先|再|直接|然后|那就|把|将)\s*)*(?:优化|润色|改写|整理|完善|增强|改成|改为|调整成|调整为)/;
    const clauses=head.split(/[，,。；;！？!?\n]+/).map(text).filter(Boolean);
    if(clauses.some(clause=>explicit.test(clause)))return false;
    return /为什么|为何|怎么|如何|什么意思|什么原因|正常对话|普通对话|无法.{0,6}对话|不能.{0,6}对话|一直报错|总是报错|反馈极慢|响应.{0,4}慢|做不到/.test(head)
      || /(?:优化|润色|改写|提示词).{0,16}(?:失败|报错|不正常|不成功|很慢|太慢|不能用|用不了)/.test(head);
  }

  function classifyPromptAction(instruction) {
    const request=text(instruction);
    if(isPromptConversation(request))return 'none';
    if(!request||/(?:不|不要|不用|无需|别|禁止)(?:再|直接|自动)?\s*(?:优化|润色|改写|整理|完善|增强)/.test(request))return 'none';
    const revisionOnly=revision.test(request) && !/(?:骨骼|图层|插槽|工程|素材|文件|参数|时长|帧率|关键帧|镜头轨道)/.test(request);
    if(!revisionOnly&&!/(?:优化|润色|改写|整理|完善|增强)/.test(request))return 'none';
    const withoutNegated=request.replace(/(?:不|不要|不用|无需|别)(?:再|直接|自动)?\s*(?:生成|绘制|生图|制作|执行|应用|保存|导出|提交|删除)(?:视频|图片|音频|素材)?/g,'');
    if(/(?:生成|绘制|生图|制作|执行|应用|保存|导出|提交|删除)/.test(withoutNegated.replace(/生成草稿/g,'')))return 'compound';
    return 'optimize';
  }

  function extractTurnPrompt(instruction) {
    const request=text(instruction);
    const explicitBelow=request.match(/(?:我(?:说|发|写)(?:的)?|按|用|^(?:(?:请|麻烦|帮我|给我|再|先|只|仅)\s*)*(?:优化|润色|改写|整理|完善|增强)(?:一下)?\s*)(?:下面|下方)(?:(?:这|那)(?:一)?|一)?段(?:提示词)?\s*[:：]\s*([\s\S]+)$/);
    if(explicitBelow)return text(explicitBelow[1]);
    const match=request.match(/^(?:请|麻烦|帮我|给我|再|先|只|仅|把|将|对|当前|这段|这条|下方|下面|页面|对话|聊天|的|里|中|绘图|生图|编辑|风格|视频|首尾帧|首尾|音乐|音效|音频|UI|ui|布局|角色|提示词|提示语|提示|prompt|优化|润色|改写|整理|完善|增强|一下|\s|[,，、])*[:：]\s*([\s\S]+)$/i);
    return match ? text(match[1]) : '';
  }

  function resolvePromptSource({ pagePrompt = '', conversationPrompt, instruction = '' } = {}) {
    const page = text(pagePrompt), request = text(instruction), extracted=extractTurnPrompt(request);
    const given = conversationPrompt === undefined ? extracted : text(conversationPrompt);
    const isRevision = revision.test(request) || (!!given && revision.test(given));
    const requirement = revision.test(given) ? given : request;
    const isOperation = operationOnly.test(request) || (!!extracted && !revision.test(extracted) && comparable(extracted)===comparable(given));
    // A revision is an instruction about a source, not a competing full prompt.
    const chat = isRevision && (comparable(given) === comparable(request) || revision.test(given)) ? '' : given;
    const explicitBelow=/(?:我(?:说|发|写)(?:的)?|按|用|^(?:(?:请|麻烦|帮我|给我|再|先|只|仅)\s*)*(?:优化|润色|改写|整理|完善|增强)(?:一下)?\s*)(?:下面|下方)(?:(?:这|那)(?:一)?|一)?段(?:提示词)?\s*[:：]/.test(request);
    // References inside the prompt text are content, not source selectors.
    const sourceSpecifier = request.split(/[:：]/, 1)[0];
    const wantsPage = !explicitBelow && pageRef.test(sourceSpecifier), wantsChat = explicitBelow || chatRef.test(sourceSpecifier);
    const ask = reason => Object.freeze({ status: 'ask', reason, prompt: '', requirements: '' });
    const ready = (source, prompt) => Object.freeze({ status: 'ready', source, prompt,
      requirements: isOperation ? '' : requirement });
    if (wantsPage && wantsChat) return ask('ambiguous-explicit-source');
    if (wantsPage) return page ? ready('page', page) : ask('page-prompt-empty');
    if (wantsChat) return chat ? ready('conversation', chat) : ask('conversation-prompt-empty');
    // What the user just wrote wins over what is already on the page.
    if (chat && !(page && comparable(page) === comparable(chat))) return ready('conversation', chat);
    if (page) return ready('page', page);
    return ask('both-prompts-empty');
  }
  return Object.freeze({ resolvePromptSource, extractTurnPrompt, classifyPromptAction, isPromptConversation,
    isOptimizationRequest: instruction => classifyPromptAction(instruction)==='optimize' });
});
