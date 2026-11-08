/* UI 主题切换: one or more uploaded screens, several themes, one batch.
 * Each screen is re-themed in place (layout, counts and text kept, every art asset redrawn).
 * Screens of the same theme share one look: the first finished screen of a theme rides
 * along as a second picture for the rest. The theme library is the user's: defaults are
 * only a starting set, and every entry can be edited, added or removed. */
;(function (root) {
  'use strict'

  const STORE_KEY = 'foart.ui.theme-library.v2'
  const PICK_KEY = 'foart.ui.theme-picks.v1'
  const DEFAULT_THEMES = Object.freeze([
    ['东方仙侠', '主色翡翠青绿配鎏金与朱红点缀，云海仙山、悬空楼阁与瀑布为背景，金色祥云和仙鹤穿梭；面板是白玉雕花嵌金边，按钮是玉璧与金环；符号做成玉佩、葫芦、仙丹、灵剑、莲花，字母用鎏金錾刻；人物着飘逸仙袍与发冠，周身仙气流光；画面布满金色光粒与灵气光带'],
    ['赛博朋克', '主色电光紫、霓虹青配荧光粉，雨夜高楼与全息广告牌为背景；面板是黑色碳纤维嵌发光霓虹边，按钮是半透明全息玻璃；符号做成芯片、机械义眼、能量电池、霓虹徽章，字母是发光灯管字；人物是机械义体战士与黑客，带发光纹路；画面有扫描线、故障光效和地面霓虹倒影'],
    ['埃及神话', '主色黄金配青金石蓝与绿松石，夕阳金字塔、神庙巨柱与尼罗河为背景；面板是黄金浮雕嵌宝石边框，满布象形文字与圣甲虫纹样；符号做成法老面具、荷鲁斯之眼、圣甲虫、安卡十字、眼镜蛇，字母为黄金镶宝石；人物是法老、艳后与胡狼神祭司，穿金饰与亚麻长袍；画面有金色神光和沙尘光束'],
    ['海盗冒险', '主色深海蓝配金币黄与船木棕，暴风海面、骷髅旗大帆船与宝藏岛为背景；面板是旧船木加黄铜包角与麻绳；按钮是罗盘与舵轮；符号做成金币、宝箱、骷髅、弯刀、朗姆酒瓶、藏宝图，字母是黄铜铸字；人物是船长、女海盗与水手，戴三角帽与眼罩；画面有浪花飞溅和金币闪光'],
    ['糖果乐园', '主色草莓粉、薄荷绿、柠檬黄的高饱和糖果色，糖果城堡、棒棒糖树与奶油云为背景；面板是果冻与糖霜质感嵌彩色糖粒；按钮是软糖与马卡龙；符号做成棒棒糖、甜甜圈、马卡龙、草莓蛋糕、彩虹糖，字母是透亮硬糖；人物换成可爱糖果精灵与甜点师，穿糖果色服装；画面有亮晶晶糖粉闪光'],
    ['暗黑哥特', '主色暗红配黑铁与暗金，月下古堡、墓园与彩绘玻璃窗为背景；面板是黑铁雕花嵌红宝石，尖拱哥特边框；符号做成血月、蝙蝠、银十字、毒药瓶、玫瑰与骷髅，字母为暗金哥特体；人物是吸血鬼伯爵、女巫与圣骑士；画面有红色雾气、烛光和冷月光对比'],
    ['太空科幻', '主色星际蓝配白色装甲与橙色警示光，星云、行星环与空间站舷窗为背景；面板是白色流线装甲嵌蓝色能量灯带；按钮是全息圆盘；符号做成星球、飞船、能量核心、外星晶体、机甲头盔，字母为发光金属；人物是宇航员、机甲驾驶员与外星使者；画面有能量光束和星尘粒子'],
    ['北欧神话', '主色冰蓝配古铜与极光绿，雪山峡湾、世界树与长船为背景；面板是古铜与符文石雕刻，配狼毛与皮革；符号做成雷神之锤、维京头盔、符文石、渡鸦、角杯，字母为刻符古铜；人物是维京战士、女武神与雷神；画面有极光、雪花与闪电光效'],
    ['日式和风', '主色朱红配墨黑与金箔，樱花神社、鸟居与灯笼夜景为背景；面板是朱漆木框嵌金箔与家纹；按钮是和纸扇与铜镜；符号做成招财猫、武士刀、折扇、樱花、狐面，字母为金箔书法体；人物是武士、巫女与狐仙；画面有樱花飘落和灯笼暖光'],
    ['蒸汽朋克', '主色黄铜金配深棕皮革与暖橙光，齿轮巨钟塔与飞艇城市为背景；面板是黄铜铆钉框配玻璃仪表；按钮是压力表与齿轮；符号做成齿轮、怀表、护目镜、机械鸟、蒸汽阀，字母为黄铜铸字；人物是发明家、飞艇女船长与机械骑士；画面有蒸汽烟雾与暖色灯光'],
    ['丛林遗迹', '主色翡翠绿配黄金与古石灰，热带雨林、瀑布与玛雅金字塔遗迹为背景；面板是长满藤蔓的石雕嵌黄金；符号做成黄金面具、翡翠头骨、豹子、羽蛇、宝石图腾，字母为黄金石刻；人物是探险家、部落祭司与女战士；画面有阳光光柱与萤火'],
    ['冰雪圣诞', '主色圣诞红配松绿、金色与冰晶白，雪夜小镇、圣诞树与极光为背景；面板是冰晶边框配红丝带与金铃；按钮是礼物盒与雪花；符号做成礼物、铃铛、姜饼人、拐杖糖、雪人，字母为冰雕金边；人物是圣诞老人、精灵与雪之公主；画面有飘雪与暖色窗光'],
].map(([name, description]) => Object.freeze({ name, description })))

  // 质感、氛围感、精度 each get their own concrete line (Dylan, 2026-11-08); a single
  // "high quality" sentence left results plain.
  const QUALITY_ZH = Object.freeze([
    '质感：每种材质都要画出真实可信的表面——金属有拉丝或錾刻纹理和锐利高光，宝石和玉石通透有内部折射和高光点，木、石、织物有清晰纹理和磨损，珐琅、玻璃、糖霜等有各自的光泽；面板和按钮有厚度、倒角、多层浮雕和描边，不是平涂色块。',
    '氛围感：整屏一个统一的主光源和明确的冷暖对比，背景有纵深、雾气和体积光，前景有主题粒子、光尘或飘落物，角色和关键元素有轮廓光；画面有情绪和故事感，像游戏宣传主视觉。',
    '精度：线条和边缘干净锐利，图标轮廓清楚，文字笔画完整清晰，对称件左右一致，同类按钮和格子大小统一、对齐整齐，细节丰富但不糊不脏，没有扭曲、错位和多余的零件。',
    '整体是顶级手游的高品质主视觉：色彩鲜艳浓郁、对比强烈、精修收尾。不要灰暗、不要素淡、不要平涂、不要塑料感。',
  ])
  const QUALITY_EN = Object.freeze([
    'Material quality: every material has a believable surface - metal with brushed or engraved texture and crisp speculars, gems and jade translucent with inner refraction and glints, wood, stone and cloth with clear grain and wear, enamel, glass and frosting with their own sheen; panels and buttons have thickness, bevels, layered relief and trims, never flat fills.',
    'Atmosphere: one key light with a clear warm/cool contrast across the screen, depth, haze and volumetric light in the background, theme particles, light dust or falling things in the foreground, rim light on characters and key elements; the screen carries mood and story like game key art.',
    'Precision: clean sharp lines and edges, crisp icon silhouettes, complete legible lettering, symmetric pieces mirror exactly, buttons and cells of one kind share size and alignment, rich detail without mush, no warping, misalignment or stray parts.',
    'Overall: top-tier mobile game key art, rich vivid colour, strong contrast, polished finish. Never dull, washed-out, flat or plastic.',
  ])
  const text = value => String(value == null ? '' : value).trim()
  const copy = value => JSON.parse(JSON.stringify(value))
  function read(key, fallback) {
    try { const value = JSON.parse(root.localStorage.getItem(key) || 'null'); return value == null ? fallback : value } catch { return fallback }
  }
  function write(key, value) { try { root.localStorage.setItem(key, JSON.stringify(value)) } catch {} }

  function loadLibrary() {
    const saved = read(STORE_KEY, null)
    const list = Array.isArray(saved) ? saved : DEFAULT_THEMES
    return list.map(item => ({ name: text(item?.name).slice(0, 40), description: text(item?.description).slice(0, 600) })).filter(item => item.name)
  }

  // The instruction the picture model gets for one screen and one theme.
  // The local engine reads Chinese best and keeps people and symbols unless every one is named
  // as changed, so its wording counts them out ("every ... none left").
  function buildPrompt({ theme, keepText = true, keepLayout = false, note = '', anchored = false, provider = 'gpt', inventory = '' } = {}) {
    const name = text(theme?.name), description = text(theme?.description), extra = text(note)
    if (!name) throw new Error('请选择主题')
    if (!keepLayout) return redesignPrompt({ name, description, keepText, extra, inventory, anchored, provider })
    if (provider === 'local') return [
      `把图1这张游戏界面整体换成「${name}」主题${description ? `：${description}` : ''}。`,
      '布局完全不变：画布比例、每个面板、按钮、条栏、网格、符号格、人物区、横幅和文字块的位置与大小不变，行数、列数、按钮数和重复元素数量不变。',
      keepText ? '所有文字和数字逐字保留，内容和位置不变，只把字体做成主题风格。' : '数字和按钮文字保留原位，标题和装饰文字可改成贴合主题的简短文字。',
      `原图中的每一个人物都换成「${name}」主题的人物：保持人数、位置、姿势和取景，但服装、发型、配饰和身份全部按新主题重做，一个人物都不能保留原来的衣服。`,
      `每一个符号格里的图案都重画成「${name}」主题的物件，字母和数字仍是同样的字母和数字但用主题材质制作，一个符号都不能保留原来的造型、颜色或发光效果。`,
      `背景换成「${name}」场景；所有面板、边框、按钮和条栏用主题材质、纹样和光线重做，边框和底板要有层次丰富的浮雕、镶嵌和描金装饰，按钮要有厚度、高光和发光。画面中不能残留任何原主题的美术。`,
      '要有创意：每个符号都设计成独特、有辨识度的主题物件，人物造型夸张有魅力，背景有纵深和故事感，空白处加入主题特效（光粒、光带、飘落物）。',
      ...QUALITY_ZH,
      anchored ? `图2是同一套「${name}」主题已完成的界面：画风、配色、材质、边框、按钮和符号设计与图2保持一致，但不采用图2的布局。` : '',
      extra ? `用户补充要求：${extra}` : '',
    ].filter(Boolean).join('\n')
    return [
      `Re-theme this game UI screen (Image 1) into the theme "${name}"${description ? `: ${description}` : ''}.`,
      'It is the same screen in a new theme, not a new layout. Layout lock: same canvas and aspect ratio; every panel, button, bar, grid, icon slot, character area, banner and text block stays at the same position and size; the same number of rows, columns, buttons and repeated items; the same reading order and visual hierarchy.',
      keepText
        ? 'Text lock: reproduce every readable word and number exactly as in Image 1, same language, same values, same places; only restyle the lettering to fit the theme.'
        : 'Text: keep every number and every control label in place; titles and decorative words may be rewritten to fit the new theme, short and readable.',
      `Redraw everything else for "${name}": the background becomes a ${name} scene; characters keep their count, position, pose and framing but become ${name} characters with new costumes and identity; every symbol and icon is redrawn as a ${name} object of the same size and role (letters and numbers stay the same letters and numbers, crafted in theme materials); panels, frames, buttons and bars are rebuilt with ${name} materials, ornaments and lighting. No art from the old theme may remain.`,
      'Be creative: every symbol becomes a distinctive, iconic theme object; characters are striking and charismatic; the background has depth and story; frames and panels carry layered relief, inlay and gilded ornament; buttons have thickness, highlights and glow; empty space carries theme effects (light particles, ribbons of light, falling petals or snow).',
      ...QUALITY_EN,
      anchored ? `Image 2 is a finished screen from this same "${name}" set: match its art style, palette, materials, frame, button and symbol designs exactly so both screens belong to one game. Take nothing from Image 2's layout.` : '',
      extra ? `Additional request from the user (follow it): ${extra}` : '',
    ].filter(Boolean).join('\n')
  }

  // 重新设计: the uploaded screen is read once into a function list (grid size, controls, their
  // exact text) and each theme designs a whole new screen from that list. No source picture goes
  // to the picture model, so nothing of its composition, characters or poses can carry over.
  // anchored: Image 1 is a finished screen of the same theme set, for look only.
  function redesignPrompt({ name, description, keepText, extra, inventory, anchored, provider }) {
    const list = text(inventory)
    if (!list) throw new Error('缺少界面功能清单')
    if (provider === 'local') return [
      `为「${name}」主题从零设计一张全新的游戏界面${description ? `：${description}` : ''}。`,
      `界面功能清单（只决定有哪些功能、数量和文字，不决定外观）：\n${list}`,
      '各区域从上到下的顺序和大致占比按清单；符号盘严格按清单的每行个数和行数（横向每行几个、纵向共几行，数清楚，不多不少）；角色区单独存在，角色不要塞进符号盘；清单里的每个按钮、信息条和数值都要有。',
      keepText ? '只把清单中引号里的原文文字和数字写进画面，逐字照抄；区域名、说明和括号里的注释不要写进画面；标为“图标，无文字”的按钮只画图标。' : '数字和按钮文字按清单写；标题和装饰文字可按主题改写；区域名和注释不要写进画面。',
      `整屏构图、符号盘框体、面板与按钮造型、角色设定和姿态全部根据「${name}」主题创作：符号盘装进主题造型的大框体，顶部是不带文字的主题徽记，面板和按钮是有厚度的主题异形雕刻件，不是矩形圆角块；角色是为主题原创、有魅力的人物，动态姿势，融入有纵深的主题场景；每个符号都是独特的主题物件。`,
      ...QUALITY_ZH,
      anchored ? `图1是同一套「${name}」主题已完成的另一张界面：画风、配色、材质、框体、按钮和符号设计与图1保持一致，但功能和布局按本清单，不照搬图1的布局。` : '',
      extra ? `用户补充要求：${extra}` : '',
    ].filter(Boolean).join('\n')
    return [
      `Design a completely new game UI screen from zero in the theme "${name}"${description ? `: ${description}` : ''}.`,
      `Function list of the screen (it decides only which functions, counts and words exist, never the look):\n${list}`,
      'Regions follow the list from top to bottom with about the listed share of the height; the symbol grid has exactly the listed symbols per row and number of rows (count them); the character area is its own region, characters never fill the grid; every button, info bar and value in the list is present.',
      keepText ? 'Write on the screen only the quoted words and numbers from the list, copied exactly; never write region names, notes or bracketed remarks; a button marked as icon-only gets an icon and no words.' : 'Write numbers and button labels from the list; titles and decorative words may be rewritten for the theme; never write region names or notes.',
      `Composition, the grid frame, panel and button shapes, characters and their poses are all designed for "${name}": the grid sits inside a large theme-shaped frame, a theme emblem without lettering at the top, panels and buttons are thick sculpted theme pieces, not rounded rectangles; characters are original, charismatic, in dynamic poses inside a deep theme scene; every symbol is a distinctive theme object.`,
      ...QUALITY_EN,
      anchored ? `Image 1 is another finished screen of this same "${name}" set: match its art style, palette, materials, frames, buttons and symbol designs, but follow this list for functions and layout.` : '',
      extra ? `Additional request from the user (follow it): ${extra}` : '',
    ].filter(Boolean).join('\n')
  }

  // The function list comes from 小桃's selected online brain (default 豆包), billed by text use.
  async function readInventory(screen, signal) {
    const api = root.electronAPI, controller = root.NovaFlowXiaotaoArtAgent?.panel?.controller
    const selected = controller?.businessModelSnapshot?.()
    if (typeof api?.promptAssistantDescribeArtStyle !== 'function' || typeof controller?.onlineBusinessUi !== 'function') throw new Error('读图功能未就绪，请刷新页面后重试')
    if (!selected || selected.provider !== 'api') throw new Error('重新设计要先读懂界面：请在小桃里选择一个在线模型（默认豆包），再点生成')
    const result = await api.promptAssistantDescribeArtStyle({
      requestId: root.crypto.randomUUID(), name: String(screen.name || 'screen.png').slice(0, 120), purpose: 'ui-inventory', dataUrl: screen.dataUrl,
      assistantSelectionScope: 'xiaotao', assistantProvider: 'api', assistantModelId: selected.modelId, assistantSelectionEpoch: selected.epoch,
      signal, isInputCurrent: () => !signal.aborted, ...controller.onlineBusinessUi(selected.modelId), onBillingNotice: () => true,
    })
    if (!result?.ok || !text(result.inventory)) throw new Error(text(result?.error) || '界面读取失败，未生成')
    return text(result.inventory)
  }

  async function imageSize(dataUrl) {
    return await new Promise((resolve, reject) => {
      const image = new root.Image()
      image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
      image.onerror = () => reject(new Error('参考图无法读取'))
      image.src = dataUrl
    })
  }
  // GPT reads the size as an aspect ratio plus a 2K tier; a local run keeps a size it can draw.
  function outputSize(provider, width, height) {
    const longEdge = provider === 'gpt' ? 2048 : 1536
    const scale = longEdge / Math.max(width, height)
    const snap = value => Math.max(256, Math.round(value * scale / 16) * 16)
    return { width: snap(width), height: snap(height) }
  }

  const STATE_KEYS = ['mode', 'provider', 'randomSeed', 'seed', 'loras', 'samplingOverrides', 'localTextQuality', 'localEditStrength', 'localQwen21Variant', 'localDrawEngine', 'googleResolution']
  async function preparedFor(rt, { screen, anchor, prompt, keepLayout = false }) {
    const context = rt.captureContext(), source = context.state
    const state = copy(Object.fromEntries(STATE_KEYS.filter(key => source[key] !== undefined).map(key => [key, source[key]])))
    const provider = root.NovaFlowArtGenerateModels?.normalizeProvider?.(state.provider) || 'local'
    const natural = screen.width && screen.height ? { width: screen.width, height: screen.height } : await imageSize(screen.dataUrl)
    const size = outputSize(provider, natural.width, natural.height)
    // 只换皮 edits the screen itself; 重新设计 draws from the function list, with only a finished
    // screen of the same theme (when there is one) as the picture to match.
    const references = keepLayout
      ? [{ id: screen.id || 'ui-theme-screen', name: screen.name || '界面.png', dataUrl: screen.dataUrl, width: natural.width, height: natural.height, role: 'layout' },
        ...(anchor ? [{ id: 'ui-theme-anchor', name: '同主题成品.png', dataUrl: anchor, role: 'style' }] : [])]
      : anchor ? [{ id: 'ui-theme-anchor', name: '同主题成品.png', dataUrl: anchor, role: 'style' }] : []
    const mode = references.length ? 'img2img' : 'txt2img'
    Object.assign(state, {
      mode, provider, count: 1, nsfw: false, negativePrompt: '', width: size.width, height: size.height,
      gptQualityImg2img: 'high', gptQualityTxt2img: 'high', gptSize: 'Custom', gptCustomWidth: size.width, gptCustomHeight: size.height,
      localEditStrength: 'enhanced', uiPreserveLayout: keepLayout, uiLayoutMode: keepLayout ? 'preserve' : 'reflow', uiRunIntent: 'redesign',
    })
    state.localDrawEngine = root.NovaFlowArtGenerateModels?.capabilityFor?.(provider, mode, state)?.engine || state.localDrawEngine || ''
    return { uiThemeSwitch: true, promptOwnsReferenceRoles: true, state, references, originalPrompt: prompt, optimizedPrompt: prompt, promptSnapshot: { prompt, negativePrompt: '' } }
  }

  async function waitIdle(rt, signal) {
    while (rt.state.running) {
      if (signal.aborted) return
      await new Promise(resolve => root.setTimeout(resolve, 400))
    }
  }

  // Runs screens x themes one at a time through the normal generation path, so
  // billing, the results list and canvas placement stay the same as 生图.
  async function runBatch({ screens, themes, keepText, keepLayout = false, note, signal, onProgress }) {
    const rt = root.__NovaFlowArtGenerate
    if (!rt?.run || !rt.captureContext) throw new Error('生图组件未就绪，请刷新页面')
    if (rt.state.running) throw new Error('已有生图正在进行，请稍候')
    const total = screens.length * themes.length
    let done = 0, failed = 0
    const inventories = new Map()
    if (!keepLayout) for (const screen of screens) {
      if (signal.aborted) return { done, failed, total, stopped: true }
      onProgress?.(`正在读取界面 ${inventories.size + 1}/${screens.length}`)
      try { inventories.set(screen, await readInventory(screen, signal)) }
      catch (error) { return { done, failed, total, stopped: true, error: text(error?.message || error) } }
    }
    for (const theme of themes) {
      let anchor = ''
      for (const screen of screens) {
        if (signal.aborted) return { done, failed, total, stopped: true }
        onProgress?.(`${theme.name} · 第 ${done + failed + 1}/${total} 张`)
        const provider = root.NovaFlowArtGenerateModels?.normalizeProvider?.(rt.captureContext().state.provider) || "local"
        const prompt = buildPrompt({ theme, keepText, keepLayout, note, anchored: Boolean(anchor), provider, inventory: inventories.get(screen) })
        const uiPrepared = await preparedFor(rt, { screen, anchor, prompt, keepLayout })
        const before = rt.selectedResult?.()?.id || ''
        await rt.run({ uiPrepared })
        await waitIdle(rt, signal)
        const result = rt.selectedResult?.()
        if (result && result.id !== before && (result.imageUrl || result.dataUrl)) {
          done += 1
          if (!anchor && screens.length > 1) anchor = await asDataUrl(result.imageUrl || result.dataUrl)
        } else {
          failed += 1
          if (rt.state.error || failed >= 2) return { done, failed, total, stopped: true, error: text(rt.state.error) }
        }
      }
    }
    return { done, failed, total, stopped: false }
  }

  async function asDataUrl(url) {
    if (/^data:image\//.test(url)) return url
    const blob = await (await root.fetch(url)).blob()
    return await new Promise((resolve, reject) => { const reader = new root.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob) })
  }

  function mount({ leftHost, onOpen }) {
    const doc = leftHost.ownerDocument, accordion = root.NovaFlowLeftPanelAccordion
    let library = loadLibrary(), picks = new Set(read(PICK_KEY, []).filter(name => library.some(item => item.name === name)))
    let opened = false, editing = false, busy = null, destroyed = false
    const make = (tag, value, attrs = {}) => { const node = doc.createElement(tag); if (value) node.textContent = value; for (const [key, v] of Object.entries(attrs)) node.setAttribute(key, v); return node }
    const panel = make('section', '', { class: 'nf-panel', 'data-foart-ui-theme-switch': '1', 'data-open': '0' }); Object.assign(panel.style, accordion.panelStyle())
    const header = make('button', '', { type: 'button', class: 'nf-panel-header' }); Object.assign(header.style, accordion.headerStyle(false))
    const title = make('span'); Object.assign(title.style, accordion.titleStyle())
    const icon = make('i', '', { class: 'fas fa-palette' }); Object.assign(icon.style, accordion.iconStyle())
    const label = make('span', '主题切换'); Object.assign(label.style, accordion.labelStyle()); title.append(icon, label); header.append(title)
    const arrow = make('i', '', { class: accordion.chevronClass(false) }); Object.assign(arrow.style, accordion.chevronStyle()); header.append(arrow)
    const body = make('div', '', { class: 'nf-panel-body' }); Object.assign(body.style, accordion.bodyStyle(false))
    panel.append(header, body)

    const hint = make('div', '添加一张或多张界面图，选几个主题，一次生成全部。默认按主题从零重新设计（由小桃所选在线模型先读出界面功能）；同一主题的多张界面画风统一。'); Object.assign(hint.style, { color: '#999', fontSize: '11px', lineHeight: '1.5' })
    const chips = make('div', '', { 'data-foart-ui-theme-chips': '1' }); Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' })
    const editor = make('div', '', { 'data-foart-ui-theme-editor': '1' }); Object.assign(editor.style, { display: 'none', gap: '8px' })
    const customRow = make('div'); Object.assign(customRow.style, { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px' })
    const field = (placeholder, multi = false) => { const node = make(multi ? 'textarea' : 'input', '', { placeholder, spellcheck: 'false' }); Object.assign(node.style, { width: '100%', minWidth: '0', boxSizing: 'border-box', background: '#1f1f1f', color: '#ddd', border: '1px solid #3a3a3a', borderRadius: '5px', padding: '6px 8px', fontSize: '12px', outline: 'none', resize: multi ? 'vertical' : 'none', ...(multi ? { minHeight: '52px', lineHeight: '1.5', fontFamily: 'inherit' } : { height: '30px' }) }); return node }
    const custom = field('自定义主题，如：水墨武侠、像素复古')
    const keepRow = make('label'); Object.assign(keepRow.style, { display: 'flex', alignItems: 'center', gap: '6px', color: '#bbb', fontSize: '12px', cursor: 'pointer' })
    const keep = make('input', '', { type: 'checkbox' }); keep.checked = read('foart.ui.theme-keep-text.v1', true) !== false
    keepRow.append(keep, make('span', '保留原文字和数字'))
    const layoutRow = make('label'); Object.assign(layoutRow.style, { display: 'flex', alignItems: 'center', gap: '6px', color: '#bbb', fontSize: '12px', cursor: 'pointer' })
    const keepLayout = make('input', '', { type: 'checkbox' }); keepLayout.checked = read('foart.ui.theme-keep-layout.v1', false) === true
    layoutRow.append(keepLayout, make('span', '保持原布局（只换皮）'))
    keepLayout.addEventListener('change', () => write('foart.ui.theme-keep-layout.v1', keepLayout.checked))
    const note = field('补充要求（可选），如：人物换成女性、整体更亮', true)
    const status = make('div', ''); Object.assign(status.style, { color: '#aaa', fontSize: '11px', lineHeight: '1.5', minHeight: '16px' })
    const actions = make('div'); Object.assign(actions.style, { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px' })
    function button(value, action, primary = false) {
      const node = make('button', value, { type: 'button', 'data-foart-action': primary ? 'primary' : 'neutral' })
      Object.assign(node.style, { minWidth: '0', height: '30px', boxSizing: 'border-box', padding: '0 10px', border: '0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' })
      node.addEventListener('click', () => { try { Promise.resolve(action()).catch(error => message(error.message, true)) } catch (error) { message(error.message, true) } })
      return node
    }
    const addCustom = button('添加', () => {
      const name = text(custom.value).slice(0, 40); if (!name) return
      if (!library.some(item => item.name === name)) library.push({ name, description: '' })
      picks.add(name); custom.value = ''; save(); render()
    })
    customRow.append(custom, addCustom)
    const go = button('生成', start, true), manage = button('编辑主题', () => { editing = !editing; render() })
    actions.append(go, manage)
    body.append(hint, chips, customRow, editor, keepRow, layoutRow, note, actions, status)
    custom.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCustom.click() } })
    keep.addEventListener('change', () => write('foart.ui.theme-keep-text.v1', keep.checked))

    const message = (value, error = false) => { status.textContent = value; status.style.color = error ? '#fca5a5' : '#aaa' }
    const save = () => { write(STORE_KEY, library); write(PICK_KEY, [...picks]) }
    // The panel keeps its own screens: the generation dock is closed while this panel is open.
    let screenList = []
    const screens = () => screenList
    const shelf = make('div', '', { 'data-foart-ui-theme-screens': '1' }); Object.assign(shelf.style, { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '6px' })
    const picker = make('input', '', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: '' }); picker.style.display = 'none'
    const addScreen = make('button', '', { type: 'button', 'data-foart-ui-theme-add': '1', title: '添加界面图（可多选，也可拖入）' })
    Object.assign(addScreen.style, { aspectRatio: '1', minWidth: '0', border: '1px dashed #444', borderRadius: '6px', background: 'transparent', color: '#999', fontSize: '11px', cursor: 'pointer', display: 'grid', placeItems: 'center', lineHeight: '1.4' })
    addScreen.textContent = '+\n添加界面图'; addScreen.style.whiteSpace = 'pre'
    addScreen.addEventListener('click', () => { if (!busy) picker.click() })
    async function addFiles(files) {
      for (const file of [...files || []].filter(file => /^image\/(png|jpeg|webp)$/.test(file.type))) {
        const dataUrl = await new Promise((resolve, reject) => { const reader = new root.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
        const size = await imageSize(dataUrl)
        screenList.push({ id: 'ui-theme-screen-' + Date.now().toString(36) + screenList.length, name: file.name, dataUrl, ...size })
      }
      render()
    }
    picker.addEventListener('change', () => { addFiles(picker.files).catch(error => message(error.message, true)); picker.value = '' })
    for (const type of ['dragover', 'drop']) shelf.addEventListener(type, event => {
      if (!event.dataTransfer?.types?.includes?.('Files')) return
      event.preventDefault(); event.stopPropagation()
      if (type === 'drop' && !busy) addFiles(event.dataTransfer.files).catch(error => message(error.message, true))
    })
    function thumb(item) {
      const cell = make('div'); Object.assign(cell.style, { position: 'relative', aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', background: '#1b1b1b' })
      const image = make('img', '', { alt: item.name, draggable: 'false' }); image.src = item.dataUrl; Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'contain' })
      const remove = make('button', '×', { type: 'button', title: '移除', 'data-foart-ui-theme-remove': '1' })
      Object.assign(remove.style, { position: 'absolute', top: '2px', right: '2px', width: '18px', height: '18px', padding: '0', border: '0', borderRadius: '9px', background: 'rgba(0,0,0,.6)', color: '#ddd', fontSize: '12px', lineHeight: '18px', cursor: 'pointer' })
      remove.addEventListener('click', () => { if (busy) return; screenList = screenList.filter(entry => entry !== item); render() })
      cell.append(image, remove); return cell
    }
    hint.after(shelf)

    function chip(item) {
      // The brand skin draws particle chips and their pressed state; only the attributes are ours.
      const on = picks.has(item.name), node = make('button', item.name, { type: 'button', 'data-foart-theme-chip': '1', 'data-novaflow-particle-chip': '1', 'aria-pressed': on ? 'true' : 'false', title: item.description || item.name })
      Object.assign(node.style, { height: '26px', padding: '0 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' })
      node.addEventListener('click', () => { if (busy) return; on ? picks.delete(item.name) : picks.add(item.name); save(); render() })
      return node
    }
    function editorRow(item, index) {
      const row = make('div'); Object.assign(row.style, { display: 'grid', gap: '4px', paddingBottom: '8px', borderBottom: '1px solid #2c2c2c' })
      const top = make('div'); Object.assign(top.style, { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px' })
      const name = field('主题名'); name.value = item.name
      const remove = button('删除', () => { picks.delete(item.name); library.splice(index, 1); save(); render() })
      const description = field('画面描述：场景、材质、人物、配色、光线', true); description.value = item.description
      name.addEventListener('change', () => { const next = text(name.value).slice(0, 40); if (!next) { name.value = item.name; return } if (picks.delete(item.name)) picks.add(next); item.name = next; save(); render() })
      description.addEventListener('change', () => { item.description = text(description.value).slice(0, 600); save() })
      top.append(name, remove); row.append(top, description); return row
    }
    function render() {
      if (destroyed) return
      panel.setAttribute('data-open', opened ? '1' : '0')
      Object.assign(header.style, accordion.headerStyle(opened)); Object.assign(body.style, accordion.bodyStyle(opened))
      arrow.className = accordion.chevronClass(opened)
      body.style.display = opened ? 'grid' : 'none'; body.style.gap = '10px'
      shelf.replaceChildren(...screenList.map(thumb), addScreen, picker)
      chips.replaceChildren(...library.map(chip))
      editor.style.display = editing ? 'grid' : 'none'
      if (editing) editor.replaceChildren(...library.map(editorRow), button('恢复默认主题', () => { library = DEFAULT_THEMES.map(item => ({ ...item })); picks = new Set([...picks].filter(name => library.some(item => item.name === name))); save(); render() }))
      manage.textContent = editing ? '完成' : '编辑主题'
      const count = screens().length * picks.size
      go.textContent = busy ? '停止' : count ? `生成 ${count} 张` : '生成'
      go.setAttribute('data-foart-action', busy ? 'neutral' : 'primary')
    }
    async function start() {
      if (busy) { busy.abort(); message('将在当前这张完成后停止'); return }
      const list = screens(), themes = library.filter(item => picks.has(item.name))
      if (!list.length) throw new Error('请先在下方添加界面图')
      if (!themes.length) throw new Error('请至少选择一个主题')
      busy = new AbortController(); render()
      try {
        const outcome = await runBatch({ screens: list, themes, keepText: keep.checked, keepLayout: keepLayout.checked, note: note.value, signal: busy.signal, onProgress: value => message(value) })
        message(outcome.stopped ? `已生成 ${outcome.done}/${outcome.total} 张，已停止${outcome.error ? '：' + outcome.error : ''}` : `已生成 ${outcome.done} 张，已放入结果列表`, outcome.failed > 0)
      } finally { busy = null; render() }
    }
    header.addEventListener('click', () => { opened = !opened; if (opened) onOpen?.(); render() })
    const onOtherPanel = event => { if (event.target.closest?.('.nf-panel-header') && !panel.contains(event.target) && opened) { opened = false; render() } }
    leftHost.addEventListener('click', onOtherPanel, true)
    let lastCount = -1
    function sync() {
      if (destroyed) return
      const active = leftHost.getAttribute('data-psd-fusion-ui') === '1'
      panel.style.display = active ? '' : 'none'
      const generate = leftHost.querySelector('[data-novaflow-spine-split-control-category="generate"]')
      if (generate && active) {
        const layout = leftHost.querySelector('[data-novaflow-ui-layout-section]') || generate
        if (panel.previousElementSibling !== layout) layout.after(panel)
      }
      const count = screens().length
      if (count !== lastCount) { lastCount = count; render() }
    }
    render()
    return { sync, destroy() { destroyed = true; busy?.abort(); leftHost.removeEventListener('click', onOtherPanel, true); panel.remove() } }
  }

  root.FoartUiThemeSwitch = Object.freeze({ DEFAULT_THEMES, buildPrompt, outputSize, readInventory, runBatch, mount })
})(typeof window !== 'undefined' ? window : globalThis)
