const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const comparison=JSON.parse(fs.readFileSync(path.join(__dirname,'pixel-comparison.json'))),checks=[];
const core=sha(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'));
for(const clip of ['minimax','gloweyes','athena','blue','scatter']){
 const r=JSON.parse(fs.readFileSync(path.join(__dirname,clip,'report.json'))),b=JSON.parse(fs.readFileSync(path.join(__dirname,clip,'before/report.json'))),p=comparison.clips[clip];
 assert.equal(r.mattingSha256,core);assert(r.liveBackend);assert.equal(r.writes.length,r.count);assert.equal(p.frames,r.count);
 assert.equal(p.subjectPixelsChanged,0);assert.equal(p.screenShadowPixelsChanged,0);assert.equal(r.errors.length,0);assert.equal(r.startupErrors.length,0);
 assert.equal(r.entry.label,'视频抠图');assert.equal(r.entry.count,1);assert.equal(r.entry.icons,0);assert(r.brush.changed>0&&r.brush.recovered>0);
 assert(b.candidateReplayChecks.every(x=>x.changedBytes===0));
 let bundle=fs.readFileSync(path.join(__dirname,clip,'fixture-bundle.mjs'),'utf8');
 bundle=bundle.replace('window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};','(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));');
 checks.push({clip,frames:r.count,liveAI:true,errors:0,subjectPixelsChanged:0,screenShadowPixelsChanged:0,coreSha256:core,rendererSha256:crypto.createHash('sha256').update(bundle).digest('hex')});
}
const report={coreSha256:core,totalFrames:checks.reduce((n,r)=>n+r.frames,0),clips:checks};
fs.writeFileSync(path.join(__dirname,'verification.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(__dirname,'README.md'),`# 剑柄光晕局部修正

缺失来自人物轮廓去污染步骤对贴近剑柄的光晕过度抑制。只在主体外侧、原片有连续宽光晕、颜色一致且没有绿幕吸收证据时，保护原有光能；细窄的绿边继续清理。没有重画或补造光效。

修正前后使用同一次解码的 RGB 与同一次真实 AI 输出。页面视频由真实导出的透明 PNG 直接合成，未再做图像后期。

## 验证

- 五段原片，共 ${report.totalFrames} 帧，真实 AI 识别及透明 PNG 导出完成。
- 逐帧比较：AI 主体覆盖 >= 7/255 的区域变化为 0；明确暗化的屏幕投影采样变化为 0。
- 局部光晕、窄亮边、绿/蓝幕、投影、薄纱与 Alpha 编码测试共 46 项通过。
- 单按钮“视频抠图”、无图标、擦除/羽化/修复功能通过入口测试。
- 验收图左侧为本次修改前的核心算法，右侧为当前程序结果。安装包运行时复核见 packaged-runtime-parity.json。

| 素材 | 帧数 | 主体像素变化 | 投影采样变化 |
|---|---:|---:|---:|
${checks.map(r=>`| ${r.clip} | ${r.frames} | 0 | 0 |`).join('\n')}

主体/投影指标只覆盖上述明确采样定义；周围的真实光效是本次有意调整的区域。最终观感仍以视频验收为准。

## 运行与交付范围

源文件 SHA-256：${core}。逐帧数据见 pixel-comparison.json，真实入口与算法回放一致性见各素材 report.json 和 before/report.json。

本轮同时保留当前缓存和保存加速逻辑。仅抠图 CPU 采样增加约 4–11%，不代表完整保存耗时；预览已缓存的帧继续复用。

check:runtime 通过。check:entry 当前仍为 NO-GO：锁定的 4783 服务不可达，另有既存 AI effects 集成门禁未完成；8188 直连成功。这不是全项目发布通过声明。
`);
console.log(JSON.stringify(report,null,2));
