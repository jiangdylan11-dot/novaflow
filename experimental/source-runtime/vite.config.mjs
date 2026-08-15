import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const particleEditorDir = path.join(repoRoot, "particle-editor");
const particleEditorNodeModules = path.join(particleEditorDir, "node_modules");
const legacyRoot = particleEditorDir;
const runtimeFiles = new Set([
  "ai-sequence-state-machine-runtime.js",
  "novaflow-brand-runtime.js"
]);

function serveRuntimeScript(req, res, next) {
  const requestUrl = String(req.url || "");
  if (!requestUrl.startsWith("/runtime/")) return next();

  const fileName = decodeURIComponent(requestUrl.slice("/runtime/".length).split("?")[0] || "");
  if (!runtimeFiles.has(fileName)) {
    res.statusCode = 404;
    res.end("Runtime script is not in the source-runtime allowlist.");
    return;
  }

  const scriptPath = path.join(particleEditorDir, fileName);
  if (!fs.existsSync(scriptPath)) {
    res.statusCode = 404;
    res.end(`Missing runtime script: ${fileName}`);
    return;
  }

  res.setHeader("content-type", "text/javascript; charset=utf-8");
  fs.createReadStream(scriptPath).pipe(res);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function serveLegacyRuntime(req, res, next) {
  const requestUrl = String(req.url || "");
  if (requestUrl !== "/legacy" && !requestUrl.startsWith("/legacy/")) return next();

  const urlPath = decodeURIComponent(requestUrl.split("?")[0] || "");
  const relativePath = urlPath === "/legacy" || urlPath === "/legacy/"
    ? "index.html"
    : urlPath.slice("/legacy/".length);
  const requestedPath = path.resolve(legacyRoot, relativePath);

  if (!requestedPath.startsWith(`${legacyRoot}${path.sep}`) && requestedPath !== legacyRoot) {
    res.statusCode = 403;
    res.end("Forbidden legacy runtime path.");
    return;
  }

  const filePath = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()
    ? path.join(requestedPath, "index.html")
    : requestedPath;

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end("Legacy runtime file not found.");
    return;
  }

  res.setHeader("content-type", contentTypeFor(filePath));
  fs.createReadStream(filePath).pipe(res);
}

function runtimeCompatibilityPlugin() {
  return {
    name: "novaflow-source-runtime-compat",
    configureServer(server) {
      server.middlewares.use(serveLegacyRuntime);
      server.middlewares.use(serveRuntimeScript);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveLegacyRuntime);
      server.middlewares.use(serveRuntimeScript);
    }
  };
}

export default {
  base: "./",
  plugins: [runtimeCompatibilityPlugin()],
  resolve: {
    alias: [
      { find: "react/jsx-runtime", replacement: path.join(particleEditorNodeModules, "react", "jsx-runtime.js") },
      { find: "react/jsx-dev-runtime", replacement: path.join(particleEditorNodeModules, "react", "jsx-dev-runtime.js") },
      { find: "react-dom/client", replacement: path.join(particleEditorNodeModules, "react-dom", "client.js") },
      { find: "react-dom", replacement: path.join(particleEditorNodeModules, "react-dom", "index.js") },
      { find: "react", replacement: path.join(particleEditorNodeModules, "react", "index.js") }
    ]
  },
  esbuild: {
    jsx: "automatic"
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false
  }
};
