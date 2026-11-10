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
    ['赛博朋克', '主色明亮的电光青与洋红霓虹，点缀柠檬黄，夜色是通透的深蓝紫而不是黑；霓虹雨夜都市与全息广告牌为背景，大面积发光把画面照亮；面板是半透明玻璃与亮银拉丝金属，边缘发光；按钮是发光的全息玻璃；符号做成芯片、机械义眼、能量电池、霓虹徽章，字母是发光灯管字；人物是机械义体战士与黑客，带发光纹路；画面有扫描线、霓虹倒影和光粒'],
    ['埃及神话', '主色黄金配青金石蓝与绿松石，夕阳金字塔、神庙巨柱与尼罗河为背景；面板是黄金浮雕嵌宝石边框，满布象形文字与圣甲虫纹样；符号做成法老面具、荷鲁斯之眼、圣甲虫、安卡十字、眼镜蛇，字母为黄金镶宝石；人物是法老、艳后与胡狼神祭司，穿金饰与亚麻长袍；画面有金色神光和沙尘光束'],
    ['海盗冒险', '主色深海蓝配金币黄与船木棕，暴风海面、骷髅旗大帆船与宝藏岛为背景；面板是旧船木加黄铜包角与麻绳；按钮是罗盘与舵轮；符号做成金币、宝箱、骷髅、弯刀、朗姆酒瓶、藏宝图，字母是黄铜铸字；人物是船长、女海盗与水手，戴三角帽与眼罩；画面有浪花飞溅和金币闪光'],
    ['糖果乐园', '主色草莓粉、薄荷绿、柠檬黄的高饱和糖果色，糖果城堡、棒棒糖树与奶油云为背景；面板是果冻与糖霜质感嵌彩色糖粒；按钮是软糖与马卡龙；符号做成棒棒糖、甜甜圈、马卡龙、草莓蛋糕、彩虹糖，字母是透亮硬糖；人物换成可爱糖果精灵与甜点师，穿糖果色服装；画面有亮晶晶糖粉闪光'],
    ['暗黑哥特', '主色宝石红与亮金，配月光银蓝，暗部是通透的深紫红而不是死黑；月下古堡与彩绘玻璃窗为背景，彩窗透出明亮的彩色光；面板是雕花银与亮金镶红宝石，尖拱哥特边框；符号做成血月、蝙蝠、银十字、毒药瓶、玫瑰与骷髅，字母为亮金哥特体；人物是吸血鬼伯爵、女巫与圣骑士；画面有烛光、月光和红宝石的发光对比'],
    ['太空科幻', '主色明亮的天空蓝与珍珠白，点缀亮橙能量光，背景是明亮多彩的星云与行星环；面板是光洁的白色流线装甲嵌发光蓝色灯带；按钮是全息圆盘；符号做成星球、飞船、能量核心、外星晶体、机甲头盔，字母为发光金属；人物是宇航员、机甲驾驶员与外星使者；画面有能量光束和星尘粒子，整体通透明亮'],
    ['北欧神话', '主色明亮的冰蓝与雪白，配亮金与极光绿，背景是阳光下的雪山峡湾与绚丽极光；面板是亮金与浅色符文石雕刻，配白狼毛；符号做成雷神之锤、维京头盔、符文石、渡鸦、角杯，字母为刻符亮金；人物是维京战士、女武神与雷神；画面有极光、闪电与飘雪的明亮光效'],
    ['日式和风', '主色明亮的朱红与樱花粉，配亮金箔与天青，背景是阳光下的樱花神社、鸟居与晴空；面板是朱漆木框嵌金箔与家纹；按钮是和纸扇与铜镜；符号做成招财猫、武士刀、折扇、樱花、狐面，字母为金箔书法体；人物是武士、巫女与狐仙；画面有樱花飘落和温暖明亮的阳光'],
    ['蒸汽朋克', '主色明亮的抛光黄铜金与琥珀橙，配孔雀绿玻璃点缀，背景是金色夕阳下的齿轮钟塔与飞艇城市；面板是闪亮的黄铜铆钉框配透亮的玻璃仪表；按钮是压力表与齿轮；符号做成齿轮、怀表、护目镜、机械鸟、蒸汽阀，字母为黄铜铸字；人物是发明家、飞艇女船长与机械骑士；画面有蒸汽、金色光柱与暖亮灯光'],
    ['丛林遗迹', '主色翡翠绿配黄金与古石灰，热带雨林、瀑布与玛雅金字塔遗迹为背景；面板是长满藤蔓的石雕嵌黄金；符号做成黄金面具、翡翠头骨、豹子、羽蛇、宝石图腾，字母为黄金石刻；人物是探险家、部落祭司与女战士；画面有阳光光柱与萤火'],
    ['冰雪圣诞', '主色圣诞红配松绿、金色与冰晶白，雪夜小镇、圣诞树与极光为背景；面板是冰晶边框配红丝带与金铃；按钮是礼物盒与雪花；符号做成礼物、铃铛、姜饼人、拐杖糖、雪人，字母为冰雕金边；人物是圣诞老人、精灵与雪之公主；画面有飘雪与暖色窗光'],
].map(([name, description]) => Object.freeze({ name, description })))

  // 质感、氛围感、精度 each get their own concrete line (Dylan, 2026-11-08); a single
  // "high quality" sentence left results plain.
  const QUALITY_ZH = Object.freeze([
    '质感：每种材质都要画出真实可信的表面——金属有拉丝或錾刻纹理和锐利高光，宝石和玉石通透有内部折射和高光点，木、石、织物有清晰纹理和磨损，珐琅、玻璃、糖霜等有各自的光泽；面板和按钮有厚度、倒角、多层浮雕和描边，不是平涂色块。',
    '氛围感：整屏一个统一的主光源和明确的冷暖对比，背景有纵深、雾气和体积光，前景有主题粒子、光尘或飘落物，角色和关键元素有轮廓光；画面有情绪和故事感，像游戏宣传主视觉。',
    '精度：线条和边缘干净锐利，图标轮廓清楚，文字笔画完整清晰，对称件左右一致，同类按钮和格子大小统一、对齐整齐，细节丰富但不糊不脏，没有扭曲、错位和多余的零件。',
    '配色：全屏一套统一的主题色板——主色约六成、辅色约三成、点缀色约一成，点缀色用于按钮高光、宝石和关键数值；同一类控件同色同质，暗部偏冷、亮部偏暖，局部用柔和渐变过渡，不出现与主题无关的杂色。',
    '高级感与精致度：像一线大厂商业手游的正式美术稿——细描金线和多层倒角收边、精细的纹样与浮雕、柔和的内发光和投影、恰到好处的留白；装饰繁而不乱，层次分明，所有边角和细节都精修过。',
    '整体是顶级手游的高品质主视觉：色彩鲜艳浓郁而统一、对比强烈、精修收尾。不要灰暗、不要素淡、不要平涂、不要塑料感、不要廉价的高饱和杂色。',
  ])
  const QUALITY_EN = Object.freeze([
    'Material quality: every material has a believable surface - metal with brushed or engraved texture and crisp speculars, gems and jade translucent with inner refraction and glints, wood, stone and cloth with clear grain and wear, enamel, glass and frosting with their own sheen; panels and buttons have thickness, bevels, layered relief and trims, never flat fills.',
    'Atmosphere: one key light with a clear warm/cool contrast across the screen, depth, haze and volumetric light in the background, theme particles, light dust or falling things in the foreground, rim light on characters and key elements; the screen carries mood and story like game key art.',
    'Precision: clean sharp lines and edges, crisp icon silhouettes, complete legible lettering, symmetric pieces mirror exactly, buttons and cells of one kind share size and alignment, rich detail without mush, no warping, misalignment or stray parts.',
    'Colour: one unified theme palette across the screen - main colour about 60%, secondary about 30%, accent about 10% reserved for button highlights, gems and key values; controls of one kind share colour and material; cool shadows, warm lights, soft gradients, no stray colours outside the theme.',
    'Visual hierarchy: one hero visual (the characters and scene) carries the picture; the functional area is a calm, flat, low-contrast field in one or two theme colours so the controls read instantly; ornament lives only on the hero and on a few framing accents, never on every edge, cell or button; symbols are simple, bold icons on quiet cells, not small paintings; buttons share one plain design with one accent on the main action.',
    'Overall: top-tier mobile game key art, unified colour, strong but controlled contrast, polished finish, elegant rather than busy. Never dull, washed-out, flat, plastic, cheaply oversaturated or cluttered; no decorative clutter around the controls.',
  ])
  // 多种排版: besides following the source layout, each theme is also drawn in these
  // compositions. They name no genre, so they fit lobbies, shops and HUDs as well as slots.
  const ARRANGEMENTS = Object.freeze([
    Object.freeze({ name: '角色在侧', zh: '排版方式：主角色大幅立于画面一侧，约占一侧三分之一宽、从上到下贯穿；功能区、面板和按钮集中在另一侧与底部，形成不对称、有动势的构图。', en: 'Arrangement: the main character stands large along one side, about a third of the width, top to bottom; the functional panels and buttons gather on the other side and along the bottom in an asymmetric, dynamic composition.' }),
    Object.freeze({ name: '主视觉在上', zh: '排版方式：上方约三分之一是大幅主题主视觉（角色群像、场景和不带文字的徽记），下方是整齐紧凑的功能区，功能区上沿用主题边框与主视觉衔接。', en: 'Arrangement: the top third is a large theme key visual (character group, scene and an emblem without lettering); below it the functional area sits compact and orderly, joined to the key visual by a theme border.' }),
    Object.freeze({ name: '中心舞台', zh: '排版方式：功能区居中，四周由主题建筑、道具和装饰组成华丽的环绕框体，角色分布在左右两侧和框体上，像一座舞台。', en: 'Arrangement: the functional area sits in the centre inside an ornate surround of theme architecture, props and ornament; characters stand on both sides and on the frame, like a stage.' }),
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
  function buildPrompt({ theme, keepText = true, keepLayout = false, note = '', anchored = false, provider = 'gpt', inventory = '', sketched = false, arrangement = null } = {}) {
    const name = text(theme?.name), description = text(theme?.description), extra = text(note)
    if (!name) throw new Error('请选择主题')
    if (!keepLayout) return redesignPrompt({ name, description, keepText, extra, inventory, anchored, provider, sketched, arrangement })
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
  function redesignPrompt({ name, description, keepText, extra, inventory, anchored, provider, sketched = false, arrangement = null }) {
    const list = text(inventory)
    if (!list) throw new Error('缺少界面功能清单')
    const style = sketched ? 2 : 1
    // Grid wording only when the screen has a grid: a lobby must not grow a symbol board.
    const hasGrid = /横向每行\s*\d+\s*个/.test(list)
    const hasCast = /角色区|人物区|立绘|个角色|主角/.test(list)
    if (provider === 'local') return [
      `为「${name}」主题从零设计一张全新的游戏界面${description ? `：${description}` : ''}。`,
      `界面功能清单（只决定有哪些功能、数量和文字，不决定外观）：\n${list}`,
      arrangement
        ? `${arrangement.zh}清单只决定有哪些功能、数量和文字，方括号里的原图位置不用照搬；清单里的每个按钮、信息条和数值都要有，清单里没有的功能区不要添加。${hasGrid ? '网格的每行个数和行数仍按清单。' : '画面里不要出现清单之外的格子、背包格或物品网格。'}`
        : `各区域的位置和大小按清单方括号里的原图位置；清单里的每个按钮、信息条和数值都要有，清单里没有的功能区不要添加。${hasGrid ? '网格严格按清单的每行个数和行数（横向每行几个、纵向共几行，数清楚，不多不少）。' : ''}${hasCast ? '角色直接站在背景场景里，画完整的角色立绘，角色区不加边框、不做面板，也绝不分成格子或头像框；整屏只有功能区有框。' : ''}`,
      keepText ? '只把清单中引号里的原文文字和数字写进画面，逐字照抄；区域名、说明和括号里的注释不要写进画面；标为“图标，无文字”的按钮只画图标。' : '数字和按钮文字按清单写；标题和装饰文字可按主题改写；区域名和注释不要写进画面。',
      '清单里标【显示】的信息条、数值框、公告栏画成嵌在面板里的扁平显示区（凹槽、铭牌或横幅），不能画成按钮；只有标【按钮】的才画成可点击、有厚度和高光的按钮；【按钮】【显示】只是类型标注，不要写进画面。',
      `整屏构图、面板与按钮造型${hasCast ? '、角色设定和姿态' : ''}全部根据「${name}」主题创作：面板和按钮是有厚度的主题异形雕刻件，不是矩形圆角块，边框和装饰结构按主题设计${hasGrid ? '；网格装进主题造型的大框体，每个格子里的符号都是独特的主题物件' : ''}；${hasCast ? '角色是为主题原创、有魅力的人物，动态姿势，' : ''}融入有纵深的主题场景。`,
      ...QUALITY_ZH,
      sketched ? '图1是灰色布局草图：只按它的区块位置、大小、格子行列数和按钮个数排版，块里的白字就是该处要写的原文；人形剪影处画完整的角色立绘，站在开阔的背景场景里，不加框、不做面板、不画格子。灰色块只是占位，最终画面里不能出现灰色块，全部画成完整的主题美术。' : '',
      anchored ? `图${style}是同一套「${name}」主题已完成的另一张界面：画风、配色、材质、框体和按钮设计与它保持一致，但功能和布局按本清单，不照搬它的布局。` : '',
      extra ? `用户补充要求：${extra}` : '',
    ].filter(Boolean).join('\n')
    return [
      `Design a completely new game UI screen from zero in the theme "${name}"${description ? `: ${description}` : ''}.`,
      `Function list of the screen (it decides only which functions, counts and words exist, never the look):\n${list}`,
      arrangement
        ? `${arrangement.en} The list decides only which functions, counts and words exist; ignore the source positions in square brackets; every listed button, info bar and value is present and nothing unlisted is added.${hasGrid ? ' Grids keep the listed per-row count and rows.' : ' No grid, inventory slots or item board that the list does not name.'}`
        : `Regions take the positions and sizes in the square brackets of the list; every listed button, info bar and value is present and nothing unlisted is added.${hasGrid ? ' Grids have exactly the listed per-row count and rows (count them).' : ''}${hasCast ? ' Characters stand directly in the background scene as full character art; their area has no frame or panel and is never split into cells or portrait frames; only the functional areas are framed.' : ''}`,
      keepText ? 'Write on the screen only the quoted words and numbers from the list, copied exactly; never write region names, notes or bracketed remarks; a button marked as icon-only gets an icon and no words.' : 'Write numbers and button labels from the list; titles and decorative words may be rewritten for the theme; never write region names or notes.',
      'Items tagged 【显示】 (info bars, value boxes, notice banners) are flat read-outs set into the panel (recessed slots, plaques or banners), never buttons; only items tagged 【按钮】 are clickable buttons with thickness and highlights; the tags themselves are never written on the screen.',
      `Composition, panel and button shapes${hasCast ? ', characters and their poses' : ''} are all designed for "${name}": panels and buttons are thick sculpted theme pieces, not rounded rectangles, with borders and ornament structures of the theme${hasGrid ? '; the grid sits inside one clean theme-shaped frame and every cell holds a distinctive theme object' : ''}; ${hasCast ? 'characters are original, charismatic, in dynamic poses, ' : ''}inside a deep theme scene. Keep the screen calm and readable: one hero visual, plain background behind the controls, at most two materials across all controls, no scattered trinkets, particles or extra ornaments around the functional area.`,
      ...QUALITY_EN,
      sketched ? 'Image 1 is a grey layout sketch: place regions, sizes, grid rows and columns and button counts exactly as it shows; the white words in a box are the text that goes there; the figure silhouettes mark where full characters stand in an open background scene, with no frame, panel or cells there. The grey boxes are placeholders only and must all become finished theme art, no grey box may remain.' : '',
      anchored ? `Image ${style} is another finished screen of this same "${name}" set: match its art style, palette, materials, frames and buttons, but follow this list for functions and layout.` : '',
      extra ? `Additional request from the user (follow it): ${extra}` : '',
    ].filter(Boolean).join('\n')
  }


  // A neutral grey layout sketch drawn from the function list: region bands at their listed
  // share of the height, the grid as N x M cells, button rows as one box per listed item, the
  // character area as an empty panel. It carries counts and positions only - no face, pose,
  // colour or style of the source - so img2img can lock the layout while the theme draws.
  function sketchPlan(inventory) {
    const lines = text(inventory).split(/\n+/).map(text).filter(Boolean)
    const bands = []
    for (const line of lines) {
      // A region's real place on the source: ［左,上,宽,高］ in percent of the screen.
      const boxMatch = /[［\[]\s*(\d{1,3})\s*[,，]\s*(\d{1,3})\s*[,，]\s*(\d{1,3})\s*[,，]\s*(\d{1,3})\s*[］\]]/.exec(line)
      const box = boxMatch ? boxMatch.slice(1, 5).map(Number) : null
      const validBox = box && box[2] > 0 && box[3] > 0 && box[0] + box[2] <= 101 && box[1] + box[3] <= 101 ? box : null
      const share = validBox ? validBox[3] : Number((/约占[^%0-9]{0,6}(\d{1,3})\s*%/.exec(line) || [])[1])
      if (!(share > 0)) continue
      const grid = /横向每行\s*(\d{1,2})\s*个[^纵]{0,8}纵向共?\s*(\d{1,2})\s*行/.exec(line)
      // Item lists run left to right (a row) or top to bottom (a column of buttons).
      const order = /从左到右/.test(line) ? '从左到右' : /从上到下/.test(line) ? '从上到下' : ''
      const list = order ? line.split(new RegExp(order + '[为是：:]?'))[1].replace(/（[^）]*）|\([^)]*\)/g, '').split(/[、，,]|(?<=”)\s*(?=[“【])|(?=【)/).map(text).filter(item => item && !/^【[^】]*】$/.test(item)) : []
      const items = list.length
      const kind = grid ? 'grid' : items > 1 ? (order === '从上到下' ? 'column' : 'row') : /角色区|人物区|立绘|个角色|主角/.test(line) && !/按钮/.test(line) ? 'cast' : 'bar'
      const label = text(line.split(/[（(：:［\[]/)[0]).slice(0, 20) || '区域'
      bands.push({ share, box: validBox, kind, label, text: line.replace(/[［\[][^］\]]*[］\]]/, '').slice(0, 200), items: list, cols: grid ? Number(grid[1]) : kind === 'column' ? 1 : items, rows: grid ? Number(grid[2]) : kind === 'column' ? items : 1 })
    }
    return bands.length >= 2 ? bands : null
  }
  // 【显示】 items are read-outs (balances, banners, notices), never buttons.
  const isDisplay = item => /【显示】/.test(item || '') || /^(?:显示|信息|数值|公告)/.test(text(item))
  const itemPurpose = item => { const clean = text(item).replace(/【[^】]*】/g, ''); return isDisplay(item) ? `${clean}（显示框，不是按钮）` : clean }
  // Blocks for 布局编辑: one per grid cell, button and bar, plus the character panel.
  function sketchBlocks(plan, width, height) {
    const total = plan.reduce((sum, band) => sum + band.share, 0), blocks = []
    const pad = Math.round(width * .04), gap = Math.max(4, Math.round(width * .012)), top = Math.round(height * .02), usable = height - top * 2
    const add = (name, purpose, x, y, w, h) => blocks.push({ name, purpose, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), width: Math.max(32, Math.round(w)), height: Math.max(24, Math.round(h)) })
    const placed = plan.every(band => band.box)
    let y = top
    for (const band of plan) {
      const h = Math.round(usable * band.share / total)
      // Read boxes put each region where it is on the source; otherwise stack by share.
      const [bx, by, bw, bh] = placed ? [band.box[0] / 100 * width, band.box[1] / 100 * height, band.box[2] / 100 * width, band.box[3] / 100 * height] : [pad, y, width - pad * 2, h - gap]
      if (band.kind === 'grid') {
        const cw = (bw - gap * (band.cols + 1)) / band.cols, ch = (bh - gap * (band.rows + 1)) / band.rows
        for (let r = 0; r < band.rows; r++) for (let c = 0; c < band.cols; c++) add(`符号格 ${r + 1}-${c + 1}`, `符号盘第 ${r + 1} 行第 ${c + 1} 个符号`, bx + gap + c * (cw + gap), by + gap + r * (ch + gap), cw, ch)
      } else if (band.kind === 'row') {
        const cw = (bw - gap * (band.cols - 1)) / band.cols
        for (let c = 0; c < band.cols; c++) add(`${band.label} ${c + 1}`, `${band.label}从左到右第 ${c + 1} 个：${itemPurpose(band.items[c])}`, bx + c * (cw + gap), by, cw, bh)
      } else if (band.kind === 'column') {
        const ch = (bh - gap * (band.rows - 1)) / band.rows
        for (let r = 0; r < band.rows; r++) add(`${band.label} ${r + 1}`, `${band.label}从上到下第 ${r + 1} 个：${itemPurpose(band.items[r])}`, bx, by + r * (ch + gap), bw, ch)
      } else add(band.label, /【显示】/.test(band.text) && !/【按钮】/.test(band.text) ? `${band.text}（显示区，不是按钮）` : band.text, bx, by, bw, bh)
      y += h
    }
    return blocks.map(block => ({ ...block, width: Math.min(block.width, width - block.x), height: Math.min(block.height, height - block.y) }))
      .filter(block => block.width >= 32 && block.height >= 24).slice(0, 40)
  }
  function drawSketch(plan, width, height, documentRef = root.document) {
    return drawBlocks(sketchBlocks(plan, width, height), width, height, documentRef)
  }
  function drawBlocks(blocks, width, height, documentRef = root.document) {
    const canvas = documentRef.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#7a7a7a'; ctx.fillRect(0, 0, width, height)
    for (const block of blocks) {
      // Characters stand in the open scene: a panel drawn for them came back as a second frame,
      // and an empty area came back filled with more grid cells. Simple figure silhouettes say
      // "people stand here" without a frame. 布局编辑 blocks carry the name only in purpose.
      const label = `${block.name || ''} ${block.purpose || ''}`
      if (/角色区|人物区|立绘|个角色|主角/.test(label)) {
        const count = Math.max(1, Math.min(6, Number((/(\d)\s*个角色/.exec(label) || [])[1]) || 1))
        const slot = block.width / count, figureH = block.height * .92, headR = Math.min(slot * .18, figureH * .09)
        ctx.fillStyle = '#8e8e8e'
        for (let k = 0; k < count; k++) {
          const cx = block.x + slot * (k + .5), top = block.y + block.height - figureH
          ctx.beginPath(); ctx.arc(cx, top + headR, headR, 0, Math.PI * 2); ctx.fill()
          const bodyW = Math.min(slot * .62, headR * 4.2), bodyTop = top + headR * 2.2
          ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx - bodyW / 2, bodyTop, bodyW, block.y + block.height - bodyTop, headR) : ctx.rect(cx - bodyW / 2, bodyTop, bodyW, block.y + block.height - bodyTop); ctx.fill()
        }
        continue
      }
      ctx.fillStyle = /不是按钮/.test(block.purpose) ? '#636363' : '#a8a8a8'; ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(block.x, block.y, block.width, block.height, Math.min(block.width, block.height) * .12) : ctx.rect(block.x, block.y, block.width, block.height); ctx.fill()
      // The block's own words are written into it, so the picture model copies them instead
      // of guessing what a blank box says (blank boxes came out as garbled text).
      const words = [...String(block.purpose || '').matchAll(/“([^”]{1,40})”/g)].map(match => match[1]).join(' ')
      if (!words) continue
      let size = Math.max(10, Math.min(block.height * .42, block.width * .9 / Math.max(2, words.length * .62)))
      ctx.font = `bold ${Math.round(size)}px sans-serif`
      while (size > 10 && ctx.measureText(words).width > block.width * .88) { size -= 1; ctx.font = `bold ${Math.round(size)}px sans-serif` }
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(words, block.x + block.width / 2, block.y + block.height / 2)
    }
    return canvas.toDataURL('image/png')
  }
  // The layout lives in 布局编辑: a layout the user already has there is used as it is;
  // otherwise the screen's function list is turned into editable blocks there first.
  // Which layout this panel built, and for which screen; kept across reloads so an old
  // automatic layout is never taken for one the user made.
  const AUTO_LAYOUT_KEY = 'foart.ui.theme-auto-layout.v1'
  const fingerprint = value => value ? value.length + ':' + value.slice(-64) : ''
  // 布局编辑 keeps its blocks in the saved project, but its layout picture is only a reference
  // of the current page; after a reload the blocks are there and the picture is not. Applying
  // blocks again would add a second set, so the saved blocks are drawn instead.
  function projectLayout() {
    try {
      const saved = JSON.parse(root.localStorage.getItem('novaflow-ui-design-project-v1') || 'null')
      const node = saved?.project?.graph?.nodes?.find(item => item?.type === 'layout')
      const blocks = Array.isArray(node?.data?.blocks) ? node.data.blocks : []
      const size = node?.data?.canvasSize
      return blocks.length && size?.width > 0 && size?.height > 0 ? { blocks, width: size.width, height: size.height, key: blocks.length + ':' + blocks.map(block => block.id).join(',').slice(0, 400) } : null
    } catch { return null }
  }
  function scaledBlocks(layout, width, height) {
    const sx = width / layout.width, sy = height / layout.height
    return layout.blocks.map(block => ({ ...block, x: block.x * sx, y: block.y * sy, width: block.width * sx, height: block.height * sy }))
  }
  function editorLayout(rt) {
    const ref = (rt.references?.() || []).find(item => item?.uiLayoutId && item.dataUrl)
    return ref ? { dataUrl: ref.dataUrl, width: ref.width, height: ref.height, structure: ref.uiStructure || null } : null
  }
  function layoutIntoEditor(rt, plan, size) {
    const bridge = root.NovaFlowUiDesignBridge
    if (typeof bridge?.applyAgentLayout !== 'function') return null
    bridge.applyAgentLayout({ width: size.width, height: size.height, blocks: sketchBlocks(plan, size.width, size.height) })
    return editorLayout(rt)
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
  // GPT reads the size as an aspect ratio plus a 2K tier. A local run that follows a layout guide
  // stays at 1536 (2048 repeated grid rows there); a free composition draws at 2048, where it
  // came out richer (A/B 2026-11-10).
  function outputSize(provider, width, height, locked = false) {
    const longEdge = provider === 'gpt' || !locked ? 2048 : 1536
    const scale = longEdge / Math.max(width, height)
    const snap = value => Math.max(256, Math.round(value * scale / 16) * 16)
    return { width: snap(width), height: snap(height) }
  }

  // Local runs: CFG 2.5 with a negative prompt was the one knob that lifted finish without
  // breaking the layout (A/B 2026-11-09: 2048 px broke grids, CFG 1 stayed flat).
  const LOCAL_THEME_CFG = 2.5
  const LOCAL_THEME_NEGATIVE = '模糊，脏污，灰暗，平涂，塑料感，扭曲，错位，多余的格子，多余的边框，文字乱码'
  const STATE_KEYS = ['mode', 'provider', 'randomSeed', 'seed', 'loras', 'samplingOverrides', 'localTextQuality', 'localEditStrength', 'localQwen21Variant', 'localDrawEngine', 'googleResolution']
  async function preparedFor(rt, { screen, anchor, prompt, keepLayout = false, sketch = '' }) {
    const locked = keepLayout || Boolean(sketch)
    const context = rt.captureContext(), source = context.state
    const state = copy(Object.fromEntries(STATE_KEYS.filter(key => source[key] !== undefined).map(key => [key, source[key]])))
    const provider = root.NovaFlowArtGenerateModels?.normalizeProvider?.(state.provider) || 'local'
    const natural = screen.width && screen.height ? { width: screen.width, height: screen.height } : await imageSize(screen.dataUrl)
    const size = outputSize(provider, natural.width, natural.height, locked)
    // 只换皮 edits the screen itself; 重新设计 draws from the function list, with only a finished
    // screen of the same theme (when there is one) as the picture to match.
    const references = keepLayout
      ? [{ id: screen.id || 'ui-theme-screen', name: screen.name || '界面.png', dataUrl: screen.dataUrl, width: natural.width, height: natural.height, role: 'layout' },
        ...(anchor ? [{ id: 'ui-theme-anchor', name: '同主题成品.png', dataUrl: anchor, role: 'style' }] : [])]
      : [...(sketch ? [{ id: 'ui-theme-sketch', name: '布局草图.png', dataUrl: sketch, width: size.width, height: size.height, role: 'layout' }] : []),
        ...(anchor ? [{ id: 'ui-theme-anchor', name: '同主题成品.png', dataUrl: anchor, role: 'style' }] : [])]
    const mode = references.length ? 'img2img' : 'txt2img'
    Object.assign(state, {
      mode, provider, count: 1, nsfw: false, negativePrompt: provider === 'local' ? LOCAL_THEME_NEGATIVE : '', width: size.width, height: size.height,
      ...(provider === 'local' ? { samplingOverrides: { ...(state.samplingOverrides || {}), 'qwen-2.1-turbo:img2img': { cfg: LOCAL_THEME_CFG }, 'qwen-2.1-turbo:txt2img': { cfg: LOCAL_THEME_CFG } } } : {}),
      gptQualityImg2img: 'high', gptQualityTxt2img: 'high', gptSize: 'Custom', gptCustomWidth: size.width, gptCustomHeight: size.height,
      localEditStrength: 'enhanced', uiPreserveLayout: keepLayout, uiLayoutMode: keepLayout ? 'preserve' : 'reflow', uiRunIntent: 'redesign',
    })
    state.localDrawEngine = root.NovaFlowArtGenerateModels?.capabilityFor?.(provider, mode, state)?.engine || state.localDrawEngine || ''
    return { uiThemeSwitch: true, promptOwnsReferenceRoles: true, state, references, originalPrompt: prompt, optimizedPrompt: prompt, promptSnapshot: { prompt, negativePrompt: state.negativePrompt || '' } }
  }

  async function waitIdle(rt, signal) {
    while (rt.state.running) {
      if (signal.aborted) return
      await new Promise(resolve => root.setTimeout(resolve, 400))
    }
  }

  // Runs screens x themes one at a time through the normal generation path, so
  // billing, the results list and canvas placement stay the same as 生图.
  async function runBatch({ screens, themes, keepText, keepLayout = false, variety = false, useSketch = true, note, signal, onProgress }) {
    const rt = root.__NovaFlowArtGenerate
    if (!rt?.run || !rt.captureContext) throw new Error('生图组件未就绪，请刷新页面')
    if (rt.state.running) throw new Error('已有生图正在进行，请稍候')
    const styles = [null, ...(variety && !keepLayout ? ARRANGEMENTS : [])]
    const total = screens.length * themes.length * styles.length
    let done = 0, failed = 0
    const inventories = new Map()
    if (!keepLayout) for (const screen of screens) {
      if (signal.aborted) return { done, failed, total, stopped: true }
      onProgress?.(`正在读取界面 ${inventories.size + 1}/${screens.length}`)
      try { inventories.set(screen, await readInventory(screen, signal)) }
      catch (error) { return { done, failed, total, stopped: true, error: text(error?.message || error) } }
    }
    for (const theme of themes) for (const arrangement of styles) {
      let anchor = ''
      for (const screen of screens) {
        if (signal.aborted) return { done, failed, total, stopped: true }
        onProgress?.(`${theme.name}${arrangement ? ' · ' + arrangement.name : ''} · 第 ${done + failed + 1}/${total} 张`)
        const provider = root.NovaFlowArtGenerateModels?.normalizeProvider?.(rt.captureContext().state.provider) || "local"
        // A named arrangement draws its own composition: no layout guide for it.
        const plan = !keepLayout && useSketch && !arrangement ? sketchPlan(inventories.get(screen)) : null
        const natural = screen.width && screen.height ? { width: screen.width, height: screen.height } : await imageSize(screen.dataUrl)
        const sketchSize = outputSize(provider, natural.width, natural.height, true)
        let sketch = ''
        if (!keepLayout && useSketch && !arrangement && screens.length === 1) {
          // One screen: its layout is the one in 布局编辑, where the user can move every block.
          // A layout this panel built for another screen is stale for this one: draw this
          // screen's own sketch instead. A layout the user made stays in charge.
          let layout = editorLayout(rt)
          const auto = read(AUTO_LAYOUT_KEY, {}) || {}, ours = auto.owner === fingerprint(screen.dataUrl)
          const saved = layout ? null : projectLayout()
          if (layout && auto.guide === fingerprint(layout.dataUrl) && !ours) layout = null
          else if (!layout && saved) {
            // Saved blocks: the user's own, or ours for this screen, are drawn; ours for another
            // screen are stale and this screen's own sketch is used.
            if (auto.blocks !== saved.key || ours) sketch = drawBlocks(scaledBlocks(saved, sketchSize.width, sketchSize.height), sketchSize.width, sketchSize.height)
          } else if (!layout && plan) {
            try {
              layout = layoutIntoEditor(rt, plan, sketchSize)
              if (layout) write(AUTO_LAYOUT_KEY, { owner: fingerprint(screen.dataUrl), guide: fingerprint(layout.dataUrl), blocks: projectLayout()?.key || '' })
            } catch { layout = null }
          }
          // Draw the guide ourselves from the 布局编辑 blocks, with their words written in.
          if (!sketch && layout) {
            const regions = layout.structure?.regions
            const blocks = Array.isArray(regions) && regions.length ? { blocks: regions, width: layout.structure.width, height: layout.structure.height } : projectLayout()
            sketch = blocks?.blocks?.length ? drawBlocks(scaledBlocks(blocks, sketchSize.width, sketchSize.height), sketchSize.width, sketchSize.height) : layout.dataUrl
          }
        }
        if (!sketch && plan) sketch = drawSketch(plan, sketchSize.width, sketchSize.height)
        const prompt = buildPrompt({ theme, keepText, keepLayout, note, anchored: Boolean(anchor), provider, inventory: inventories.get(screen), sketched: Boolean(sketch), arrangement })
        const uiPrepared = await preparedFor(rt, { screen, anchor, prompt, keepLayout, sketch })
        // The first version has to look good; small slips are left for the user to touch up,
        // so a result is never redrawn automatically (Dylan, 2026-11-08).
        const before = rt.selectedResult?.()?.id || ''
        await rt.run({ uiPrepared })
        await waitIdle(rt, signal)
        const current = rt.selectedResult?.()
        const result = current && current.id !== before && (current.imageUrl || current.dataUrl) ? current : null
        if (result) {
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

    const hint = make('div', '添加一张或多张界面图，选几个主题，一次生成全部。默认读出界面功能后按原图位置排版、按主题重画全部美术；「自由构图」让模型自己排版。同一主题的多张界面画风统一。'); Object.assign(hint.style, { color: '#999', fontSize: '11px', lineHeight: '1.5' })
    const chips = make('div', '', { 'data-foart-ui-theme-chips': '1' }); Object.assign(chips.style, { display: 'flex', flexWrap: 'wrap', gap: '6px' })
    const editor = make('div', '', { 'data-foart-ui-theme-editor': '1' }); Object.assign(editor.style, { display: 'none', gap: '8px' })
    const customRow = make('div'); Object.assign(customRow.style, { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '6px' })
    const field = (placeholder, multi = false) => { const node = make(multi ? 'textarea' : 'input', '', { placeholder, spellcheck: 'false' }); Object.assign(node.style, { width: '100%', minWidth: '0', boxSizing: 'border-box', background: '#1f1f1f', color: '#ddd', border: '1px solid #3a3a3a', borderRadius: '5px', padding: '6px 8px', fontSize: '12px', outline: 'none', resize: multi ? 'vertical' : 'none', ...(multi ? { minHeight: '52px', lineHeight: '1.5', fontFamily: 'inherit' } : { height: '30px' }) }); return node }
    const custom = field('自定义主题，如：水墨武侠、像素复古')
    const keepRow = make('label'); Object.assign(keepRow.style, { display: 'flex', alignItems: 'center', gap: '6px', color: '#bbb', fontSize: '12px', cursor: 'pointer' })
    const keep = make('input', '', { type: 'checkbox' }); keep.checked = read('foart.ui.theme-keep-text.v1', true) !== false
    keepRow.append(keep, make('span', '保留原文字和数字'))
    const layoutRow = make('label'); Object.assign(layoutRow.style, { display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', alignItems: 'center', gap: '8px', color: '#bbb', fontSize: '12px' })
    const layoutMode = make('select', '', { 'aria-label': '排版', 'data-novaflow-art-generate-select-field': '1' })
    Object.assign(layoutMode.style, { width: '100%', minWidth: '0', height: '30px', boxSizing: 'border-box', background: '#292929', color: '#ddd', border: '1px solid #444', borderRadius: '5px', padding: '5px 8px', fontSize: '12px' })
    for (const [value, label] of [['follow', '跟随原图布局'], ['free', '自由构图'], ['variety', `多种排版（每个主题 ${ARRANGEMENTS.length + 1} 种）`], ['reskin', '保持原图，只换皮']]) { const option = make('option', label); option.value = value; layoutMode.append(option) }
    layoutMode.value = ['follow', 'free', 'variety', 'reskin'].includes(read('foart.ui.theme-layout-mode.v1', 'follow')) ? read('foart.ui.theme-layout-mode.v1', 'follow') : 'follow'
    layoutRow.append(make('span', '排版'), layoutMode)
    layoutMode.addEventListener('change', () => { write('foart.ui.theme-layout-mode.v1', layoutMode.value); render() })
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
      const count = screens().length * picks.size * (layoutMode.value === 'variety' ? ARRANGEMENTS.length + 1 : 1)
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
        const outcome = await runBatch({ screens: list, themes, keepText: keep.checked, keepLayout: layoutMode.value === 'reskin', variety: layoutMode.value === 'variety', useSketch: layoutMode.value !== 'free', note: note.value, signal: busy.signal, onProgress: value => message(value) })
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

  root.FoartUiThemeSwitch = Object.freeze({ DEFAULT_THEMES, ARRANGEMENTS, buildPrompt, outputSize, sketchPlan, sketchBlocks, drawSketch, readInventory, runBatch, mount })
})(typeof window !== 'undefined' ? window : globalThis)
