const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')
const browser = {}
vm.runInNewContext(fs.readFileSync(path.join(root, 'particle-editor/ai-sequence-minimax-h3-prompt.workflow.js'), 'utf8'), browser)
const workflow = browser.NovaFlowAiSequenceMiniMaxH3PromptWorkflow
const resource = (key, kind = 'image') => ({ key, kind, identity: key, occupied: true, mimeType: `${kind}/${kind === 'image' ? 'png' : 'mp4'}` })
const resources = {
  text_video: [], image_video: [resource('first_frame')],
  first_last: [resource('first_frame'), resource('last_frame')],
  multi_reference: [resource('multi_ref_image_1'), resource('multi_ref_video_1', 'video')]
}
const details = [
  'The room has two tall windows, a wooden desk, and a folded blue blanket on the chair.',
  'Soft side light reveals the fine weave of the coat and the pale grain of the desktop.',
  'The figure begins to turn, raises the cup slowly, then lowers it onto the desk.',
  'The camera holds a static shot while the hand gradually settles beside the cup.'
].join(' ')

function promptFor(mode, narrative = details) {
  const prefix = mode === 'image_video'
    ? '<Picture 1> from [Shot 1] = 0.00 seconds\n'
    : mode === 'first_last'
      ? '<Picture 1> from [Shot 1] = 0.00 seconds; <Picture 2> from [Shot 1] = 5.00 seconds (final shot)\n'
      : ''
  if (mode === 'multi_reference') return [
    'subject_definitions:', '<Subject 1>: the figure in <Picture 1>.', '<Video 1>: the camera-motion reference.',
    'summary: [reference generation] Follow the appearance of <Subject 1> and camera movement from <Video 1>.',
    'retention_analysis:', '<Subject 1>: fully_preserved - appearance.', '<Video 1>: weak_reference - camera motion only.',
    `detailed_description: Cinematic photography with soft lighting. [Shot 1] <Subject 1> is seated. ${narrative}`,
    'overall_soundscape: A quiet room tone and the soft click of the cup.', 'non_diegetic_music: N/A'
  ].join('\n')
  return `${prefix}integrated_multimodal_description: [Shot 1] ${narrative}\noverall_soundscape: A quiet room tone and the soft click of the cup.\nnon_diegetic_music: N/A`
}

for (const mode of Object.keys(resources)) {
  test(`${mode} requests and restores the official field layout with readable paragraphs`, () => {
    const options = { modelId: 'minimax_h3_local', mode, durationSeconds: 5, prompt: 'The figure gradually raises the cup.', resources: resources[mode] }
    const prepared = workflow.prepareRequest(options)
    assert.match(prepared.requirements, /blank lines/)
    assert.match(prepared.requirements, /describe each visual fact once/)
    assert.match(prepared.requirements, /without repeating them here/)
    const result = workflow.validateAndRestore({ text: promptFor(mode), context: prepared.context, current: options })
    const text = result.modelText
    const fields = Array.from(text.matchAll(/^([a-z_]+):/gm), (match) => match[1])
    assert.deepEqual(fields, Array.from(mode === 'multi_reference' ? workflow.REFERENCE_FIELD_ORDER : workflow.BASE_FIELD_ORDER))
    assert.match(text, /\n\noverall_soundscape:/)
    assert.match(text, /\n\nnon_diegetic_music:/)
    const visual = text.split(mode === 'multi_reference' ? 'detailed_description:' : 'integrated_multimodal_description:')[1].split('overall_soundscape:')[0]
    assert.ok(visual.split('\n\n').filter(Boolean).length >= 2)
    assert.ok(visual.split('\n\n').every((paragraph) => paragraph.trim().length < 300))
    assert.equal(workflow.validatePromptText(text, options).text, text, 'formatting must be idempotent')
    if (mode === 'multi_reference') {
      assert.match(text, /subject_definitions:\n<Subject 1>/)
      assert.match(text, /retention_analysis:\n<Subject 1>/)
      assert.match(text, /detailed_description: Cinematic[^\n]+\n\n\[Shot 1\]/)
      assert.match(prepared.requirements, /fully_copy, partially_copy, reference, weak_reference/)
    }
  })
}

test('layout preserves punctuation and newlines inside dialogue and visible text', () => {
  const dialogue = '<d>[Chinese] 等等！停下；\n别动。真的？</d>'
  const sign = '"入口。\n请稍候！"'
  const narrative = `${details} The figure (S1) says: ${dialogue} A sign reads ${sign}. Then the figure settles.`
  const text = workflow.validatePromptText(promptFor('text_video', narrative), { mode: 'text_video', durationSeconds: 5 }).text
  assert.ok(text.includes(dialogue))
  assert.ok(text.includes(sign))
  assert.equal(text.replace(/\s/g, ''), promptFor('text_video', narrative).replace(/\s/g, ''), 'layout cannot delete or invent prose')
})

test('reference appearance and camera motion do not imply keyframes or continuation', () => {
  const text = promptFor('multi_reference').replace('[reference generation] ', '')
  const result = workflow.validatePromptText(text, { mode: 'multi_reference', durationSeconds: 5, resources: resources.multi_reference })
  assert.deepEqual(Array.from(result.relations), ['reference generation'])
  assert.match(result.text, /summary: \[reference generation\]/)
})

test('cloud and desktop apply identical H3 generation and formatting rules', () => {
  const cloud = fs.readFileSync(path.join(root, 'supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs'), 'utf8').replace(/\r\n/g, '\n')
  const desktop = fs.readFileSync(path.join(root, 'particle-editor-desktop/admin-server/server.js'), 'utf8').replace(/\r\n/g, '\n')
  const block = (source, name) => {
    const start = source.indexOf(`function ${name}(`)
    assert.ok(start >= 0)
    return source.slice(start, source.indexOf('\n}', start + 1) + 2).trim()
  }
  for (const mode of ['text_video', 'image_video', 'first_last', 'full_reference']) {
    const rules = (source) => vm.runInNewContext(`(${block(source, 'miniMaxH3PromptProtocolRules')})`)(mode)
    assert.equal(rules(cloud), rules(desktop), mode)
  }
  for (const name of ['miniMaxH3VisualFactsSummary', 'miniMaxH3IntentSections', 'compileMiniMaxH3PromptFromVisualFacts']) {
    assert.equal(block(cloud, name), block(desktop, name), name)
  }
})
