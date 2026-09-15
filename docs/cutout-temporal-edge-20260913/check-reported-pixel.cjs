const fs=require('fs'),path=require('path'),assert=require('assert/strict'),sharp=require('../../particle-editor-desktop/node_modules/sharp');
(async()=>{const dir=path.join(__dirname,'gloweyes'),report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'))),values=[];
const pixel=async file=>[...await sharp(file).ensureAlpha().extract({left:600,top:1560,width:1,height:1}).raw().toBuffer()];
for(const n of [0,3]){const match=report.maskMatches.find(m=>m.timelineIndex===n),name=String(n).padStart(4,'0');values.push({frame:n,source:await pixel(path.join(dir,'captured',`frame_${String(match.decodedFrameIndex).padStart(4,'0')}.png`)),before:await pixel(path.join(dir,'before',`frame_${name}.png`)),after:await pixel(path.join(dir,'frames',`clean_${name}.png`))});}
assert.deepEqual(values[0].source,values[1].source);assert.notDeepEqual(values[0].before,values[1].before);assert.deepEqual(values[0].after,values[1].after);
const result={clip:'gloweyes',point:[600,1560],note:'Diagnostic sample only, not a production coordinate rule',values,pass:true};fs.writeFileSync(path.join(__dirname,'reported-pixel-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exit(1)});
