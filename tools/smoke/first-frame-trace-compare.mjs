function numericValues(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

function maxDelta(left, right) {
  const a = numericValues(left)
  const b = numericValues(right)
  const limit = Math.min(a.length, b.length)
  let max = 0
  for (let index = 0; index < limit; index += 1) {
    max = Math.max(max, Math.abs(a[index] - b[index]))
  }
  return max
}

function receiptHasOverflow(receipt) {
  const state = receipt && receipt.overflowState
  return !!(state && (state.horizontalOverflow || state.panelOverflow))
}

function summarizeRun(result) {
  const receipts = Array.isArray(result.measurementReceipts) ? result.measurementReceipts : []
  const railWidths = receipts.map((receipt) => receipt.railWidth)
  return {
    sessionId: result.sessionId,
    protocol: result.protocol,
    consoleErrorCount: result.consoleErrorCount,
    runtimeChainStable: result.runtimeChainStable,
    receiptCount: receipts.length,
    sampleCount: result.trace && Array.isArray(result.trace.samples) ? result.trace.samples.length : 0,
    maxRailWidth: Math.max(0, ...numericValues(railWidths)),
    minRailWidth: Math.min(...numericValues(railWidths)),
    overflowDetected: receipts.some(receiptHasOverflow),
    legacyShellDetected: receipts.some((receipt) => receipt.legacyShellDetected === true),
    layoutShiftDetected: receipts.some((receipt) => receipt.layoutShiftDetected === true),
    screenshotCount: Array.isArray(result.screenshotSequence) ? result.screenshotSequence.length : 0
  }
}

export function compareFirstFrameTraces(left, right) {
  const leftReceipts = Array.isArray(left.measurementReceipts) ? left.measurementReceipts : []
  const rightReceipts = Array.isArray(right.measurementReceipts) ? right.measurementReceipts : []
  const leftRail = leftReceipts.map((receipt) => receipt.railWidth)
  const rightRail = rightReceipts.map((receipt) => receipt.railWidth)
  const leftTypes = new Set(leftReceipts.map((receipt) => receipt.traceType))
  const rightTypes = new Set(rightReceipts.map((receipt) => receipt.traceType))
  const missingTraceTypes = [...leftTypes].filter((type) => !rightTypes.has(type))
  const extraTraceTypes = [...rightTypes].filter((type) => !leftTypes.has(type))

  return {
    comparable: true,
    left: summarizeRun(left),
    right: summarizeRun(right),
    maxRailDelta: maxDelta(leftRail, rightRail),
    overflowChanged: leftReceipts.some(receiptHasOverflow) !== rightReceipts.some(receiptHasOverflow),
    legacyShellChanged: leftReceipts.some((receipt) => receipt.legacyShellDetected === true) !== rightReceipts.some((receipt) => receipt.legacyShellDetected === true),
    layoutShiftChanged: leftReceipts.some((receipt) => receipt.layoutShiftDetected === true) !== rightReceipts.some((receipt) => receipt.layoutShiftDetected === true),
    missingTraceTypes,
    extraTraceTypes
  }
}
