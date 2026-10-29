const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const renderer=path.resolve(__dirname,'../../renderer');
  const css=fs.readFileSync(path.join(renderer,'foart-button-theme.css'),'utf8');
  const js=fs.readFileSync(path.join(renderer,'foart-button-theme.js'),'utf8');
  const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<style>${css}</style>
    <style>button{background:transparent;color:#ddd;border:1px solid red}.selected{background:#1c4136}.primary{background:#1ea672}.tab{background:transparent}input{background:#343434}</style>
    <button id="nav">导航</button><button id="heading">分组标题</button><button class="tab" id="tab">页签</button>
    <button id="grey" class="btn">普通操作</button><button id="primary" class="primary">生成</button>
    <button id="selected" class="selected" aria-pressed="true">选中工具</button>
    <button id="import" data-novaflow-spine-inline-import-action="1" class="primary">导入</button>
    <button id="swatch" data-color="#ff0000" style="background:rgb(255,0,0)!important">色板</button>
    <input id="field"><aside data-novaflow-left-content-root><div><p id="usage">快捷键：空格播放，S 分割</p></div><p id="status">保存失败：文件不可写</p><p id="price">预计消耗 10 积分</p></aside>`));
  await win.webContents.executeJavaScript(js);
  const read=id=>win.webContents.executeJavaScript(`(()=>{const n=document.getElementById(${JSON.stringify(id)}),s=getComputedStyle(n);return {bg:s.backgroundColor,border:s.borderTopWidth,shadow:s.boxShadow}})()`);
  for(const id of ['nav','heading','tab'])assert.equal((await read(id)).bg,'rgba(0, 0, 0, 0)',id+' must not acquire a background');
  assert.equal((await read('grey')).bg,'rgb(39, 39, 39)');
  assert.equal((await read('import')).bg,'rgb(39, 39, 39)');
  assert.equal((await read('primary')).bg,'rgb(30, 166, 114)');
  assert.equal((await read('selected')).bg,'rgb(28, 65, 54)');
  for(const id of ['nav','heading','tab','grey','primary','selected','import']){assert.equal((await read(id)).border,'0px',id);assert.equal((await read(id)).shadow,'none',id);}
  const legacy=await win.webContents.executeJavaScript(`['transparent','rgba(0,0,0,0)','#333333','#1c4136','#1ea672'].map(v=>FoartButtonTheme.normalize(document.getElementById('grey'),'background',v))`);
  assert.deepEqual(legacy,['transparent','rgba(0,0,0,0)','#272727','#1c4136','#1ea672']);
  assert.equal((await read('swatch')).bg,'rgb(255, 0, 0)');assert.equal((await read('field')).bg,'rgb(52, 52, 52)');
  const notes=await win.webContents.executeJavaScript(`(()=>{FoartButtonTheme.compactUsageNotes();return ['usage','status','price'].map(id=>getComputedStyle(document.getElementById(id)).display)})()`);
  assert.equal(notes[0],'none');assert.notEqual(notes[1],'none');assert.notEqual(notes[2],'none');
  console.log('PASS: transparent navigation/headings/tabs stay transparent; only painted actions normalize; selected green, swatches, fields and feedback preserved');
  app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
