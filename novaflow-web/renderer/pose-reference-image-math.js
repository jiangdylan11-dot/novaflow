const BODY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const finite = p => p && [p.x, p.y, p.z].every(Number.isFinite);

export function poseQuality(points, world) {
  if (!Array.isArray(points) || !Array.isArray(world) || points.length < 33 || world.length < 33 || !world.every(finite)) return null;
  if (BODY.some(i => !finite(points[i]))) return null;
  // Visibility describes occlusion, not whether the model found a person.
  // In overhead/lying views the hips can be present but hidden behind the torso.
  const present = BODY.filter(i => (points[i].presence ?? 1) >= 0.35);
  const visible = BODY.filter(i => (points[i].visibility ?? 1) >= 0.2);
  if (present.length < 6 || visible.length < 4) return null;
  const xs = BODY.map(i => points[i].x), ys = BODY.map(i => points[i].y);
  const box = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  const extent = Math.hypot(box.right - box.left, box.bottom - box.top);
  if (extent < 0.035 || box.right < 0 || box.left > 1 || box.bottom < 0 || box.top > 1) return null;
  const score = BODY.reduce((sum, i) => sum + (points[i].presence ?? 1) * (0.35 + 0.65 * (points[i].visibility ?? 1)), 0) / BODY.length;
  return { score, box, extent };
}

export function remapPoseResult(result, { rotation = 0, crop = { x: 0, y: 0, width: 1, height: 1 }, aspect = 1, pass = 0 } = {}) {
  const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const candidates = [];
  for (const [i, landmarks] of (result.landmarks || []).entries()) {
    const world = result.worldLandmarks?.[i]; if (!world) continue;
    const points = landmarks.map(p => {
      const [x, y] = rotation === 90 ? [p.y, 1 - p.x] : rotation === 180 ? [1 - p.x, 1 - p.y] : rotation === 270 ? [1 - p.y, p.x] : [p.x, p.y];
      return { ...p, x: crop.x + x * crop.width, y: crop.y + y * crop.height, z: p.z * (rotation % 180 ? crop.height / aspect : crop.width) };
    });
    const worldPoints = world.map(p => ({ ...p, x: cos * p.x + sin * p.y, y: -sin * p.x + cos * p.y }));
    const quality = poseQuality(points, worldPoints);
    if (quality) candidates.push({ points, world: worldPoints, pass, ...quality });
  }
  return candidates;
}

export function mergePoseCandidates(passes) {
  const groups = [];
  for (const candidates of passes) {
    const used = new Set();
    for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
      let best = -1, distance = Infinity;
      groups.forEach((group, index) => {
        if (used.has(index)) return;
        const other = group.best;
        const overlap = Math.max(0, Math.min(candidate.box.right, other.box.right) - Math.max(candidate.box.left, other.box.left)) * Math.max(0, Math.min(candidate.box.bottom, other.box.bottom) - Math.max(candidate.box.top, other.box.top));
        const area = b => (b.right - b.left) * (b.bottom - b.top);
        if (overlap / Math.max(1e-5, Math.min(area(candidate.box), area(other.box))) < 0.45) return;
        const d = BODY.reduce((sum, i) => sum + Math.hypot(candidate.points[i].x - other.points[i].x, candidate.points[i].y - other.points[i].y), 0) / BODY.length / Math.min(candidate.extent, other.extent);
        if (d < 0.16 && d < distance) { best = index; distance = d; }
      });
      if (best < 0) { groups.push({ best: candidate }); used.add(groups.length - 1); }
      else { used.add(best); if (candidate.score > groups[best].best.score) groups[best].best = candidate; }
    }
  }
  const selected = groups.map(g => g.best).sort((a, b) => b.score - a.score).slice(0, 16);
  return { landmarks: selected.map(p => p.points), worldLandmarks: selected.map(p => p.world), scores: selected.map(p => p.score) };
}
