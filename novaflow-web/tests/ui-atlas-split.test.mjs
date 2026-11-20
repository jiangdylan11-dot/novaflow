import test from 'node:test';
import assert from 'node:assert/strict';
import '../renderer/ui-design.atlas-split.js';
const split = globalThis.NovaFlowUiAtlasSplit;

const row = (id, kind, name, extra) => ({ id, kind, name, box: [100, 100, 200, 200], ...extra });

test('whole foreground subjects and styled values survive inventory planning', () => {
  const result = split.plan([
    row('scene', 'group', 'Distant mountains'),
    row('subject', 'prop', 'Airship'),
    row('count', 'text', 'Score', { text: '99.00' }),
    row('plate', 'panel', 'Copper panel'),
    row('glow', 'effect', 'Lamp glow'),
  ]);
  assert.deepEqual(result.groups.map(g => g.type), ['background', 'panel', 'icon', 'text', 'effect']);
  assert.equal(result.groups[3].items[0][0].name, '99.00');
  assert.match(split.promptFor(result.groups[0], result.assets), /Airship at 100,100,200,200/);
  assert.doesNotMatch(split.promptFor(result.groups[0], result.assets), /Distant mountains/);
});

test('only fully visible icons with matching appearance share a source extraction', () => {
  const icon = (id, extra) => row(id, 'button', 'Sound', { appearance: 'copper', sourceComplete: true, ...extra });
  const {groups} = split.plan([icon('a'),icon('b'),icon('c',{appearance:'silver'}), icon('d',{uncertain:true})]);
  const source = groups.find(g => g.sourceComplete);
  assert.deepEqual(source.items.map(uses => uses.length), [2,1]);
  assert.deepEqual(groups.filter(g => g.type === 'icon' && !g.sourceComplete)[0].items.map(uses=>uses[0].id), ['d']);
});

test('asset sheets have an explicit order, capacity and vacant cell count', () => {
  const {groups} = split.plan(Array.from({length:19}, (_,i)=>row('item'+i,'icon','Object '+i)));
  assert.deepEqual(groups.slice(1).map(g=>[g.columns,g.rows,g.items.length]), [[4,4,16],[2,2,3]]);
  assert.match(split.promptFor(groups[2],[]),/1\. Object 16 at 100,100,200,200/);
  assert.throws(()=>split.plan([row('dup','icon','A'),row('dup','icon','B')]), /重复/);
  assert.throws(()=>split.plan([row('bad','icon','A',{box:[200,100,100,200]})]), /坐标/);
});
