// Particle template library preview performance.
//
// Every template card (`Ua`) used to run its own requestAnimationFrame loop: each frame it stepped its
// particle systems (up to 4 fixed 1/60s sub-steps, so a slow frame made the next one slower) and, at
// 30fps, redrew every particle onto an offscreen canvas of up to 1024x1024px before blitting it into the
// 240x150 card. With ~20 templates open that was ~20 simulations and ~20 large canvas redraws per frame
// (measured: 40-50ms of JS per draw frame for 17 cards), and cards scrolled out of view kept running.
// On top of that, hovering a card wrote the app-level `hoverDeleteTarget` state, so every mouse enter /
// leave re-rendered the whole editor.
//
// The patch keeps the live playback but:
// - drives all cards from one shared scheduler (`nfTplPreviewSched`): one rAF, at most 2 fixed steps per
//   frame with no accumulated debt, and a round-robin draw pass with an 8ms budget that covers the draw
//   pass only and always draws at least one card per frame (each card redraws at most 24 times per
//   second; when the budget runs out the remaining cards draw first on the next frame);
// - initializes cards lazily, one per frame, once they are visible, and pauses cards that an
//   IntersectionObserver reports as scrolled out of view;
// - renders the offscreen canvas at most 384px wide (a context scale keeps the particle world size);
// - keeps the hover highlight in the template library's own state and publishes the hovered id through
//   `nfTemplateHoverId`, so the Delete key still removes the hovered card without touching app state.
export function patchTemplatePreviewPerf(source) {
  const SCHEDULER_MARKER = 'var nfTplPreviewSched=(()=>{';
  const PREVIEW_START = 'var Ua=({system:e,systems:t,width:n=120,height:r=80})=>{';
  const PREVIEW_END = 'display:`block`,borderRadius:6,background:`#151515`}})};function Wa(e){';
  const PREVIEW_ORIGINAL_MARKERS = [
    'for(let e=0;e<30;e++)for(let e of o.current)e.step(1/60)',
    'u.current=requestAnimationFrame(S)',
    'return Math.max(256,Math.min(1024,u||512))',
  ];

  // Scheduler v1 (2026-09-16) took the 8ms draw deadline before the lazy init and the step phase and
  // left the draw pass as soon as it had passed. With the bundled templates open, stepping 17 cards
  // alone exceeded that budget on every frame, so the draw pass broke out before its first card and
  // the whole library stayed blank. v2 budgets the draw pass only and always draws at least one card
  // per frame (heavy templates degrade to fewer redraws, never to empty cards); a bundle that carries
  // v1 is upgraded in place.
  const SCHEDULER_V1 =
    "var nfTplPreviewSched=(()=>{let entries=new Set,rafId=0,lastNow=0,cursor=0,STEP=1/60,MAX_STEPS=2,BUDGET_MS=8,DRAW_INTERVAL_MS=1e3/24,frame=now=>{rafId=0;let dt=lastNow?Math.max(0,Math.min(.05,(now-lastNow)/1e3)):0;lastNow=now;let list=Array.from(entries);if(!list.length)return;let deadline=performance.now()+BUDGET_MS;for(let entry of list)if(!entry.ready&&entry.visible){entry.init();break}if(!document.hidden){for(let entry of list){if(!entry.ready||!entry.visible)continue;entry.acc+=dt;let steps=0;for(;entry.acc>=STEP&&steps<MAX_STEPS;)entry.step(STEP),entry.acc-=STEP,steps++;entry.acc>STEP&&(entry.acc=STEP)}let count=list.length,start=cursor%count;for(let offset=0;offset<count;offset++){let index=(start+offset)%count,entry=list[index];if(!entry.ready||!entry.visible||now-entry.lastDraw<DRAW_INTERVAL_MS)continue;if(performance.now()>deadline){cursor=index;break}entry.draw(),entry.lastDraw=now}}rafId=requestAnimationFrame(frame)};return{add(entry){entries.add(entry),rafId||(lastNow=0,rafId=requestAnimationFrame(frame))},remove(entry){entries.delete(entry),!entries.size&&rafId&&(cancelAnimationFrame(rafId),rafId=0)}}})(),";
  const SCHEDULER_V2 =
    "var nfTplPreviewSched=(()=>{let entries=new Set,rafId=0,lastNow=0,cursor=0,STEP=1/60,MAX_STEPS=2,BUDGET_MS=8,DRAW_INTERVAL_MS=1e3/24,frame=now=>{rafId=0;let dt=lastNow?Math.max(0,Math.min(.05,(now-lastNow)/1e3)):0;lastNow=now;let list=Array.from(entries);if(!list.length)return;for(let entry of list)if(!entry.ready&&entry.visible){entry.init();break}if(!document.hidden){for(let entry of list){if(!entry.ready||!entry.visible)continue;entry.acc+=dt;let steps=0;for(;entry.acc>=STEP&&steps<MAX_STEPS;)entry.step(STEP),entry.acc-=STEP,steps++;entry.acc>STEP&&(entry.acc=STEP)}let deadline=performance.now()+BUDGET_MS,count=list.length,start=cursor%count,drawn=0;for(let offset=0;offset<count;offset++){let index=(start+offset)%count,entry=list[index];if(!entry.ready||!entry.visible||now-entry.lastDraw<DRAW_INTERVAL_MS)continue;if(drawn>0&&performance.now()>deadline){cursor=index;break}entry.draw(),entry.lastDraw=now,drawn++}}rafId=requestAnimationFrame(frame)};return{add(entry){entries.add(entry),rafId||(lastNow=0,rafId=requestAnimationFrame(frame))},remove(entry){entries.delete(entry),!entries.size&&rafId&&(cancelAnimationFrame(rafId),rafId=0)}}})(),";
  const PREVIEW_AFTER =
    SCHEDULER_V2 +
    'Ua=({system:e,systems:t,width:n=120,height:r=80})=>{let i=(0,_.useRef)(null);return(0,_.useEffect)(()=>{let canvas=i.current;if(!canvas)return;let ctx=qe(canvas),configs=Array.isArray(t)&&t.length>0?t:e?[e]:[];if(!ctx||configs.length===0)return;let worldSize=cfg=>{let life=Math.max(.01,cfg.lifetimeMax||.01),speed=Math.max(0,cfg.speedMax||0),gravity=cfg.gravityEnabled?Math.hypot(cfg.gravityX||0,cfg.gravityY||0):0,travel=speed*life+.5*gravity*life*life,shape=cfg.shape||{type:`point`,x:0,y:0},shapeRadius=shape.type===`circle`?Math.max(0,shape.outerRadius||0):shape.type===`rect`?Math.max(0,Math.hypot((shape.width||0)/2,(shape.height||0)/2)):shape.type===`cone`?Math.max(0,shape.coneRadius||0):0,attractor=cfg.attractorEnabled?Math.max(0,cfg.attractorRadius||0):0,spiral=cfg.attractorEnabled&&cfg.attractorMode===`spiral`?Math.max(0,cfg.spiralStartRadius||0):0,reach=shapeRadius+travel+Math.max(attractor,spiral)+80,size=Math.ceil(reach*2);return Math.max(256,Math.min(1024,size||512))},world=configs.reduce((acc,cfg)=>Math.max(acc,worldSize(cfg)),0)||512,scale=Math.min(1,384/world),offscreen=document.createElement(`canvas`);offscreen.width=offscreen.height=Math.max(1,Math.round(world*scale));let octx=offscreen.getContext(`2d`);if(!octx)return;octx.setTransform(scale,0,0,scale,0,0);let engines=[],crop=null,measureCrop=()=>{let w=offscreen.width,h=offscreen.height;if(w<=0||h<=0)return null;let probe=document.createElement(`canvas`);probe.width=160,probe.height=160;let pctx=probe.getContext(`2d`);if(!pctx)return null;pctx.clearRect(0,0,160,160),pctx.drawImage(offscreen,0,0,160,160);let data=pctx.getImageData(0,0,160,160).data,minX=160,minY=160,maxX=-1,maxY=-1;for(let y=0;y<160;y++)for(let x=0;x<160;x++)data[(y*160+x)*4+3]>10&&(x<minX&&(minX=x),y<minY&&(minY=y),x>maxX&&(maxX=x),y>maxY&&(maxY=y));if(maxX<0||maxY<0)return null;let left=minX/160*w,top=minY/160*h,right=(maxX+1)/160*w,bottom=(maxY+1)/160*h,pad=.06*Math.max(w,h),x0=Math.max(0,Math.floor(left-pad)),y0=Math.max(0,Math.floor(top-pad)),x1=Math.min(w-1,Math.ceil(right+pad)),y1=Math.min(h-1,Math.ceil(bottom+pad));return{x:x0,y:y0,w:Math.max(1,x1-x0+1),h:Math.max(1,y1-y0+1)}},entry={visible:typeof IntersectionObserver!=`function`,ready:!1,acc:0,lastDraw:0,init(){entry.ready=!0;try{for(let cfg of configs){let local={...cfg,systemX:0,systemY:0},engine=new fi(octx,local);engine.setViewportRect(null),engine.updateConfig(local);let urls=pi(cfg);engine.setSprites(urls.length>0?urls.map(url=>{let img=new Image;return img.src=url,img}):[]),engine.width=world,engine.height=world,engine.reset(local,{draw:!1}),engines.push(engine)}for(let k=0;k<30;k++)for(let engine of engines)engine.step(1/60);octx.clearRect(0,0,world,world);for(let engine of engines)engine.draw({clear:!1});crop=measureCrop()}catch{crop=null}},step(dt){for(let engine of engines)engine.step(dt)},draw(){let w=canvas.width||canvas.clientWidth||n,h=canvas.height||canvas.clientHeight||r,sx=crop?crop.x:0,sy=crop?crop.y:0,sw=crop?crop.w:offscreen.width,sh=crop?crop.h:offscreen.height,fit=Math.min(w/sw,h/sh)*.995,dw=sw*fit,dh=sh*fit,dx=(w-dw)/2,dy=(h-dh)/2;octx.clearRect(0,0,world,world);for(let engine of engines)engine.draw({clear:!1});ctx.save(),ctx.setTransform(1,0,0,1,0,0),ctx.clearRect(0,0,w,h),ctx.imageSmoothingEnabled=!0,ctx.drawImage(offscreen,sx,sy,sw,sh,dx,dy,dw,dh),ctx.restore()}},observer=null;if(typeof IntersectionObserver==`function`){observer=new IntersectionObserver(records=>{for(let record of records)entry.visible=!!record.isIntersecting});observer.observe(canvas)}return nfTplPreviewSched.add(entry),()=>{observer&&observer.disconnect(),nfTplPreviewSched.remove(entry);for(let engine of engines)engine.stop();engines=[],crop=null}},[e,t,n,r]),(0,X.jsx)(`canvas`,{ref:i,width:n,height:r,style:{width:`100%`,height:`100%`,display:`block`,borderRadius:6,background:`#151515`}})}';

  const HOVER_VAR_ANCHOR = ';function Wa(e){let{enabled:t,importedProject:n,open:r,';
  // `Wa` destructures `saveTemplate:_`, which shadows the React namespace `_`, so the hooks live in a
  // module-level custom hook where `_` is still React.
  const HOVER_VAR_AFTER = ';var nfTemplateHoverId=null,nfTplUseHover=(enabled,open)=>{let[hover,setHover]=(0,_.useState)(null);return(0,_.useEffect)(()=>{if(!enabled||!open)nfTemplateHoverId=null,setHover(null)},[enabled,open]),(0,_.useEffect)(()=>()=>{nfTemplateHoverId=null},[]),[hover,setHover]};function Wa(e){let{enabled:t,importedProject:n,open:r,';
  const HOVER_STATE_BEFORE = 'saveTemplateGroup:v}=e;return t?';
  const HOVER_STATE_AFTER = 'saveTemplateGroup:v}=e,[nfTplHover,nfSetTplHover]=nfTplUseHover(t,r);return t?';
  const HOVER_CARD_BEFORE = 'className:u?.kind===`template`&&u?.id===String(e.id||``)?`nf-delete-hover`:void 0,onMouseEnter:()=>d({kind:`template`,id:String(e.id||``)}),onMouseLeave:()=>d(t=>t?.kind===`template`&&t?.id===String(e.id||``)?null:t),';
  const HOVER_CARD_AFTER = 'className:nfTplHover===String(e.id||``)?`nf-delete-hover`:void 0,onMouseEnter:()=>{let t=String(e.id||``);nfTemplateHoverId=t,nfSetTplHover(t)},onMouseLeave:()=>{let t=String(e.id||``);nfTemplateHoverId===t&&(nfTemplateHoverId=null),nfSetTplHover(e=>e===t?null:e)},';
  const DELETE_KEY_BEFORE = 'let s=m.current;if(s?.id){if(s.kind===`spriteLibrary`){';
  const DELETE_KEY_AFTER = 'let s=m.current;if(!s?.id&&nfTemplateHoverId){let t=nfTemplateHoverId;e.preventDefault(),r(e=>e.filter(e=>String(e?.id||``)!==t)),nfTemplateHoverId=null;return}if(s?.id){if(s.kind===`spriteLibrary`){';

  const replaceOnce = (label, before, after) => {
    if (source.includes(after)) {
      // Anchors whose new form ends with the old form (the hover id declaration) always contain `before`
      // once applied, so only a stray extra occurrence counts as a mixed state.
      const nested = after.includes(before) ? (source.split(after).length - 1) * (after.split(before).length - 1) : 0;
      if (source.split(before).length - 1 > nested) throw new Error(`Template preview perf: ${label} has both old and new forms`);
      return;
    }
    const first = source.indexOf(before);
    if (first < 0) throw new Error(`Template preview perf: ${label} anchor not found`);
    if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Template preview perf: ${label} anchor is ambiguous`);
    source = source.slice(0, first) + after + source.slice(first + before.length);
  };

  if (!source.includes(SCHEDULER_MARKER)) {
    const start = source.indexOf(PREVIEW_START);
    if (start < 0 || start !== source.lastIndexOf(PREVIEW_START)) {
      throw new Error('Template preview perf: preview component start anchor missing or ambiguous');
    }
    const endAnchor = source.indexOf(PREVIEW_END, start);
    if (endAnchor < 0) throw new Error('Template preview perf: preview component end anchor missing');
    const end = endAnchor + PREVIEW_END.indexOf(';function Wa(e){');
    const original = source.slice(start, end);
    if (original.length > 5000) throw new Error(`Template preview perf: preview component slice is unexpectedly long (${original.length})`);
    for (const marker of PREVIEW_ORIGINAL_MARKERS) {
      if (!original.includes(marker)) throw new Error(`Template preview perf: preview component marker missing (${marker})`);
    }
    source = source.slice(0, start) + PREVIEW_AFTER + source.slice(end);
  }
  if (source.split(SCHEDULER_MARKER).length - 1 !== 1) throw new Error('Template preview perf: scheduler must appear exactly once');
  if (source.includes(SCHEDULER_V1)) source = source.replace(SCHEDULER_V1, SCHEDULER_V2);
  if (!source.includes(SCHEDULER_V2)) throw new Error('Template preview perf: scheduler v2 is missing');

  replaceOnce('hover id declaration', HOVER_VAR_ANCHOR, HOVER_VAR_AFTER);
  replaceOnce('library hover state', HOVER_STATE_BEFORE, HOVER_STATE_AFTER);
  replaceOnce('card hover handlers', HOVER_CARD_BEFORE, HOVER_CARD_AFTER);
  replaceOnce('delete key fallback', DELETE_KEY_BEFORE, DELETE_KEY_AFTER);
  return source;
}
