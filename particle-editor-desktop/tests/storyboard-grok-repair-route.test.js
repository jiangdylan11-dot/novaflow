const assert = require('node:assert/strict')
const {
  storyboardDirectorQualityNeedsRepair,
  runGrokStoryboardUnifiedNineShots
} = require('../admin-server/server')

const failingQuality = {
  ok: false,
  status: 'FAIL',
  issues: [{ code: 'CAMERA_NOT_INLINE', scenes: [2] }]
}
const passingQuality = { ok: true, status: 'PASS', issues: [] }

function createDependencies({ secondCallError = null, secondParseError = null } = {}) {
  const calls = []
  let parseCount = 0
  return {
    calls,
    dependencies: {
      buildStoryboardGrokPayload(payload) {
        return { kind: 'first', storyText: payload.storyText }
      },
      buildStoryboardGrokRepairPayload(payload, firstResult, quality) {
        assert.equal(firstResult.pass, 'first')
        assert.equal(quality, failingQuality)
        return { kind: 'repair', storyText: payload.storyText }
      },
      async callGrokChat(request) {
        calls.push(request)
        if (request.kind === 'repair' && secondCallError) throw secondCallError
        return { request }
      },
      parseStoryboardGrokResult(response) {
        parseCount += 1
        if (parseCount === 2 && secondParseError) throw secondParseError
        if (response.request.kind === 'repair') {
          return { pass: 'repair', directorQuality: passingQuality, generateProfile: { model: 'repair' } }
        }
        return { pass: 'first', directorQuality: failingQuality, generateProfile: { model: 'first' } }
      }
    }
  }
}

async function main() {
  assert.equal(storyboardDirectorQualityNeedsRepair(failingQuality), true)
  assert.equal(storyboardDirectorQualityNeedsRepair(passingQuality), false)

  const quotaCase = createDependencies()
  const quotaResult = await runGrokStoryboardUnifiedNineShots(
    { storyText: 'story', unifiedSeed: 'seed' },
    1,
    quotaCase.dependencies
  )
  assert.equal(quotaCase.calls.length, 1, 'one remaining call must not be exceeded')
  assert.equal(quotaResult.providerCallCount, 1)
  assert.equal(quotaResult.data.pass, 'first')
  assert.equal(quotaResult.data.repairUsed, false)
  assert.equal(quotaResult.data.repairSkippedReason, 'quota')
  assert.equal(quotaResult.data.firstPassDirectorQuality, failingQuality)

  const fallbackCalls = []
  const quotaFallbackResult = await runGrokStoryboardUnifiedNineShots(
    { storyText: 'story', unifiedSeed: 'seed' },
    1,
    {
      buildStoryboardGrokPayload() { return { kind: 'first' } },
      async callGrokChat(request) { fallbackCalls.push(request); return { request } },
      parseStoryboardGrokResult() {
        return { pass: 'first', shots: [{ scene: 1 }], directorQuality: failingQuality }
      },
      reconcileStoryboardGrokContinuity(shots) {
        assert.deepEqual(shots, [{ scene: 1 }])
        return {
          shots: [{ scene: 1, prompt: 'canonical' }],
          actions: [{ scene: 1, code: 'SUBJECT_STATE_INHERITED_WITHOUT_EVENT' }],
          directorQuality: passingQuality
        }
      }
    }
  )
  assert.equal(fallbackCalls.length, 1, 'quota fallback must not call Grok a second time')
  assert.equal(quotaFallbackResult.data.directorQuality, passingQuality)
  assert.equal(quotaFallbackResult.data.continuityFallbackUsed, true)
  assert.equal(quotaFallbackResult.data.continuityFallbackActions[0].code, 'SUBJECT_STATE_INHERITED_WITHOUT_EVENT')
  assert.equal(quotaFallbackResult.data.shots[0].prompt, 'canonical')

  const repairedCase = createDependencies()
  const repairedResult = await runGrokStoryboardUnifiedNineShots(
    { storyText: 'story', unifiedSeed: 'seed' },
    2,
    repairedCase.dependencies
  )
  assert.deepEqual(repairedCase.calls.map((request) => request.kind), ['first', 'repair'])
  assert.equal(repairedResult.providerCallCount, 2)
  assert.equal(repairedResult.data.pass, 'repair')
  assert.equal(repairedResult.data.repairUsed, true)
  assert.equal(repairedResult.data.firstPassDirectorQuality, failingQuality)
  assert.deepEqual(repairedResult.data.firstPassGenerateProfile, { model: 'first' })

  const callFailureCase = createDependencies({ secondCallError: new Error('repair provider unavailable') })
  const callFailureResult = await runGrokStoryboardUnifiedNineShots(
    { storyText: 'story', unifiedSeed: 'seed' },
    2,
    callFailureCase.dependencies
  )
  assert.equal(callFailureCase.calls.length, 2, 'repair must be attempted at most once')
  assert.equal(callFailureResult.providerCallCount, 1, 'only completed provider responses consume usage')
  assert.equal(callFailureResult.data.pass, 'first')
  assert.equal(callFailureResult.data.repairUsed, false)
  assert.match(callFailureResult.data.repairError, /repair provider unavailable/)

  const parseFailureCase = createDependencies({ secondParseError: new Error('repair JSON invalid') })
  const parseFailureResult = await runGrokStoryboardUnifiedNineShots(
    { storyText: 'story', unifiedSeed: 'seed' },
    2,
    parseFailureCase.dependencies
  )
  assert.equal(parseFailureResult.providerCallCount, 2, 'a completed repair provider call counts even when parsing fails')
  assert.equal(parseFailureResult.data.pass, 'first')
  assert.equal(parseFailureResult.data.repairUsed, false)
  assert.match(parseFailureResult.data.repairError, /repair JSON invalid/)

  console.log('storyboard Grok repair route tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
