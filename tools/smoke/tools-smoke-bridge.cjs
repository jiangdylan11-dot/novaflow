const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RESULT_TYPE = "TOOLS_TEMP_BRIDGE_RESULT";
const TEMP_ROOT_RELATIVE = path.join("debug-output", "temp-tools-bridge-test-2026-05-16");
const FORBIDDEN_RENDERER_FIELDS = ["dir", "absolutePath", "targetPath", "overwriteTarget", "sourcePathAsOutput"];
const SAFE_FILE_NAME_PATTERN = /^[a-zA-Z0-9._ -]+$/;
const SMOKE_CAPABILITY_TOKEN = "smoke-temp-only";

function normalizeForCompare(value) {
  return path.resolve(value).toLowerCase();
}

function isPathInside(root, candidate) {
  const relative = path.relative(normalizeForCompare(root), normalizeForCompare(candidate));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return new Uint8Array(value);
  }
  return null;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sanitizeSessionId(value) {
  const raw = String(value || `smoke-${Date.now()}`).trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return safe || `smoke-${Date.now()}`;
}

function sanitizeFileName(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.includes("\0") || raw.includes("/") || raw.includes("\\") || raw === "." || raw === "..") return null;
  if (!SAFE_FILE_NAME_PATTERN.test(raw)) return null;
  if (path.basename(raw) !== raw) return null;
  if (!raw.toLowerCase().endsWith(".png")) return null;
  return raw;
}

function makeBlocked(code, message, realWriteCount, details) {
  return {
    type: RESULT_TYPE,
    ok: false,
    code,
    error: { code, message, details },
    realWriteCount
  };
}

function makeOperationReceipt(input) {
  return {
    operationId: input.operationId,
    timestamp: input.timestamp || new Date().toISOString(),
    mode: input.mode,
    tempPath: input.tempPath || null,
    finalPath: input.finalPath || null,
    hashBefore: input.hashBefore === undefined ? null : input.hashBefore,
    hashAfter: input.hashAfter === undefined ? null : input.hashAfter,
    overwriteAttempted: false,
    success: !!input.success,
    failure: input.success ? null : (input.typedError && input.typedError.code || "UNKNOWN"),
    typedError: input.typedError || null
  };
}

function reserveFinalPath(outputDir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  for (let index = 0; index < 100; index += 1) {
    const candidateName = index === 0 ? fileName : `${base}-${index + 1}${ext}`;
    const candidatePath = path.join(outputDir, candidateName);
    try {
      const fd = fs.openSync(candidatePath, "wx");
      fs.closeSync(fd);
      fs.rmSync(candidatePath, { force: true });
      return { fileName: candidateName, finalPath: candidatePath };
    } catch (error) {
      if (error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  return null;
}

function cleanupGenerated(root, filePath, suffix) {
  if (!filePath || !isPathInside(root, filePath)) return false;
  if (!path.basename(filePath).endsWith(suffix)) return false;
  fs.rmSync(filePath, { force: true });
  return true;
}

function createSmokeTempBridge(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const tempRoot = path.resolve(options.tempRoot || path.join(repoRoot, TEMP_ROOT_RELATIVE));
  const sessionId = sanitizeSessionId(options.sessionId);
  let realWriteCount = 0;
  const operationReceipts = new Map();

  function rememberReceipt(receipt) {
    if (receipt && receipt.operationId) operationReceipts.set(receipt.operationId, receipt);
    return receipt;
  }

  function makeTypedError(code, message, details) {
    return { code, message, details };
  }

  function blockedWithReceipt(code, message, requestId, operationId, mode, details) {
    const typedError = makeTypedError(code, message, details);
    const operationReceipt = rememberReceipt(makeOperationReceipt({
      operationId,
      mode,
      success: false,
      typedError
    }));
    return {
      ...makeBlocked(code, message, realWriteCount, details),
      operationId,
      operationReceipt
    };
  }

  function validateRequest(input) {
    const request = input && typeof input === "object" ? input : {};
    const requestId = String(request.requestId || request.operationId || `smoke-${Date.now()}`);
    const operationId = String(request.operationId || requestId);
    const mode = request.dryRun === true ? "dry_run" : request.operation || "export";

    const forbiddenField = FORBIDDEN_RENDERER_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(request, field));
    if (forbiddenField) {
      return {
        ok: false,
        code: "RENDERER_DIR_FORBIDDEN",
        message: "Renderer output path fields are not accepted.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId, field: forbiddenField }
      };
    }

    if (request.capabilityToken && request.capabilityToken !== SMOKE_CAPABILITY_TOKEN) {
      return {
        ok: false,
        code: "INVALID_CAPABILITY",
        message: "Invalid tools bridge smoke capability token.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId }
      };
    }

    if (request.production === true || request.mode === "production" || request.writeMode === "production") {
      return {
        ok: false,
        code: "PRODUCTION_WRITE_REJECTED",
        message: "Production writes are rejected by the G1 smoke bridge.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId }
      };
    }

    if (mode === "overwrite" || request.overwrite === true) {
      return {
        ok: false,
        code: "OVERWRITE_DISABLED",
        message: "Overwrite is disabled by the G1 smoke bridge.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId }
      };
    }

    if (mode !== "export" && mode !== "dry_run") {
      return {
        ok: false,
        code: "UNSUPPORTED_OPERATION",
        message: "Only dry-run and temp export are available in packaged smoke mode.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId, operation: mode }
      };
    }

    if (request.tool !== "png_compress") {
      return {
        ok: false,
        code: "UNSUPPORTED_OPERATION",
        message: "Packaged smoke only allows PNG lossless temp export.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId, tool: request.tool }
      };
    }

    const compression = request.metadata && typeof request.metadata === "object" ? request.metadata.compression : undefined;
    if (compression !== undefined && compression !== "lossless") {
      return {
        ok: false,
        code: "UNSUPPORTED_OPERATION",
        message: "Packaged smoke only allows PNG lossless temp export.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId, compression }
      };
    }

    const fileName = sanitizeFileName(request.fileName);
    if (!fileName) {
      return {
        ok: false,
        code: "INVALID_TEMP_TARGET",
        message: "fileName must be a safe PNG basename.",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId }
      };
    }

    const bytes = toBytes(request.bytes);
    if (!bytes) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: "bytes must be Uint8Array, ArrayBuffer, or number[].",
        request,
        requestId,
        operationId,
        mode,
        details: { requestId, operationId }
      };
    }

    return {
      ok: true,
      request,
      requestId,
      operationId,
      mode,
      fileName,
      bytes,
      sourceBytesSha256: sha256(bytes)
    };
  }

  function validateExport(input) {
    const validation = validateRequest(input);
    if (!validation.ok) {
      return blockedWithReceipt(validation.code, validation.message, validation.requestId, validation.operationId, validation.mode, validation.details);
    }
    return {
      type: RESULT_TYPE,
      ok: true,
      code: "EXPORT_VALIDATED",
      operationId: validation.operationId,
      data: {
        operationId: validation.operationId,
        requestId: validation.requestId,
        mode: validation.mode,
        tool: "png_compress",
        fileName: validation.fileName,
        hashBefore: null,
        hashAfter: validation.sourceBytesSha256,
        overwriteAttempted: false,
        capability: "temp-only",
        entitlement: "temp-only"
      },
      realWriteCount
    };
  }

  function getTempSession() {
    return {
      type: "TOOLS_TEMP_SESSION",
      ok: true,
      sessionId,
      mode: "packaged_smoke",
      capabilityToken: SMOKE_CAPABILITY_TOKEN,
      tempRoot,
      allowedOperations: ["dry_run", "export"],
      overwriteAllowed: false,
      productionWriteAllowed: false,
      rendererProvidedPathAllowed: false,
      entitlement: "temp-only"
    };
  }

  function getOperationReceipt(input) {
    const operationId = typeof input === "string"
      ? input
      : String(input && (input.operationId || input.requestId) || "");
    const receipt = operationReceipts.get(operationId);
    if (!receipt) {
      return makeBlocked("ATOMIC_RECEIPT_MISSING", "Operation receipt was not found.", realWriteCount, { operationId });
    }
    return {
      type: RESULT_TYPE,
      ok: true,
      code: "OPERATION_RECEIPT_FOUND",
      operationId,
      data: receipt,
      realWriteCount
    };
  }

  function exportTemp(input) {
    const validation = validateRequest(input);
    if (!validation.ok) {
      const responseCode = validation.code === "OVERWRITE_DISABLED" ? "OVERWRITE_BLOCKED" : validation.code;
      return blockedWithReceipt(responseCode, validation.message, validation.requestId, validation.operationId, validation.mode, {
        ...(validation.details || {}),
        typedErrorCode: validation.code
      });
    }

    const { request, requestId, operationId, mode: operation, fileName, bytes, sourceBytesSha256 } = validation;
    if (operation === "dry_run") {
      const operationReceipt = rememberReceipt(makeOperationReceipt({
        operationId,
        mode: "dry_run",
        hashBefore: null,
        hashAfter: sourceBytesSha256,
        success: true
      }));
      return {
        type: RESULT_TYPE,
        ok: true,
        code: "TEMP_EXPORT_DRY_RUN",
        operationId,
        receipt: {
          operationId,
          requestId,
          tool: "png_compress",
          operation: "dry_run",
          timestamp: operationReceipt.timestamp,
          mode: "dry_run",
          tempPath: null,
          hashBefore: null,
          hashAfter: sourceBytesSha256,
          bytesLength: bytes.byteLength,
          sourceBytesSha256,
          realWriteCount,
          overwrite: false,
          overwriteAttempted: false,
          atomic: false,
          dryRun: true,
          success: true,
          typedError: null
        },
        operationReceipt,
        realWriteCount
      };
    }

    let rootRealPath = "";
    let finalPath = "";
    let tempPath = "";
    try {
      fs.mkdirSync(tempRoot, { recursive: true });
      rootRealPath = fs.realpathSync(tempRoot);
      const debugOutputRoot = fs.realpathSync(path.join(repoRoot, "debug-output"));
      if (!isPathInside(debugOutputRoot, rootRealPath)) {
        return blockedWithReceipt("INVALID_TEMP_TARGET", "Temp root resolved outside debug-output.", requestId, operationId, operation, {
          requestId,
          operationId,
          tempRoot: rootRealPath
        });
      }

      const outputDir = path.resolve(rootRealPath, sessionId, "png-lossless");
      if (!isPathInside(rootRealPath, outputDir)) {
        return blockedWithReceipt("INVALID_TEMP_TARGET", "Resolved output directory escaped temp root.", requestId, operationId, operation, { requestId, operationId });
      }
      fs.mkdirSync(outputDir, { recursive: true });

      const reserved = reserveFinalPath(outputDir, fileName);
      if (!reserved) {
        return blockedWithReceipt("INVALID_TEMP_TARGET", "Could not allocate collision-safe output path.", requestId, operationId, operation, { requestId, operationId, fileName });
      }

      finalPath = reserved.finalPath;
      tempPath = path.join(outputDir, `.${reserved.fileName}.${operationId}.tmp`);
      if (!isPathInside(rootRealPath, finalPath) || !isPathInside(rootRealPath, tempPath)) {
        return blockedWithReceipt("INVALID_TEMP_TARGET", "Resolved output path escaped temp root.", requestId, operationId, operation, { requestId, operationId });
      }

      const fd = fs.openSync(tempPath, "wx");
      try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempPath, finalPath);

      const written = fs.readFileSync(finalPath);
      const writtenBytesSha256 = sha256(written);
      if (written.byteLength !== bytes.byteLength || writtenBytesSha256 !== sourceBytesSha256) {
        try {
          cleanupGenerated(rootRealPath, finalPath, ".png");
        } catch (cleanupError) {
          return blockedWithReceipt("TEMP_CLEANUP_FAILED", "Hash mismatch and cleanup failed.", requestId, operationId, operation, {
            requestId,
            operationId,
            originalCode: "HASH_MISMATCH",
            cleanupError: String(cleanupError && cleanupError.message || cleanupError)
          });
        }
        return blockedWithReceipt("HASH_MISMATCH", "Written file hash did not match source bytes.", requestId, operationId, operation, {
          requestId,
          operationId,
          sourceBytesSha256,
          writtenBytesSha256
        });
      }

      realWriteCount += 1;
      const operationReceipt = rememberReceipt(makeOperationReceipt({
        operationId,
        mode: "export",
        tempPath,
        finalPath,
        hashBefore: null,
        hashAfter: writtenBytesSha256,
        success: true
      }));
      return {
        type: RESULT_TYPE,
        ok: true,
        code: "TEMP_EXPORT_WRITTEN",
        operationId,
        receipt: {
          operationId,
          requestId,
          tool: "png_compress",
          operation: "export",
          timestamp: operationReceipt.timestamp,
          mode: "export",
          tempPath,
          targetRelativePath: path.relative(repoRoot, finalPath).replace(/\\/g, "/"),
          targetAbsolutePath: finalPath,
          bytesLength: bytes.byteLength,
          hashBefore: null,
          hashAfter: writtenBytesSha256,
          sourceBytesSha256,
          writtenBytesSha256,
          realWriteCount,
          overwrite: false,
          overwriteAttempted: false,
          atomic: true,
          dryRun: false,
          success: true,
          typedError: null
        },
        operationReceipt,
        realWriteCount
      };
    } catch (error) {
      const typedCode = error && (error.code === "EACCES" || error.code === "EPERM") ? "PERMISSION_DENIED" : "ATOMIC_WRITE_FAILED";
      if (tempPath) {
        try {
          cleanupGenerated(rootRealPath || tempRoot, tempPath, ".tmp");
        } catch (cleanupError) {
          return blockedWithReceipt("TEMP_CLEANUP_FAILED", "Atomic write failed and temp cleanup failed.", requestId, operationId, operation, {
            requestId,
            operationId,
            originalCode: typedCode,
            cause: String(error && error.message || error),
            cleanupError: String(cleanupError && cleanupError.message || cleanupError)
          });
        }
      }
      return blockedWithReceipt(typedCode, "Atomic temp export failed.", requestId, operationId, operation, {
        requestId,
        operationId,
        cause: String(error && error.message || error)
      });
    }
  }

  return {
    getRoot: () => tempRoot,
    getRealWriteCount: () => realWriteCount,
    getTempSession,
    validateExport,
    getOperationReceipt,
    exportTemp
  };
}

module.exports = {
  createSmokeTempBridge,
  isPathInside,
  sha256
};
