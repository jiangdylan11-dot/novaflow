import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, "..");
const tscBin = path.join(desktopDir, "node_modules", "typescript", "bin", "tsc");

if (!fs.existsSync(tscBin)) {
  console.error("build-license: TypeScript is not installed. Run npm install in particle-editor-desktop.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.license.json"], {
  cwd: desktopDir,
  stdio: "inherit",
  shell: false
});

if (result.error) {
  console.error(result.error);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("build-license: completed");
