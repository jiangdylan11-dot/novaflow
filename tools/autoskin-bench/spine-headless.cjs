// Load the vendored Spine 3.8 runtime headless in its own VM context (core
// classes only) with a stub attachment loader, so a skeleton JSON can be posed
// exactly the way the app's official player poses it -- IK, transform
// constraints, deform timelines and all -- without any texture or WebGL.
const REPO = require('path').join(__dirname, '..', '..').replace(/\\/g, '/');
const fs = require('fs'); const vm = require('vm');
const SRC = REPO + '/particle-editor/vendor/spine/spine-webgl-3.8.js';
const sandbox = { console, performance, Math, Date };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
sandbox.document = { createElement: () => ({ getContext: () => null }) };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'spine-webgl-3.8.js' });
const spine = sandbox.spine;
function dummyRegion(name) {
  return { name, u: 0, v: 0, u2: 1, v2: 1, rotate: false, degrees: 0, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, x: 0, y: 0, renderObject: null, texture: null };
}
class StubLoader {
  newRegionAttachment(skin, name, path) { const a = new spine.RegionAttachment(name); a.region = dummyRegion(path); return a; }
  newMeshAttachment(skin, name, path) { const a = new spine.MeshAttachment(name); a.region = dummyRegion(path); return a; }
  newBoundingBoxAttachment(skin, name) { return new spine.BoundingBoxAttachment(name); }
  newPathAttachment(skin, name) { return new spine.PathAttachment(name); }
  newPointAttachment(skin, name) { return new spine.PointAttachment(name); }
  newClippingAttachment(skin, name) { return new spine.ClippingAttachment(name); }
}
function loadSkeleton(jsonText) {
  const json = new spine.SkeletonJson(new StubLoader());
  let obj = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  // the 3.8 runtime refuses the exact export version 3.8.75 (a known-bad exporter build);
  // the data itself is ordinary 3.8, so relabel it for the bench
  if (obj && obj.skeleton && obj.skeleton.spine === '3.8.75') { obj = JSON.parse(JSON.stringify(obj)); obj.skeleton.spine = '3.8.99'; }
  const data = json.readSkeletonData(obj);
  const skeleton = new spine.Skeleton(data);
  skeleton.setToSetupPose(); skeleton.updateWorldTransform();
  return { data, skeleton };
}
/** Pose the skeleton at time t of an animation (fresh state each call). */
function poseAt(data, skeleton, animName, t) {
  const st = new spine.AnimationState(new spine.AnimationStateData(data));
  skeleton.setToSetupPose();
  st.setAnimation(0, animName, false);
  st.update(t); st.apply(skeleton); skeleton.updateWorldTransform();
  return skeleton;
}
module.exports = { spine, loadSkeleton, poseAt, StubLoader };
