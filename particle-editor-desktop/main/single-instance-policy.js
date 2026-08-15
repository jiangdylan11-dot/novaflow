const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function cleanPathValue(value) {
  return String(value || "").trim().replace(/^"|"$/g, "");
}

function resolveSingleInstanceProfile(options = {}) {
  const execPath = cleanPathValue(options.execPath);
  const argv = Array.isArray(options.argv) ? options.argv : [];
  const env = options.env && typeof options.env === "object" ? options.env : {};
  const launcherRoot = cleanPathValue(env.PORTABLE_EXECUTABLE_DIR);
  const exeDir = execPath ? path.dirname(execPath) : "";
  const explicitPortable = argv.some((arg) => String(arg || "") === "--portable");
  const unpackedPortable = exeDir.toLowerCase().includes("win-unpacked");
  const portableRoot = launcherRoot
    ? path.resolve(launcherRoot)
    : (explicitPortable || unpackedPortable) && exeDir
      ? path.resolve(exeDir)
      : "";

  if (!portableRoot) return { kind: "installed", portableRoot: "", userDataPath: "" };
  return {
    kind: "portable",
    portableRoot,
    userDataPath: path.join(portableRoot, "user-data"),
  };
}

function preparePortableUserDataPath(profile, options = {}) {
  if (!profile || profile.kind !== "portable") return { ...(profile || {}) };
  const fsApi = options.fs || fs;
  const portableRootValue = cleanPathValue(profile.portableRoot);
  if (!portableRootValue) throw new Error("portable_root_missing");
  const portableRoot = path.resolve(portableRootValue);
  const preferredPath = path.resolve(cleanPathValue(profile.userDataPath) || path.join(portableRoot, "user-data"));
  const rootKey = crypto.createHash("sha256")
    .update(portableRoot.toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const candidates = [preferredPath];
  for (const basePath of [options.appDataPath, options.tempPath]) {
    const cleanBasePath = cleanPathValue(basePath);
    if (cleanBasePath) candidates.push(path.join(path.resolve(cleanBasePath), "NovaFlowPortable", rootKey, "user-data"));
  }

  const attempted = new Set();
  const errors = [];
  for (const candidatePath of candidates) {
    const key = candidatePath.toLowerCase();
    if (attempted.has(key)) continue;
    attempted.add(key);
    try {
      fsApi.mkdirSync(candidatePath, { recursive: true });
      return {
        ...profile,
        portableRoot,
        userDataPath: candidatePath,
        userDataFallback: candidatePath !== preferredPath,
      };
    } catch (error) {
      errors.push({ path: candidatePath, code: String(error && error.code || "") });
    }
  }

  const error = new Error("portable_user_data_unavailable");
  error.code = "NOVAFLOW_PORTABLE_USER_DATA_UNAVAILABLE";
  error.attempts = errors;
  throw error;
}

function decideSecondInstanceAction(options = {}) {
  if (String(options.primaryKind || "") === "portable") return "focus";
  const currentExecPath = path.resolve(cleanPathValue(options.currentExecPath) || ".");
  const candidateExecPath = cleanPathValue(options.candidateExecPath);
  if (!candidateExecPath || options.wantsHandover || options.candidateExists !== true) return "focus";
  return path.resolve(candidateExecPath).toLowerCase() === currentExecPath.toLowerCase()
    ? "focus"
    : "handover";
}

module.exports = {
  resolveSingleInstanceProfile,
  preparePortableUserDataPath,
  decideSecondInstanceAction,
};
