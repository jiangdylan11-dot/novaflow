import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(repoRoot, "particle-editor", "assets", "index-BbIa-2NM.js");
let source = fs.readFileSync(bundlePath, "utf8");
let changed = false;

function replaceExact(label, before, after) {
  if (source.includes(after)) {
    if (source.includes(before)) throw new Error(`${label}: both old and new forms are present`);
    return;
  }
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source anchor not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source anchor is ambiguous`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
  changed = true;
}

function replaceAnyExact(label, beforeVariants, after) {
  if (source.includes(after)) {
    const stale = beforeVariants.filter((before) => before !== after && source.includes(before));
    if (stale.length) throw new Error(`${label}: old and new forms are both present`);
    return;
  }
  const matches = beforeVariants.filter((before) => source.includes(before));
  if (matches.length !== 1) throw new Error(`${label}: expected one source anchor, found ${matches.length}`);
  const before = matches[0];
  const first = source.indexOf(before);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source anchor is ambiguous`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
  changed = true;
}

replaceExact(
  "AI sequence hidden playback video layout",
  "ce=(0,_.useMemo)(()=>{let e=te&&D?.objectUrl||F&&P?0:1;return{...Gt,...se,opacity:e,position:e===0?`absolute`:`relative`}},[te,D?.objectUrl,F,P,se])",
  "ce=(0,_.useMemo)(()=>{let e=te&&D?.objectUrl||F&&P?0:1;return{...Gt,...se,opacity:e}},[te,D?.objectUrl,F,P,se])"
);

replaceAnyExact(
  "AI sequence playback canvas layout",
  [
    "le=(0,_.useMemo)(()=>{let e=F&&P&&D?.objectUrl&&!te?`block`:`none`;return{...Kt,display:e}},[F,P,D?.objectUrl,te])",
    "le=(0,_.useMemo)(()=>{let e=F&&P&&D?.objectUrl&&!te?`block`:`none`;return{...Gt,...se,display:e}},[F,P,D?.objectUrl,te,se])"
  ],
  "le=(0,_.useMemo)(()=>{let e=F&&P&&D?.objectUrl&&!te?`block`:`none`;return{...Gt,...se,display:e,position:`absolute`,zIndex:2}},[F,P,D?.objectUrl,te,se])"
);

replaceExact(
  "AI sequence playback canvas pre-paint layout",
  "(0,_.useEffect)(()=>{if(!(F&&P&&D?.objectUrl&&!te)){q.current=-1;let e=ae.current;if(e)try{e.getContext(`2d`)?.clearRect(0,0,e.width,e.height)}catch{}return}let e=O.current,t=ae.current;if(!e||!t)return;let n=!1",
  "(0,_.useLayoutEffect)(()=>{if(!(F&&P&&D?.objectUrl&&!te)){q.current=-1;let e=ae.current;if(e)try{e.getContext(`2d`)?.clearRect(0,0,e.width,e.height)}catch{}return}let e=O.current,t=ae.current;if(!e||!t)return;t.style.left=`${e.offsetLeft}px`,t.style.top=`${e.offsetTop}px`,t.style.width=`${Math.max(1,e.offsetWidth)}px`,t.style.height=`${Math.max(1,e.offsetHeight)}px`;let n=!1"
);

replaceExact(
  "AI sequence playback canvas render-time bitmap size",
  "(0,X.jsx)(`canvas`,{ref:ae,style:le})",
  "(0,X.jsx)(`canvas`,{ref:ae,width:Math.max(1,Math.round(y*Math.max(1,window.devicePixelRatio||1))),height:Math.max(1,Math.round(b*Math.max(1,window.devicePixelRatio||1))),style:le})"
);

if (changed) fs.writeFileSync(bundlePath, source, "utf8");
console.log(changed ? `patched ${path.relative(repoRoot, bundlePath)}` : "AI sequence playback canvas layout already applied");
