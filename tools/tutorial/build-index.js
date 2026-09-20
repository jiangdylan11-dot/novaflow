/* Build the 美工 · 绘图 tutorial hub from catalog.js plus whatever clips exist.
 *
 *   node tools/tutorial/build-index.js [--out=docs/tutorials]
 */
const fs = require('node:fs');
const path = require('node:path');

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const OUT_DIR = path.resolve(argOf('out', path.join(__dirname, '..', '..', 'docs', 'tutorials')));
const catalog = require('./catalog');

fs.mkdirSync(OUT_DIR, { recursive: true });

const withVideo = catalog.map((f) => {
  const file = f.id + '.mp4';
  const full = path.join(OUT_DIR, file);
  const has = fs.existsSync(full);
  return Object.assign({}, f, {
    video: has ? file : null,
    sizeMb: has ? +(fs.statSync(full).size / 1048576).toFixed(2) : null
  });
});

const done = withVideo.filter((f) => f.video).length;
const groups = ['模式', '编辑', '拆图', '增强'];

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NovaFlow 美工 · 绘图 教程</title>
<style>
  :root{
    --bg:#0b0f14; --panel:#121920; --panel-2:#161f28; --line:rgba(255,255,255,.09);
    --ink:#e8eef3; --ink-dim:#93a4b3; --ink-faint:#6b7c8b; --accent:#38e0a8; --warn:#ffc46b;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background:var(--bg); color:var(--ink); min-height:100vh;
    font-family:"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Segoe UI",system-ui,sans-serif;
    font-size:15px; line-height:1.65; -webkit-font-smoothing:antialiased;
  }
  a{color:var(--accent)}
  header.top{
    padding:26px 32px 20px; border-bottom:1px solid var(--line);
    display:flex; align-items:flex-end; gap:18px; flex-wrap:wrap;
  }
  .brand{font-size:22px; font-weight:700; letter-spacing:.5px}
  .brand span{color:var(--accent)}
  .sub{color:var(--ink-dim); font-size:14px}
  .count{
    margin-left:auto; font-size:13px; color:var(--ink-faint);
    border:1px solid var(--line); border-radius:999px; padding:5px 13px; white-space:nowrap;
  }
  .wrap{display:grid; grid-template-columns:272px minmax(0,1fr); gap:0; align-items:start}
  nav{
    border-right:1px solid var(--line); padding:20px 14px 60px;
    position:sticky; top:0; max-height:100vh; overflow:auto;
  }
  nav h3{
    margin:18px 10px 8px; font-size:12px; letter-spacing:2px; color:var(--ink-faint);
    font-weight:600; text-transform:none;
  }
  nav h3:first-child{margin-top:0}
  nav button{
    display:block; width:100%; text-align:left; background:none; border:1px solid transparent;
    color:var(--ink-dim); padding:8px 11px; border-radius:9px; cursor:pointer;
    font:inherit; font-size:14px; margin-bottom:2px; transition:background .12s,color .12s;
  }
  nav button:hover{background:rgba(255,255,255,.045); color:var(--ink)}
  nav button[aria-current="true"]{
    background:rgba(56,224,168,.11); border-color:rgba(56,224,168,.34); color:var(--accent); font-weight:600;
  }
  nav .dot{display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:8px;
    background:var(--accent); vertical-align:middle}
  nav .dot.off{background:rgba(255,255,255,.18)}
  main{padding:28px 34px 80px; max-width:1100px}
  h1.title{margin:0 0 6px; font-size:27px; font-weight:700; letter-spacing:.5px}
  .tagline{color:var(--ink-dim); margin:0 0 20px; font-size:15px}
  .player{
    background:#000; border:1px solid var(--line); border-radius:13px; overflow:hidden;
    margin-bottom:12px; box-shadow:0 16px 44px rgba(0,0,0,.42);
  }
  .player video{display:block; width:100%; height:auto}
  .player-meta{color:var(--ink-faint); font-size:12.5px; margin:0 0 26px}
  .noclip{
    border:1px dashed var(--line); border-radius:13px; padding:26px; text-align:center;
    color:var(--ink-faint); margin-bottom:26px; background:var(--panel);
  }
  .note{
    border:1px solid rgba(255,196,107,.3); border-left:3px solid var(--warn); border-radius:0 10px 10px 0;
    background:rgba(255,196,107,.07); padding:13px 17px; margin-bottom:22px; color:#f0e2c8; font-size:14px;
  }
  .note b{color:var(--warn); font-weight:600; margin-right:6px}
  section.block{margin-bottom:26px}
  section.block h2{
    font-size:13px; letter-spacing:2px; color:var(--ink-faint); font-weight:600;
    margin:0 0 11px; padding-bottom:7px; border-bottom:1px solid var(--line);
  }
  .official{
    background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent);
    border-radius:0 10px 10px 0; padding:13px 17px; color:var(--ink-dim); font-size:14px;
  }
  ol.steps{margin:0; padding:0; list-style:none; counter-reset:s}
  ol.steps li{
    counter-increment:s; position:relative; padding:9px 0 9px 42px;
    border-bottom:1px solid rgba(255,255,255,.05);
  }
  ol.steps li:last-child{border-bottom:none}
  ol.steps li::before{
    content:counter(s); position:absolute; left:0; top:9px; width:26px; height:26px;
    border-radius:50%; background:rgba(56,224,168,.13); color:var(--accent);
    display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700;
  }
  ul.traps{margin:0; padding:0; list-style:none}
  ul.traps li{
    background:var(--panel-2); border:1px solid var(--line); border-radius:10px;
    padding:12px 15px 12px 40px; margin-bottom:9px; position:relative; color:var(--ink);
    font-size:14px;
  }
  ul.traps li::before{
    content:"!"; position:absolute; left:14px; top:12px; width:17px; height:17px; border-radius:50%;
    background:rgba(255,196,107,.16); color:var(--warn); font-size:12px; font-weight:700;
    display:flex; align-items:center; justify-content:center;
  }
  footer{padding:22px 34px 40px; color:var(--ink-faint); font-size:12.5px; border-top:1px solid var(--line)}
  @media (max-width:860px){
    .wrap{grid-template-columns:1fr}
    nav{position:static; max-height:none; border-right:none; border-bottom:1px solid var(--line)}
    main{padding:22px 18px 60px}
    header.top{padding:20px 18px 16px}
    footer{padding:20px 18px 34px}
  }
</style>
</head>
<body>
<header class="top">
  <div>
    <div class="brand">NovaFlow <span>美工 · 绘图</span> 教程</div>
    <div class="sub">每个功能一段短录屏，真实操作、真实出图</div>
  </div>
  <div class="count">已录 ${done} / ${withVideo.length}</div>
</header>

<div class="wrap">
  <nav id="nav"></nav>
  <main id="main"></main>
</div>

<footer>录屏由 <code>tools/tutorial</code> 驱动真实运行时录制；视频与本页同目录。</footer>

<script>
const FEATURES = ${JSON.stringify(withVideo, null, 1)};
const GROUPS = ${JSON.stringify(groups)};
const nav = document.getElementById('nav');
const main = document.getElementById('main');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

GROUPS.forEach((g) => {
  const items = FEATURES.filter((f) => f.group === g);
  if (!items.length) return;
  const h = document.createElement('h3');
  h.textContent = g;
  nav.appendChild(h);
  items.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = f.id;
    b.innerHTML = '<span class="dot' + (f.video ? '' : ' off') + '"></span>' + esc(f.label);
    b.onclick = () => select(f.id, { scroll: window.innerWidth < 860 });
    nav.appendChild(b);
  });
});

function select(id, opts) {
  const f = FEATURES.find((x) => x.id === id);
  if (!f) return;
  [...nav.querySelectorAll('button')].forEach((b) => {
    b.setAttribute('aria-current', b.dataset.id === id ? 'true' : 'false');
  });
  const clip = f.video
    ? '<div class="player"><video src="' + esc(f.video) + '" controls preload="metadata" playsinline></video></div>'
      + '<p class="player-meta">' + esc(f.video) + ' · ' + f.sizeMb + ' MB · 真实操作录屏，生成等待已加速</p>'
    : '<div class="noclip">这个功能的录屏还没做。下面的步骤与注意事项已经可用。</div>';

  main.innerHTML = [
    '<h1 class="title">' + esc(f.label) + '</h1>',
    '<p class="tagline">' + esc(f.tagline) + '</p>',
    f.note ? '<div class="note"><b>已知问题</b>' + esc(f.note) + '</div>' : '',
    clip,
    '<section class="block"><h2>官方说明</h2><div class="official">' + esc(f.official) + '</div></section>',
    '<section class="block"><h2>操作步骤</h2><ol class="steps">'
      + f.steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol></section>',
    f.traps && f.traps.length
      ? '<section class="block"><h2>注意</h2><ul class="traps">'
        + f.traps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></section>'
      : ''
  ].join('');
  if (opts && opts.scroll) main.scrollIntoView({ block: 'start' });
  try { history.replaceState(null, '', '#' + id); } catch (e) {}
}

const initial = (location.hash || '').replace('#', '');
select(FEATURES.some((f) => f.id === initial) ? initial : (FEATURES.find((f) => f.video) || FEATURES[0]).id);
</script>
</body>
</html>
`;

const outFile = path.join(OUT_DIR, 'index.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log('[hub] wrote', outFile, '-', done + '/' + withVideo.length, 'clips present');
