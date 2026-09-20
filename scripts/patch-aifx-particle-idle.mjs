// Stop simulating the particle editor while the AI 特效 shell covers it.
//
// The particle preview runs one requestAnimationFrame loop for the whole
// editor: every frame, while playback is on, it steps each engine
// (`r[e].step(a,{draw:!1})`), advances the timeline, pushes the new time into
// React state and redraws the canvas. The AI 特效 shell is an overlay - React
// never leaves 特效 - so all of that kept running underneath a panel that
// completely hides it, for as long as the artist stayed in AI 特效 (reported
// 2026-09-20: "AI特效版块的时候，粒子特效版块的内容还活跃着。这应该会影响性能").
//
// The loop now returns early while the shell is up. It keeps rescheduling (an
// empty callback per frame costs nothing and is what resumes it), and it keeps
// the frame timestamp fresh so the first real frame after coming back has a
// normal delta instead of the clamped 150ms catch-up. Nothing else changes:
// playback state, the timeline position and the canvas contents are exactly
// where they were, so returning to 粒子特效 looks like it was paused, not
// rewound.
//
// The leaving class is included because the shell stays painted through the
// ~230-350ms React needs to commit another section; resuming a frame early
// there would draw a particle frame behind a panel that is still covering it.
export function patchAifxParticleIdle(source) {
  const BEFORE =
    'if(!n||r.length===0){P.current=requestAnimationFrame(e);return}let i=F.current||t,';
  const GUARD =
    'if(document.body&&(document.body.classList.contains(`novaflow-aifx-open`)||document.body.classList.contains(`novaflow-aifx-leaving`))){F.current=t;P.current=requestAnimationFrame(e);return}';
  const AFTER =
    'if(!n||r.length===0){P.current=requestAnimationFrame(e);return}' + GUARD + 'let i=F.current||t,';

  if (source.includes(GUARD)) return source;
  const hits = source.split(BEFORE).length - 1;
  if (hits !== 1) {
    throw new Error(
      `patch-aifx-particle-idle: expected exactly one particle render loop anchor, found ${hits}`,
    );
  }
  return source.replace(BEFORE, AFTER);
}
