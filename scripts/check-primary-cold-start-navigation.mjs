#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bundlePath = "particle-editor/assets/index-BbIa-2NM.js";
const indexPath = "particle-editor/index.html";
const bundle = readFileSync(bundlePath, "utf8");
const index = readFileSync(indexPath, "utf8");

const initializerStartMarker = "if(!Bo||rs.current||!n)return;";
const initializerEndMarker = "rs.current=!0},[Bo,So,n,fi,s])";
const initializerStart = bundle.indexOf(initializerStartMarker);
const initializerEnd = bundle.indexOf(initializerEndMarker, initializerStart);

assert.ok(initializerStart >= 0, "Cold-start template initializer must remain locatable");
assert.ok(initializerEnd > initializerStart, "Cold-start template initializer must keep its one-shot boundary");

const initializer = bundle.slice(
  initializerStart,
  initializerEnd + initializerEndMarker.length
);

assert.doesNotMatch(
  initializer,
  /ie\(`particle`\)/,
  "Template hydration must not overwrite an explicit primary navigation target"
);
assert.match(
  initializer,
  /g\(!0\),b\(0\)/,
  "Cold-start particle preview initialization must remain intact"
);
assert.match(
  initializer,
  /So\?\.\[0\]\?\.config\|\|So\?\.\[0\]\?\.systems\?\.\[0\]/,
  "Cold-start template selection must remain intact"
);
assert.match(
  initializer,
  /s\(\{\.\.\.e\?as\(e\):os\(\),id:n\.id\}\)/,
  "Cold-start particle configuration seeding must remain intact"
);
assert.match(
  initializer,
  /rs\.current=!0/,
  "Cold-start initialization must still close exactly once"
);

assert.match(
  bundle,
  /\[K,ie\]=\(0,_\.useState\)\(`particle`\)/,
  "An untouched cold start must still default to Particle"
);
assert.match(
  bundle,
  /K===`particle`\?`particle`:K===`spine`\?`animation`:K===`ai_design`\?`art`:K===`tools`\?`tools`/,
  "Body-class publication must remain owned by the React primary category"
);
assert.match(
  index,
  /assets\/index-BbIa-2NM\.js\?v=20260714-cold-primary-navigation-1/,
  "The cold-start renderer fix must publish with a fresh bundle cache key"
);

console.log("PASS primary cold-start navigation contract");
