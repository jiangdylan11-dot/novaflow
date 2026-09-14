const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'logs/cutout-image-20260914/art-alpha');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.whenReady().then(async () => {
  const source = fs.readFileSync(path.join(root, 'particle-editor/spine-split-runtime.js'), 'utf8');
  const ast = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true);
  const declarations = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ast.getLineAndCharacterOfPosition(node.getStart(ast)).character === 2) declarations.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } });
  await win.loadURL('about:blank');
  const results = await win.webContents.executeJavaScript(`(()=>{
    ${declarations.join('\n')}
    return [255,128].map(inputAlpha=>{
      const w=64,h=64,canvas=canvasOfSize(w,h),ctx=canvas.getContext('2d');
      const pixels=ctx.createImageData(w,h);
      for(let y=10;y<54;y++)for(let x=10;x<54;x++){
        const i=(y*w+x)*4;pixels.data.set([35,31,29,inputAlpha],i);
      }
      ctx.putImageData(pixels,0,0);
      const roi=canvasOfSize(w,h),rctx=roi.getContext('2d');rctx.fillStyle='#fff';rctx.fillRect(0,0,w,h);
      const center=()=>ctx.getImageData(32,32,1,1).data[3];
      const refined=refineObjectAlphaMask(canvas,{softRoiMask:roi,hardRoiMask:roi,seedMask:roi});
      const afterRefine=center();
      const beforeCleanup=snapshotImageAlpha(ctx.getImageData(0,0,w,h));
      cleanupObjectExtractEdges(canvas,canvas);
      const afterCleanup=snapshotImageAlpha(ctx.getImageData(0,0,w,h));
      let alphaChangedByCleanup=0;
      for(let i=0;i<beforeCleanup.length;i++)if(beforeCleanup[i]!==afterCleanup[i])alphaChangedByCleanup++;
      return {inputAlpha,afterRefine,afterCleanup:center(),alphaChangedByCleanup,refined};
    });
  })()`);
  for (const result of results) {
    assert.equal(result.afterRefine, result.inputAlpha);
    assert.equal(result.afterCleanup, result.inputAlpha);
    assert.equal(result.alphaChangedByCleanup, 0);
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: true, results }));
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
