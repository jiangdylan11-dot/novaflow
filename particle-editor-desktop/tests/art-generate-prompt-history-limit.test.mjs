import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The drawing (art generate) prompt history lives in the brand runtime. Saved slots and recent
// entries share one 15-row budget, matching the AI sequence prompt history in the shipped bundle.
const source = fs.readFileSync(new URL('../../particle-editor/novaflow-brand-runtime.js', import.meta.url), 'utf8');

function extractNamedFunction(input, name) {
  const marker = `function ${name}(`;
  const start = input.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = input.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return input.slice(start, index + 1);
  }
  throw new Error(`${name} body is incomplete`);
}

function extractConst(name) {
  const match = source.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, `${name} should exist`);
  return `const ${name} = ${match[1]};`;
}

const FUNCTIONS = [
  'normalizeArtGeneratePromptHistoryText',
  'artGeneratePromptHistoryCompareKey',
  'createEmptyArtGeneratePromptHistorySlots',
  'countArtGeneratePromptHistoryPinned',
  'getArtGeneratePromptHistoryRecentCap',
  'normalizeArtGeneratePromptHistoryItem',
  'normalizeArtGeneratePromptHistoryItems',
  'normalizeArtGeneratePromptHistorySlots',
  'normalizeArtGeneratePromptHistoryGroup',
  'artGeneratePromptHistoryStateKeys',
  'ensureArtGeneratePromptHistoryLoaded',
  'saveArtGeneratePromptHistory',
  'getArtGeneratePromptHistoryGroup',
  'addArtGeneratePromptHistoryValue',
  'saveArtGeneratePromptHistorySlot',
  'removeArtGeneratePromptHistoryRecent',
  'clearArtGeneratePromptHistorySlot',
  'buildArtGeneratePromptHistoryPopoverEntries'
];

function mountArtHistory(storage) {
  const context = vm.createContext({ Date, localStorage: storage, console });
  vm.runInContext([
    extractConst('ART_GENERATE_PROMPT_HISTORY_STORAGE_KEY'),
    extractConst('ART_GENERATE_PROMPT_HISTORY_SLOT_COUNT'),
    extractConst('ART_GENERATE_PROMPT_HISTORY_TOTAL_CAP'),
    'const ART_GENERATE_STATE = { prompt: "", negativePrompt: "", promptHistory: [], negativePromptHistory: [], promptPinnedSlots: [], negativePromptPinnedSlots: [], historyLoaded: false };',
    ...FUNCTIONS.map((name) => extractNamedFunction(source, name)),
    'this.api = { ' + FUNCTIONS.map((name) => `${name}`).join(', ') + ', ART_GENERATE_STATE, ART_GENERATE_PROMPT_HISTORY_TOTAL_CAP, ART_GENERATE_PROMPT_HISTORY_SLOT_COUNT };'
  ].join('\n'), context);
  return context.api;
}

function createStorage(values = new Map()) {
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value))
  };
}

const longPrompt = (label) => `${label}：` + '完整提示词。'.repeat(100);

test('art prompt history budget is 15 rows shared between saved slots and recent entries', () => {
  const storage = createStorage();
  const api = mountArtHistory(storage);
  assert.equal(api.ART_GENERATE_PROMPT_HISTORY_TOTAL_CAP, 15);
  assert.equal(api.ART_GENERATE_PROMPT_HISTORY_SLOT_COUNT, 5);
  for (const key of ['prompt', 'negativePrompt']) {
    for (let i = 0; i < 22; i += 1) api.addArtGeneratePromptHistoryValue(key, longPrompt(`普通动作 ${i}`));
    let group = api.getArtGeneratePromptHistoryGroup(key);
    assert.equal(group.recent.length, 15, `${key} recent caps at 15 with no saved slots`);
    assert.match(group.recent[0].text, /动作 21/);
    assert.match(group.recent[14].text, /动作 7/);
    assert.ok(group.recent.every((item) => item.text.length > 500), 'full prompt text is preserved');
    assert.equal(api.buildArtGeneratePromptHistoryPopoverEntries(key).length, 15);

    for (let i = 0; i < 5; i += 1) api.saveArtGeneratePromptHistorySlot(key, `保存动作 ${i}`);
    group = api.getArtGeneratePromptHistoryGroup(key);
    assert.equal(group.pinnedSlots.filter(Boolean).length, 5);
    assert.equal(group.recent.length, 10, `${key} recent shrinks to 10 once 5 slots are saved`);
    const entries = api.buildArtGeneratePromptHistoryPopoverEntries(key);
    assert.equal(entries.length, 15, 'popover shows the full 15-row budget');
    assert.equal(entries[0].options.primary, true);
    assert.equal(entries.slice(1, 6).map((entry) => entry.options.slotIndex0).join(","), "0,1,2,3,4", "saved slots follow the current entry in slot order");

    api.addArtGeneratePromptHistoryValue(key, '新增普通动作');
    group = api.getArtGeneratePromptHistoryGroup(key);
    assert.equal(group.recent.length, 10, 'adding while full keeps the 10 recent budget');
    assert.equal(group.recent[0].text, '新增普通动作');

    api.clearArtGeneratePromptHistorySlot(key, 2);
    api.addArtGeneratePromptHistoryValue(key, '释放槽位后的动作');
    group = api.getArtGeneratePromptHistoryGroup(key);
    assert.equal(group.pinnedSlots.filter(Boolean).length, 4);
    assert.equal(group.recent.length, 11, 'freeing a slot hands its row back to recent entries');
    assert.equal(api.buildArtGeneratePromptHistoryPopoverEntries(key).length, 15);

    api.removeArtGeneratePromptHistoryRecent(key, '释放槽位后的动作');
    assert.equal(api.getArtGeneratePromptHistoryGroup(key).recent.length, 10);
  }
});

test('persisted art prompt history reloads with the same 15-row budget and legacy data grows to fifteen', () => {
  const storage = createStorage();
  const api = mountArtHistory(storage);
  for (let i = 0; i < 20; i += 1) api.addArtGeneratePromptHistoryValue('prompt', `动作 ${i}`);
  for (let i = 0; i < 3; i += 1) api.saveArtGeneratePromptHistorySlot('prompt', `保存 ${i}`);
  const stored = storage.getItem('novaflow_art_generate_prompt_history_v1');
  assert.ok(stored);
  const reloaded = mountArtHistory(createStorage(new Map(storage.values)));
  const group = reloaded.getArtGeneratePromptHistoryGroup('prompt');
  assert.equal(group.pinnedSlots.filter(Boolean).length, 3);
  assert.equal(group.recent.length, 12);
  assert.equal(reloaded.buildArtGeneratePromptHistoryPopoverEntries('prompt').length, 15);

  const legacy = createStorage(new Map([[
    'novaflow_art_generate_prompt_history_v1',
    JSON.stringify({ prompt: Array.from({ length: 12 }, (_, i) => ({ text: `旧记录${i}`, at: i + 1 })) })
  ]]));
  const legacyApi = mountArtHistory(legacy);
  assert.equal(legacyApi.getArtGeneratePromptHistoryGroup('prompt').recent.length, 12, 'legacy entries beyond the old 10 cap are kept');
  for (let i = 0; i < 6; i += 1) legacyApi.addArtGeneratePromptHistoryValue('prompt', `新记录${i}`);
  assert.equal(legacyApi.getArtGeneratePromptHistoryGroup('prompt').recent.length, 15);
});
