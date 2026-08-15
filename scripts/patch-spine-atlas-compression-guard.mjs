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

function replaceAnyExact(label, beforeOptions, after) {
  if (source.includes(after)) {
    if (beforeOptions.some((before) => source.includes(before))) {
      throw new Error(`${label}: an old and final form are both present`);
    }
    return;
  }
  const matches = beforeOptions.flatMap((before) => {
    const first = source.indexOf(before);
    if (first < 0) return [];
    if (source.indexOf(before, first + before.length) >= 0) {
      throw new Error(`${label}: source anchor is ambiguous`);
    }
    return [{ before, first }];
  });
  if (matches.length !== 1) {
    throw new Error(`${label}: expected one old form, found ${matches.length}`);
  }
  const { before, first } = matches[0];
  source = source.slice(0, first) + after + source.slice(first + before.length);
  changed = true;
}

replaceExact(
  "explicit Spine alpha-mode state",
  "[b,x]=(0,_.useState)(42),[S,C]=(0,_.useState)(!1)",
  "[b,x]=(0,_.useState)(42),[Q,Z]=(0,_.useState)(`safe`),[S,C]=(0,_.useState)(!1)"
);

replaceExact(
  "explicit PMA route gate",
  "G=(0,_.useMemo)(()=>Xi(b),[b]),K=l===`spine`?G.kind===`safe`?I:P:W.kind===`lossless`?!0:P",
  "G=(0,_.useMemo)(()=>Xi(b),[b]),Y=l===`spine`&&G.kind===`enhanced`&&Q===`pma`,K=l===`spine`?Y?P:I:W.kind===`lossless`?!0:P"
);

replaceAnyExact(
  "Spine danger-zone notice",
  [
    "(0,_.useEffect)(()=>{A===`png_compress`&&l===`spine`&&G.zone===`danger`&&k(`当前已进入 Spine 图集高风险区，压缩率会更高，但请务必回到 Spine 里复播检查。`)},[A,l,G.zone])",
    "(0,_.useEffect)(()=>{A===`png_compress`&&l===`spine`&&G.zone===`danger`&&k(`当前已进入 Spine 图集 PMA 增强区；已启用透明边缘保护，Alpha 模式不明确或非预乘时会自动回退稳妥压缩。`)},[A,l,G.zone])",
    "(0,_.useEffect)(()=>{A===`png_compress`&&l===`spine`&&Q===`pma`&&G.zone===`danger`&&k(`当前已进入 Spine 图集 PMA 增强区；你已确认素材为 PMA，已启用透明边缘保护；检测到明显直通 Alpha 时会自动回退稳妥压缩。`)},[A,l,G.zone,Q])"
  ],
  "(0,_.useEffect)(()=>{A===`png_compress`&&l===`spine`&&Q===`pma`&&G.zone===`danger`&&k(`当前已进入 Spine 图集预乘 Alpha 增强区；原图已开启预乘 Alpha，已启用透明边缘保护；检测到明显直通 Alpha 时会自动回退 RGBA 兼容压缩。`)},[A,l,G.zone,Q])"
);

replaceExact(
  "compression result force-output fields",
  "keepOriginalMessage:s}=e,c=t.inputSize>0?Math.round(Math.abs(n.size-t.inputSize)/t.inputSize*100):0;if(n.size>=t.inputSize){",
  "keepOriginalMessage:s,forceOutput:u,forceOutputMessage:d}=e,c=t.inputSize>0?Math.round(Math.abs(n.size-t.inputSize)/t.inputSize*100):0;if(n.size>=t.inputSize&&!u){"
);

replaceExact(
  "compression result force-output message",
  "message:o.replace(`{ratio}`,String(c)),output:{fileName:a",
  "message:(u&&n.size>=t.inputSize?d||o:o).replace(`{ratio}`,String(c)),output:{fileName:a"
);

replaceExact(
  "Spine enhanced compression profile",
  "colors:G.colors,dither:Math.max(0,Math.min(1,G.dither/100))})",
  "colors:G.colors,dither:Math.max(0,Math.min(1,G.dither/100)),profile:`spine-atlas-pma`})"
);

replaceExact(
  "Spine enhanced handler explicit-PMA guard",
  "ge=async e=>{ae(e.id",
  "ge=async e=>{if(Q!==`pma`||G.kind!==`enhanced`)return await he(e);ae(e.id"
);

replaceAnyExact(
  "Spine enhanced compression result messages",
  [
    "fileName:Wi(e.name),successMessage:`Spine 增强区，已压缩 {ratio}%`,keepOriginalMessage:`原图已经更优，保留原图（增强压缩后会增大 {ratio}%）。`})",
    "fileName:Wi(e.name),successMessage:t?.spineAtlasProtection?.safeFallback?`Alpha 模式不明确或非预乘，已自动回退稳妥压缩 {ratio}%`:`PMA 透明边缘保护已完成，已压缩 {ratio}%`,keepOriginalMessage:t?.spineAtlasProtection?.safeFallback?`Alpha 模式不明确或非预乘，已保留原图（稳妥重编码会增大 {ratio}%）。`:`原图已经更优，且 PMA 透明边缘检查通过（增强压缩后会增大 {ratio}%）。`,forceOutput:t?.spineAtlasProtection?.alphaMode===`pma`&&Number(t?.spineAtlasProtection?.inputDirtyTransparentEntries||0)>0,forceOutputMessage:`原图含脏透明调色板，已输出 PMA 修复结果（体积增加 {ratio}%）。`})",
    "fileName:Wi(e.name),successMessage:t?.spineAtlasProtection?.safeFallback?`检测到明显直通 Alpha，已自动回退稳妥压缩 {ratio}%`:`已确认 PMA：透明边缘保护完成，已压缩 {ratio}%`,keepOriginalMessage:t?.spineAtlasProtection?.safeFallback?`检测到明显直通 Alpha，已保留原图（稳妥重编码会增大 {ratio}%）。`:`原图已经更优，且 PMA 透明边缘检查通过（增强压缩后会增大 {ratio}%）。`,forceOutput:t?.spineAtlasProtection?.pmaConfirmed===!0&&!t?.spineAtlasProtection?.safeFallback&&Number(t?.spineAtlasProtection?.inputDirtyTransparentEntries||0)>0,forceOutputMessage:`原图含脏透明调色板，已输出 PMA 修复结果（体积增加 {ratio}%）。`})"
  ],
  "fileName:Wi(e.name),successMessage:t?.spineAtlasProtection?.safeFallback?`检测到原图并非预乘 Alpha，已自动回退 RGBA 兼容压缩 {ratio}%`:`预乘 Alpha 图集：透明边缘保护完成，已压缩 {ratio}%`,keepOriginalMessage:t?.spineAtlasProtection?.safeFallback?`检测到原图并非预乘 Alpha，已保留原图（RGBA 兼容压缩会增大 {ratio}%）。`:`原图已经更优，且 PMA 透明边缘检查通过（增强压缩后会增大 {ratio}%）。`,forceOutput:t?.spineAtlasProtection?.pmaConfirmed===!0&&!t?.spineAtlasProtection?.safeFallback&&Number(t?.spineAtlasProtection?.inputDirtyTransparentEntries||0)>0,forceOutputMessage:`原图含脏透明调色板，已输出 PMA 修复结果（体积增加 {ratio}%）。`})"
);

replaceExact(
  "Spine batch progress route",
  "l===`spine`?G.kind===`safe`?`正在批量进行 Spine 图集稳妥压缩...`:`正在批量进行 Spine 图集增强压缩...`",
  "l===`spine`?Y?`正在批量进行 Spine 图集 PMA 增强压缩...`:`正在批量进行 Spine 图集稳妥压缩...`"
);

replaceExact(
  "Spine batch handler route",
  "for(let t of e)A===`png_compress`?l===`spine`?G.kind===`safe`?await he(t):await ge(t):await me(t):await _e(t,!0)",
  "for(let t of e)A===`png_compress`?l===`spine`?Y?await ge(t):await he(t):await me(t):await _e(t,!0)"
);

replaceExact(
  "Spine batch completion route",
  "l===`spine`?G.kind===`safe`?`批量 Spine 图集稳妥压缩完成。`:`批量 Spine 图集增强压缩完成。`",
  "l===`spine`?Y?`批量 Spine 图集 PMA 增强压缩完成。`:`批量 Spine 图集稳妥压缩完成。`"
);

replaceAnyExact(
  "Spine alpha-mode selector",
  [
    "]}):(0,X.jsxs)(X.Fragment,{children:[(0,X.jsxs)(`label`,{style:{display:`grid`,gap:6},children:[(0,X.jsxs)(`span`,{style:{color:`#bfe8d7`,fontSize:11,fontWeight:900},children:[`压缩强度 `,b]})",
    "]}):(0,X.jsxs)(X.Fragment,{children:[(0,X.jsx)(nt,{value:Q,onChange:Z,options:[{value:`safe`,label:`自动安全`},{value:`pma`,label:`已确认 PMA`}]}),(0,X.jsxs)(`label`,{style:{display:`grid`,gap:6},children:[(0,X.jsxs)(`span`,{style:{color:`#bfe8d7`,fontSize:11,fontWeight:900},children:[`压缩强度 `,b]})",
    "]}):(0,X.jsxs)(X.Fragment,{children:[(0,X.jsxs)(`div`,{style:{display:`grid`,gap:6},children:[(0,X.jsx)(`div`,{style:{color:`#bfe8d7`,fontSize:11,fontWeight:900},children:`原图是否开启预乘 Alpha？`}),(0,X.jsx)(nt,{value:Q,onChange:Z,options:[{value:`safe`,label:`未开启`},{value:`pma`,label:`已开启`}]})]}),(0,X.jsxs)(`label`,{style:{display:`grid`,gap:6},children:[(0,X.jsxs)(`span`,{style:{color:`#bfe8d7`,fontSize:11,fontWeight:900},children:[`压缩强度 `,b]})"
  ],
  "]}):(0,X.jsxs)(X.Fragment,{children:[(0,X.jsxs)(`div`,{style:{display:`grid`,gap:6},children:[(0,X.jsx)(`div`,{style:{color:`#bfe8d7`,fontSize:11,fontWeight:900},children:`原图是否开启预乘 Alpha？`}),(0,X.jsx)(nt,{value:Q,onChange:Z,options:[{value:`safe`,label:`未开启`},{value:`pma`,label:`已开启（PMA）`}]})]}),(0,X.jsxs)(`label`,{style:{display:`grid`,gap:6},children:[(0,X.jsxs)(`span`,{style:{color:`#bfe8d7`,fontSize:11,fontWeight:900},children:[`压缩强度 `,b]})"
);

replaceAnyExact(
  "Spine alpha-mode status",
  [
    "(0,X.jsxs)(`div`,{style:{color:G.zone===`danger`?`#fca5a5`:G.zone===`warning`?`#1ea672`:`#9a9a9a`,fontSize:10,lineHeight:1.7},children:[`当前：${G.zone===`safe`?`稳妥`:G.zone===`warning`?`增强`:`高风险`}。`,G.kind===`safe`?` 0-54 只走无损安全链。`:` 质量 ${G.quality}% / 颜色数 ${G.colors} / 抖动 ${G.dither}%`]})",
    "(0,X.jsx)(`div`,{style:{color:Y&&G.zone===`danger`?`#fca5a5`:Y?`#1ea672`:`#9a9a9a`,fontSize:10,lineHeight:1.7},children:Q===`safe`?`当前：自动安全。保持 RGBA / 直通 Alpha，不做调色板量化。`:G.kind===`safe`?`当前：已确认 PMA；0-54 仍走无损安全链。`:`当前：已确认 PMA。质量 ${G.quality}% / 颜色数 ${G.colors} / 抖动 ${G.dither}%`})"
  ],
  "(0,X.jsx)(`div`,{style:{color:Y&&G.zone===`danger`?`#fca5a5`:Y?`#1ea672`:`#9a9a9a`,fontSize:10,lineHeight:1.7},children:Q===`safe`?`当前：原图未开启预乘 Alpha。保留 RGBA / 直通 Alpha。`:G.kind===`safe`?`当前：原图已开启预乘 Alpha（PMA）；0-54 走无损压缩。`:`当前：原图已开启预乘 Alpha（PMA）。质量 ${G.quality}% / 颜色数 ${G.colors} / 抖动 ${G.dither}%`})"
);

replaceExact(
  "Spine safe-handler capability hint",
  "G.kind===`safe`&&!I?",
  "!Y&&!I?"
);

replaceExact(
  "Spine enhanced-handler capability hint",
  "G.kind===`enhanced`&&!P?",
  "Y&&!P?"
);

replaceAnyExact(
  "Spine compression help text",
  [
    "Spine 稳妥区只重写压缩流，不改图集像素；增强区压得更多，但请务必回到 Spine 里复播检查。",
    "Spine 稳妥区保持 RGBA；增强区会执行 PMA 透明边缘保护，Alpha 模式不明确或非预乘时自动回退稳妥压缩。",
    "${Q===`pma`?`已确认 PMA：0-54 仍走稳妥链；55-100 才启用透明边缘保护，检测到明显直通 Alpha 时仍自动回退。`:`自动安全 / 直通 Alpha（默认）：保持 RGBA，不做调色板量化。`}",
    "${Q===`pma`?`原图已开启预乘 Alpha：55-100 启用透明边缘保护；检测到明显直通 Alpha 时自动回退 RGBA 兼容压缩。`:`原图未开启预乘 Alpha：保持 RGBA 和直通 Alpha，不做调色板量化。`}"
  ],
  "${Q===`pma`?`原图已开启预乘 Alpha：55-100 启用透明边缘保护；检测到明显直通 Alpha 时自动回退 RGBA 兼容压缩。请与 Spine 导出时的 Premultiply alpha 设置保持一致。`:`原图未开启预乘 Alpha：保持 RGBA 和直通 Alpha，不做调色板量化。请与 Spine 导出时的 Premultiply alpha 设置保持一致。`}"
);

if (changed) fs.writeFileSync(bundlePath, source, "utf8");
console.log(changed ? `patched ${path.relative(repoRoot, bundlePath)}` : "Spine atlas compression guard already applied");
