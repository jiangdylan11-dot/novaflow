// Release-managed node capability; never derive these switches from renderer
// input, task contents, heartbeat fields, user config or process environment.
// A reviewed package can change the two literal booleans together only after
// the matching control plane and owner-bound storage are ready.
export const QWEN_ROTATION_RELEASE_POLICY = Object.freeze({
  verificationEnabled: false,
  candidateEnabled: false,
  planVerificationEnabled: true,
  planEnabled: true
});
