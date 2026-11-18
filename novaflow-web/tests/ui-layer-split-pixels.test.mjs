// The pixel work behind a clean plate in UI 拆图, on drawn pictures (no model, no GPU): finding the letters in
// a text box, and painting text off a plate from the plate itself. Runs with the Foart runtime's Python (numpy and
// OpenCV are part of it); skipped where that runtime is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const python = process.env.FOART_TEST_PYTHON || 'C:/ProgramData/Foart/AI-Runtime/engine/python/python.exe';
const desktop = fileURLToPath(new URL('../../particle-editor-desktop/', import.meta.url));
const script = `
import json, sys
import numpy as np, cv2
sys.path.insert(0, sys.argv[1])
from prompt_assistant import ui_layer_split as S
H, W = 120, 400
# a sunset behind, a red pill with a top highlight and a darker bottom, white digits on it
sky = np.linspace([250, 200, 140], [230, 150, 110], H)[:, None, :].repeat(W, 1).astype(np.uint8)
plate = np.zeros((H, W), np.uint8); cv2.rectangle(plate, (70, 40), (330, 90), 1, -1); cv2.circle(plate, (70, 65), 25, 1, -1); cv2.circle(plate, (330, 65), 25, 1, -1)
plate = plate.astype(bool)
clean = sky.copy()
rows = np.linspace(0, 1, H)[:, None, None]
clean[plate] = (np.array([190, 50, 50]) * (1 - 0.35 * rows) + 0)[..., :].repeat(W, 1).astype(np.uint8)[plate]
clean[52:54][plate[52:54]] = (235, 120, 110)                      # the highlight line across the pill
drawn = clean.copy()
cv2.putText(drawn, "10,000", (130, 82), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 235, 235), 3, cv2.LINE_AA)
box = [126, 54, 262, 88]
glyphs = S.glyph_mask(drawn, box, W, H)
changed = np.abs(drawn.astype(int) - clean.astype(int)).sum(2) > 60
out = {"found": glyphs is not None}
if glyphs is not None:
    out["letters_covered"] = float((glyphs & changed).sum() / max(1, changed.sum()))
    out["box_share"] = float(glyphs.sum() / ((box[2] - box[0]) * (box[3] - box[1])))
    hole = S._mor(glyphs, cv2.MORPH_DILATE, 3)
    filled = S.row_fill(drawn, hole, plate)
    err = np.abs(filled.astype(int) - clean.astype(int)).sum(2)
    out["error_in_hole"] = float(err[hole & plate].mean())
    out["untouched_outside"] = bool((filled[~hole] == drawn[~hole]).all())
    out["text_left"] = float((np.abs(filled.astype(int) - clean.astype(int)).sum(2)[plate] > 60).mean())
# text on a busy picture is not letters-on-a-plate: the caller must fall back to the whole box
noise = np.random.default_rng(1).integers(0, 255, (H, W, 3)).astype(np.uint8)
out["busy_refused"] = S.glyph_mask(noise, box, W, H) is None
# a run that reaches the plate's end continues the plate, not what lies beside it
edge = clean.copy(); hole2 = np.zeros((H, W), bool); hole2[60:70, 46:120] = True
edge[hole2] = 255
filled2 = S.row_fill(edge, hole2, plate)
out["end_run_error"] = float(np.abs(filled2.astype(int) - clean.astype(int)).sum(2)[hole2 & plate].mean())
print(json.dumps(out))
`;

test('letters are found in a text box and painted off the plate from the plate itself', { skip: !existsSync(python) && 'the Foart runtime is not installed here' }, () => {
  const run = spawnSync(python, ['-B', '-c', script, desktop], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(run.status, 0, run.stderr.slice(-800));
  const out = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(out.found, true, 'white digits on a red pill are recognised as letters');
  assert.ok(out.letters_covered > 0.95, 'the mask covers the letters: ' + out.letters_covered);
  assert.ok(out.box_share < 0.7, 'and is much smaller than the box: ' + out.box_share);
  assert.ok(out.error_in_hole < 12, 'the plate under the letters comes back in its own colours, highlight included: ' + out.error_in_hole);
  assert.ok(out.text_left < 0.01, 'no letter remains on the plate: ' + out.text_left);
  assert.equal(out.untouched_outside, true, 'nothing outside the letters is repainted');
  assert.equal(out.busy_refused, true);
  assert.ok(out.end_run_error < 12, 'a hole at the plate\'s end is continued from the plate: ' + out.end_run_error);
});
