const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const source = fs.readFileSync(path.join(__dirname, '../../particle-editor/assets/index-BbIa-2NM.js'), 'utf8')

test('H3 low-VRAM switch follows random seed and replaces the version selector', () => {
  assert.ok(!source.includes('data-novaflow-h3-profile'))
  assert.ok(!source.includes('data-novaflow-h3-internal-turbo'))
  const start = source.indexOf('(0,X.jsxs)(`div`,{"data-novaflow-h3-low-vram-control"')
  const endMarker = 'transform:`translateY(-50%)`}})})]})'
  const end = source.indexOf(endMarker, start) + endMarker.length
  assert.ok(start > 0 && end > start)
  const settingsStart = source.lastIndexOf('"data-novaflow-h3-steps"', start)
  assert.ok(source.slice(settingsStart, start).includes('children:`随机种子`'))
  const fragment = source.slice(start, end)
  const jsx = (type, props) => ({ type, props })
  for (const profile of ['beta5_int8', 'beta5_fp8']) {
    let next
    const view = vm.runInNewContext(fragment, {
      X: { jsx, jsxs: jsx }, nfH3Profile: profile,
      nfChangeH3Profile: value => { next = value },
    })
    const button = view.props.children[1]
    assert.equal(button.props.role, 'switch')
    assert.equal(button.props['aria-label'], '低显存')
    assert.equal(button.props['aria-checked'], profile === 'beta5_fp8')
    button.props.onClick()
    assert.equal(next, profile === 'beta5_fp8' ? 'beta5_int8' : 'beta5_fp8')
  }
})

test('changing low-VRAM mode changes only model selection, not generation controls', () => {
  const start = source.indexOf('nfChangeH3Profile=') + 'nfChangeH3Profile='.length
  const end = source.indexOf(',nfH3AspectOptions=', start)
  let persisted, selected
  const change = vm.runInNewContext('(' + source.slice(start, end) + ')', {
    nfH3WorkflowApi: () => ({ setSelectedProfile(value) { persisted = value; return value } }),
    nfSetH3Profile: value => { selected = value },
  })
  change('beta5_fp8')
  assert.equal(persisted, 'beta5_fp8')
  assert.equal(selected, 'beta5_fp8')
  change('beta5_int8')
  assert.equal(selected, 'beta5_int8')
})
