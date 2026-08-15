const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const licenseCache = require("../license/licenseCache");
const licenseClient = require("../license/supabaseClient");
const {
  clearOnlineLicenseCache,
  verifyLicenseOnline
} = require("../license/licenseOnlineVerifier");

function createUserDataDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `novaflow-license-${label}-`));
}

function createOptions(userDataDir, overrides = {}) {
  const {
    licenseKey = "license-one",
    machineId = "machine-one",
    ...optionOverrides
  } = overrides;
  return {
    userDataDir,
    localState: {
      status: "licensed",
      machineId,
      payload: { licenseKey }
    },
    allowOfflineCache: false,
    source: "license-success-reuse-test",
    ...optionOverrides
  };
}

function activeLicenseResult(licenseKey, machineId) {
  return {
    status: 200,
    record: {
      license_key: licenseKey,
      machine_id: machineId,
      status: "active",
      expire_at: "2099-12-31T23:59:59.000Z",
      permissions: { export: true }
    }
  };
}

async function withMockedLicenseFetch(mockFetch, run) {
  const originalFetch = licenseClient.fetchLicenseRecordByKey;
  licenseClient.fetchLicenseRecordByKey = mockFetch;
  try {
    await run();
  } finally {
    licenseClient.fetchLicenseRecordByKey = originalFetch;
  }
}

async function removeUserDataDir(userDataDir) {
  await clearOnlineLicenseCache(userDataDir, "test_cleanup");
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

test("online success is reused only inside the requested TTL and scope", async () => {
  const userDataDir = createUserDataDir("reuse-ttl");
  const originalDateNow = Date.now;
  let now = 1_800_000_000_000;
  let fetchCount = 0;
  Date.now = () => now;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const options = createOptions(userDataDir, {
        successReuseMs: 1_000,
        successReuseScope: "export:ai-sequence"
      });

      const first = await verifyLicenseOnline(options);
      now += 999;
      const reused = await verifyLicenseOnline({
        ...options,
        source: "license-success-reuse-test:next-frame"
      });

      assert.equal(first.status, "licensed");
      assert.equal(reused.status, "licensed");
      assert.equal(fetchCount, 1, "a fresh success should satisfy the next frame without another network request");

      now += 2;
      const refreshed = await verifyLicenseOnline(options);
      assert.equal(refreshed.status, "licensed");
      assert.equal(fetchCount, 2, "an expired success lease must be verified online again");
    });
  } finally {
    Date.now = originalDateNow;
    await removeUserDataDir(userDataDir);
  }
});

test("a 102-frame sequence export uses one online verification inside the lease", async () => {
  const userDataDir = createUserDataDir("sequence-102");
  const originalDateNow = Date.now;
  let now = 1_800_000_000_000;
  let fetchCount = 0;
  Date.now = () => now;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const options = createOptions(userDataDir, {
        successReuseMs: 30_000,
        successReuseScope: "export:1"
      });

      for (let frame = 0; frame < 102; frame += 1) {
        const state = await verifyLicenseOnline({
          ...options,
          source: `write-binary-file:${frame}`
        });
        assert.equal(state.status, "licensed");
        now += 100;
      }

      assert.equal(fetchCount, 1, "102 frame writes inside 30 seconds must not consume the server rate limit per frame");
    });
  } finally {
    Date.now = originalDateNow;
    await removeUserDataDir(userDataDir);
  }
});

test("remote expiry bounds a success lease even when its requested TTL is longer", async () => {
  const userDataDir = createUserDataDir("remote-expiry");
  const originalDateNow = Date.now;
  let now = 1_800_000_000_000;
  let fetchCount = 0;
  Date.now = () => now;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return {
          ...activeLicenseResult(licenseKey, machineId),
          record: {
            ...activeLicenseResult(licenseKey, machineId).record,
            expire_at: new Date(now + 500).toISOString()
          }
        };
      }
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const options = createOptions(userDataDir, {
        successReuseMs: 30_000,
        successReuseScope: "export:ai-sequence"
      });

      assert.equal((await verifyLicenseOnline(options)).status, "licensed");
      now += 499;
      assert.equal((await verifyLicenseOnline(options)).status, "licensed");
      assert.equal(fetchCount, 1);

      now += 2;
      assert.equal((await verifyLicenseOnline(options)).status, "licensed");
      assert.equal(fetchCount, 2, "remote expiration must force a fresh verification before the reuse TTL ends");
    });
  } finally {
    Date.now = originalDateNow;
    await removeUserDataDir(userDataDir);
  }
});

test("concurrent verification for the same reuse key is single-flight", async () => {
  const userDataDir = createUserDataDir("single-flight");
  let fetchCount = 0;
  let releaseFetch;
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve;
  });
  const originalAppendLicenseLog = licenseCache.appendLicenseLog;
  licenseCache.appendLicenseLog = async () => {};

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      await fetchGate;
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const options = createOptions(userDataDir, {
        successReuseMs: 30_000,
        successReuseScope: "export:ai-sequence"
      });
      const pending = [
        verifyLicenseOnline(options),
        verifyLicenseOnline(options),
        verifyLicenseOnline(options)
      ];

      await new Promise((resolve) => setImmediate(resolve));
      const fetchCountBeforeRelease = fetchCount;
      releaseFetch();
      const states = await Promise.all(pending);
      assert.deepEqual(states.map((state) => state.status), ["licensed", "licensed", "licensed"]);
      assert.equal(fetchCountBeforeRelease, 1, "parallel frame writes must share one online verification");
      assert.equal(fetchCount, 1);
    });
  } finally {
    releaseFetch?.();
    licenseCache.appendLicenseLog = originalAppendLicenseLog;
    await removeUserDataDir(userDataDir);
  }
});

test("network failures and explicit rejections are never added to the success cache", async () => {
  const cases = [
    {
      label: "network-failure",
      firstResult: { record: null, status: 429, error: "license verification rate limit exceeded" },
      expectedReason: "license verification rate limit exceeded"
    },
    {
      label: "explicit-rejection",
      firstResult: { record: null, status: 200, rejectionReason: "license_rejected" },
      expectedReason: "license_rejected"
    }
  ];

  for (const scenario of cases) {
    const userDataDir = createUserDataDir(scenario.label);
    let fetchCount = 0;
    try {
      await withMockedLicenseFetch(async (licenseKey, machineId) => {
        fetchCount += 1;
        return fetchCount === 1
          ? scenario.firstResult
          : activeLicenseResult(licenseKey, machineId);
      }, async () => {
        const options = createOptions(userDataDir, {
          successReuseMs: 30_000,
          successReuseScope: "export:ai-sequence"
        });

        const failed = await verifyLicenseOnline(options);
        const retried = await verifyLicenseOnline(options);

        assert.equal(failed.status, "locked", `${scenario.label} should fail closed`);
        assert.equal(failed.reason, scenario.expectedReason);
        assert.equal(retried.status, "licensed", `${scenario.label} must be retried online instead of reused`);
        assert.equal(fetchCount, 2);
      });
    } finally {
      await removeUserDataDir(userDataDir);
    }
  }
});

test("an explicit rejection in one scope clears other scopes for the same license identity", async () => {
  const userDataDir = createUserDataDir("cross-scope-rejection");
  let fetchCount = 0;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      if (fetchCount === 2) {
        return { record: null, status: 200, rejectionReason: "license_rejected" };
      }
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const shared = { successReuseMs: 30_000 };
      const aiSequence = createOptions(userDataDir, {
        ...shared,
        successReuseScope: "export:ai-sequence"
      });
      const spineSequence = createOptions(userDataDir, {
        ...shared,
        successReuseScope: "export:spine-sequence"
      });

      assert.equal((await verifyLicenseOnline(aiSequence)).status, "licensed");
      const rejected = await verifyLicenseOnline(spineSequence);
      assert.equal(rejected.status, "locked");
      assert.equal(rejected.reason, "license_rejected");

      assert.equal((await verifyLicenseOnline(aiSequence)).status, "licensed");
      assert.equal(fetchCount, 3, "an authoritative rejection must invalidate successes in every scope for that identity");
    });
  } finally {
    await removeUserDataDir(userDataDir);
  }
});

test("a cached online success never overrides an expired or unlicensed local state", async () => {
  const userDataDir = createUserDataDir("local-state-priority");
  let fetchCount = 0;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const options = createOptions(userDataDir, {
        successReuseMs: 30_000,
        successReuseScope: "export:ai-sequence"
      });
      assert.equal((await verifyLicenseOnline(options)).status, "licensed");
      assert.equal(fetchCount, 1);

      for (const status of ["expired", "unlicensed"]) {
        const localFailure = await verifyLicenseOnline({
          ...options,
          localState: {
            ...options.localState,
            status,
            error: `local_${status}`
          }
        });
        assert.equal(localFailure.status, status);
        assert.equal(localFailure.locked, true);
      }
      assert.equal(fetchCount, 1, "invalid local states must lock before cache lookup or network access");
    });
  } finally {
    await removeUserDataDir(userDataDir);
  }
});

test("success reuse is isolated by user data directory, license identity, machine and scope", async () => {
  const firstUserDataDir = createUserDataDir("identity-a");
  const secondUserDataDir = createUserDataDir("identity-b");
  let fetchCount = 0;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const shared = {
        successReuseMs: 30_000,
        successReuseScope: "export:ai-sequence"
      };
      const variants = [
        createOptions(firstUserDataDir, shared),
        createOptions(firstUserDataDir, { ...shared, successReuseScope: "export:spine-sequence" }),
        createOptions(firstUserDataDir, { ...shared, licenseKey: "license-two" }),
        createOptions(firstUserDataDir, { ...shared, machineId: "machine-two" }),
        createOptions(secondUserDataDir, shared)
      ];

      for (const options of variants) {
        assert.equal((await verifyLicenseOnline(options)).status, "licensed");
      }
      for (const options of variants) {
        assert.equal((await verifyLicenseOnline(options)).status, "licensed");
      }

      assert.equal(fetchCount, variants.length, "each complete reuse identity should own exactly one online success");
    });
  } finally {
    await removeUserDataDir(firstUserDataDir);
    await removeUserDataDir(secondUserDataDir);
  }
});

test("reuse remains opt-in and clearing a license invalidates its success lease", async () => {
  const userDataDir = createUserDataDir("default-and-clear");
  let fetchCount = 0;

  try {
    await withMockedLicenseFetch(async (licenseKey, machineId) => {
      fetchCount += 1;
      return activeLicenseResult(licenseKey, machineId);
    }, async () => {
      const legacyOptions = createOptions(userDataDir);
      await verifyLicenseOnline(legacyOptions);
      await verifyLicenseOnline(legacyOptions);
      assert.equal(fetchCount, 2, "omitting successReuseMs must preserve the previous always-online behavior");

      const reusableOptions = createOptions(userDataDir, {
        successReuseMs: 30_000,
        successReuseScope: "export:ai-sequence"
      });
      await verifyLicenseOnline(reusableOptions);
      await verifyLicenseOnline(reusableOptions);
      assert.equal(fetchCount, 3);

      await clearOnlineLicenseCache(userDataDir, "license_replaced");
      await verifyLicenseOnline(reusableOptions);
      assert.equal(fetchCount, 4, "clearing the license cache must invalidate in-memory success reuse");
    });
  } finally {
    await removeUserDataDir(userDataDir);
  }
});

test("desktop export wiring limits reuse to export and preserves internal cutout bypasses", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

  assert.match(mainSource, /const ONLINE_EXPORT_AUTH_SUCCESS_REUSE_MS = 30_000;/);
  assert.match(mainSource, /const successReuseMs = feature === "export" \? ONLINE_EXPORT_AUTH_SUCCESS_REUSE_MS : 0;/);
  assert.match(mainSource, /`\$\{feature\}:\$\{onlineEntitlementSuccessReuseGeneration\}`/);
  assert.match(mainSource, /invalidateOnlineEntitlementSuccessReuse\("license-remove"\)/);
  assert.match(mainSource, /invalidateOnlineEntitlementSuccessReuse\("license-import-file"\)/);
  assert.match(mainSource, /invalidateOnlineEntitlementSuccessReuse\("license-import-text"\)/);
  assert.match(mainSource, /if \(!isInternalCutoutSaveFrameWrite\(dir, fileName\)\) \{\s*await assertOnlineEntitled\("export", "write-binary-file"\);/);
  assert.match(mainSource, /if \(!isInternalCutoutSaveTempCreate\(payload\)\) \{\s*await assertOnlineEntitled\("export", "export-create-temp-dir"\);/);
  assert.match(mainSource, /if \(!isInternalCutoutSaveFrameEncode\(payload\)\) \{\s*await assertOnlineEntitled\("export", "export-encode-frames-to-video"\);/);
});
