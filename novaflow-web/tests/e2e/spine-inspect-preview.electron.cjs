// Real editor and Spine runtime; no model service or user project is used.
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'foart-inspect-preview-')));
app.whenReady().then(async () => {
  const window = new BrowserWindow({show:false, width:1200, height:850, webPreferences:{backgroundThrottling:false}});
  try {
    await window.loadFile(path.resolve(__dirname, '../../renderer/spine-skeleton-editor.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      while (!window.NovaFlowSkeletonEditorAPI) await new Promise(resolve => setTimeout(resolve, 20));
      const api = window.NovaFlowSkeletonEditorAPI;
      const skeleton = {skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'hair',parent:'root',length:30}],slots:[],
        skins:[{name:'default',attachments:{}}],animations:{idle:{bones:{hair:{rotate:[{time:0,angle:0},{time:1,angle:12}]}}}}};
      await api.loadSource({skeleton:{fileName:'disposable-duration.json',text:JSON.stringify(skeleton)},images:[]});
      api.setAnim('idle'); api.selectBone('hair');
      const lab=window.__SkeletonLab, before=JSON.stringify(api.json()), selected=api.selectedBone(), history=lab.state.history.length;
      const op={name:'idle',boneNames:['hair']}, authored=api.agentInspectBones(op);
      const previewSet=api.previewAnimation('idle',{bones:{hair:{rotate:[{time:0,angle:0},{time:4,angle:40}]}}});
      const previewDuration=lab.rt.animationPreview.animation.duration, during=api.agentInspectBones(op);
      const unchanged=before===JSON.stringify(api.json()), selectionUnchanged=selected===api.selectedBone();
      const historyUnchanged=history===lab.state.history.length, previewRetained=api.hasAnimationPreview();
      api.clearAnimationPreview();
      return {authored,previewSet,previewDuration,during,unchanged,selectionUnchanged,historyUnchanged,previewRetained,after:api.agentInspectBones(op)};
    })()`);
    assert.equal(result.authored.durationSeconds, 1);
    assert.equal(result.previewSet, true);
    assert.equal(result.previewDuration, 4);
    assert.equal(result.during.durationSeconds, 1);
    assert.equal(result.during.durationAvailable, true);
    assert.deepEqual(result.during.bones[0].tracks.rotate, [{time:0,angle:0},{time:1,angle:12}]);
    assert.equal(result.unchanged, true);
    assert.equal(result.selectionUnchanged, true);
    assert.equal(result.historyUnchanged, true);
    assert.equal(result.previewRetained, true);
    assert.equal(result.after.durationSeconds, 1);
    console.log('Read-only inspection keeps authored tracks and duration while a different native preview is active.');
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
setTimeout(() => app.exit(2), 30000);
