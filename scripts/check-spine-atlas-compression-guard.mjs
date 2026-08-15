import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(
  repoRoot,
  "particle-editor",
  "assets",
  "index-BbIa-2NM.js"
);
const bundle = readFileSync(bundlePath, "utf8");

function findUniqueMarker(marker, label) {
  const markerIndex = bundle.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${label} marker is missing from the active bundle`);
  assert.equal(
    bundle.indexOf(marker, markerIndex + marker.length),
    -1,
    `${label} marker must remain unique so the contract checks the intended handler`
  );
  return markerIndex;
}

function extractStrongCompressionPayload(markerIndex, label) {
  const callMarker = "compressPngStrong(";
  const callIndex = bundle.indexOf(callMarker, markerIndex);
  assert.ok(
    callIndex >= markerIndex && callIndex - markerIndex < 1_000,
    `${label} must call compressPngStrong directly from its handler`
  );

  const objectStart = bundle.indexOf("{", callIndex + callMarker.length);
  assert.notEqual(objectStart, -1, `${label} compressPngStrong payload is missing`);

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = objectStart; index < bundle.length; index += 1) {
    const character = bundle[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return bundle.slice(objectStart, index + 1);
      }
    }
  }

  assert.fail(`${label} compressPngStrong payload is not a balanced object literal`);
}

const normalMarker = "正在进行 PNG 强压缩...";
const spineMarker = "正在进行 Spine 图集增强压缩...";
const normalMarkerIndex = findUniqueMarker(normalMarker, "ordinary PNG strong compression");
const spineMarkerIndex = findUniqueMarker(spineMarker, "Spine atlas enhanced compression");
const normalPayload = extractStrongCompressionPayload(
  normalMarkerIndex,
  "ordinary PNG strong compression"
);
const spinePayload = extractStrongCompressionPayload(
  spineMarkerIndex,
  "Spine atlas enhanced compression"
);
const spinePmaProfile = /\bprofile\s*:\s*([`'"])spine-atlas-pma\1/;

assert.match(
  spinePayload,
  spinePmaProfile,
  "Spine atlas enhanced compression must request the spine-atlas-pma profile"
);
assert.doesNotMatch(
  normalPayload,
  spinePmaProfile,
  "ordinary PNG strong compression must not opt into the Spine PMA profile"
);
assert.equal(
  [...bundle.matchAll(/profile\s*:\s*([`'"])spine-atlas-pma\1/g)].length,
  1,
  "the PMA profile must remain isolated to one explicit Spine enhanced handler"
);

assert.match(
  bundle,
  /forceOutput\s*:\s*[^,}]*spineAtlasProtection[^,}]*pmaConfirmed===!0&&!t\?\.spineAtlasProtection\?\.safeFallback&&Number\([^)]*inputDirtyTransparentEntries[^)]*\)>0/,
  "a dirty confirmed-PMA input must force the repaired output unless mismatch fallback activated"
);
assert.match(
  bundle,
  /n\.size>=t\.inputSize&&!u/,
  "the shared result handler must bypass keep-original only when forceOutput is requested"
);

const componentStart = bundle.lastIndexOf("function ", normalMarkerIndex);
const componentEnd = bundle.indexOf("function ", spineMarkerIndex + spineMarker.length);
assert.ok(
  componentStart >= 0 && componentEnd > spineMarkerIndex,
  "could not isolate the active PNG compression component"
);
const compressionComponent = bundle.slice(componentStart, componentEnd);

assert.ok(
  compressionComponent.includes("[Q,Z]=(0,_.useState)(`safe`)"),
  "Spine alpha setting must default to the non-premultiplied path"
);
assert.ok(
  compressionComponent.includes(
    "children:`原图是否开启预乘 Alpha？`}),(0,X.jsx)(nt,{value:Q,onChange:Z,options:[{value:`safe`,label:`未开启`},{value:`pma`,label:`已开启（PMA）`}]"
  ),
  "Spine compression UI must ask whether the source atlas enabled premultiplied alpha"
);
assert.ok(
  compressionComponent.includes(
    "Y=l===`spine`&&G.kind===`enhanced`&&Q===`pma`"
  ),
  "only explicit PMA plus enhanced strength may enter the palette route"
);
assert.ok(
  compressionComponent.includes(
    "if(Q!==`pma`||G.kind!==`enhanced`)return await he(e)"
  ),
  "the enhanced handler must defensively route non-confirmed input to Spine safe compression"
);
assert.ok(
  compressionComponent.includes(
    "l===`spine`?Y?await ge(t):await he(t)"
  ),
  "the batch path must use the explicit PMA gate"
);
assert.ok(
  compressionComponent.includes(
    "原图未开启预乘 Alpha：保持 RGBA 和直通 Alpha，不做调色板量化。请与 Spine 导出时的 Premultiply alpha 设置保持一致。"
  ),
  "the non-premultiplied behavior must be visible in the UI"
);
assert.ok(
  compressionComponent.includes(
    "原图已开启预乘 Alpha：55-100 启用透明边缘保护；检测到明显直通 Alpha 时自动回退 RGBA 兼容压缩。请与 Spine 导出时的 Premultiply alpha 设置保持一致。"
  ),
  "the premultiplied behavior and mismatch fallback must be visible in the UI"
);
assert.ok(
  !compressionComponent.includes("自动安全") && !compressionComponent.includes("已确认 PMA"),
  "the Spine compression UI must not expose the retired technical labels"
);
assert.match(
  compressionComponent,
  /PMA|预乘/,
  "Spine compression UI must explain its PMA edge protection"
);
assert.match(
  compressionComponent,
  /明显直通 Alpha[^`'"\r\n]{0,80}(?:自动回退|回退)[^`'"\r\n]{0,40}(?:RGBA 兼容|稳妥)/,
  "Spine compression UI must explain that a clear PMA mismatch falls back safely"
);

console.log("spine-atlas-compression-guard: PASS");
