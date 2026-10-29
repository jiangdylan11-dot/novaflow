// Render a supplied external-image project with read-only disk-backed handle fixtures.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const project = path.resolve(process.env.FOART_SAMPLE_PROJECT || '');
assert(process.env.FOART_SAMPLE_PROJECT, 'Set FOART_SAMPLE_PROJECT to the real .nfproj');
const sampleRoot = path.dirname(project), renderer = path.resolve(process.env.FOART_WEB_ROOT || path.join(root, 'renderer'));
const output = path.resolve(process.env.FOART_IMPORT_OUTPUT || path.join(root, '../work/project-folder-ui'));
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(project)).digest('hex');
const before = hash(); let server;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      const disk = url.pathname.startsWith('/fixture/');
      const base = disk ? sampleRoot : renderer;
      const relative = disk ? url.searchParams.get('path') || '' : decodeURIComponent(url.pathname).slice(1);
      const file = path.resolve(base, relative);
      if (file !== base && !file.startsWith(base + path.sep)) return res.writeHead(403).end();
      if (url.pathname === '/fixture/list') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fs.readdirSync(file, { withFileTypes: true }).map(e => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }))));
      const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }).end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error(message); });
  await win.loadURL(base + '/spine-skeleton-editor.html');
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+15000;const t=setInterval(()=>{if(window.NovaFlowSkeletonEditorAPI){clearInterval(t);resolve()}else if(Date.now()>end){clearInterval(t);reject(Error('editor unavailable'))}},50)})`);
  await win.webContents.executeJavaScript(`(()=>{
    const url=(kind,p)=>'/fixture/'+kind+'?path='+encodeURIComponent(p.join('/'));
    const make=(p,kind)=>({__parts:p,kind,name:p.at(-1)||'sample',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',
      resolve:async other=>other.__parts?.slice(0,p.length).join('/')===p.join('/')?other.__parts.slice(p.length):null,
      getDirectoryHandle:async name=>{const entries=await(await fetch(url('list',p))).json();if(!entries.some(e=>e.name===name&&e.kind==='directory'))throw Error('NotFound');return make([...p,name],'directory')},
      getFileHandle:async name=>{const entries=await(await fetch(url('list',p))).json();if(!entries.some(e=>e.name===name&&e.kind==='file'))throw Error('NotFound');return make([...p,name],'file')},
      getFile:async()=>{const r=await fetch(url('file',p));if(!r.ok)throw Error('NotFound');return new File([await r.arrayBuffer()],p.at(-1))},
      entries:async function*(){for(const e of await(await fetch(url('list',p))).json())yield[e.name,make([...p,e.name],e.kind)]}
    });
    window.sampleDirectory=make([],'directory');window.sampleFile=make([${JSON.stringify(path.basename(project))}],'file');window.folderPicks=0;
    window.showDirectoryPicker=async()=>{folderPicks++;return sampleDirectory};
    window.importResult=sampleFile.getFile().then(file=>NovaFlowSkeletonEditorAPI.openProjectFile(file,sampleFile,{operation:'replace'}));
  })()`);
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const t=setInterval(()=>{const n=document.querySelector('[data-nf-project-directory-access] .btn.primary');if(n){clearInterval(t);n.click();resolve()}else if(Date.now()>end){clearInterval(t);reject(Error('directory connection prompt missing'))}},50)})`);
  const first = await win.webContents.executeJavaScript(`importResult.then(count=>{const s=NovaFlowSkeletonEditorAPI.mediaExportPlans()[0].entries[0].src;return{count,picks:folderPicks,images:s.images.size,imagePath:s.imagePath,text:document.body.innerText}})`);
  assert.equal(first.count, 1); assert.equal(first.picks, 1); assert(first.images >= 80); assert(!first.text.includes('缺少 84 张外部图片')); assert(!first.text.includes('已显示 MISSING'));
  const reopened = await win.webContents.executeJavaScript(`sampleFile.getFile().then(file=>NovaFlowSkeletonEditorAPI.openProjectFile(file,sampleFile,{operation:'replace'})).then(count=>({count,picks:folderPicks,images:NovaFlowSkeletonEditorAPI.mediaExportPlans()[0].entries[0].src.images.size}))`);
  assert.equal(reopened.count, 1); assert.equal(reopened.picks, 1); assert.equal(reopened.images, first.images);
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(output, 'imported-project.png'), (await win.webContents.capturePage()).toPNG());
  assert.equal(hash(), before, 'The supplied original project must remain unchanged');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: true, fixtureHandles: true, first, reopened, originalSha256: before }, null, 2));
  console.log(JSON.stringify({ ok: true, firstImages: first.images, reopened, originalUnchanged: true }));
  win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); server?.close(); app.exit(1); });
setTimeout(() => app.exit(2), 60000);
