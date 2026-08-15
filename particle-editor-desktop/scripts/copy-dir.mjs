import fs from "node:fs";
import path from "node:path";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const real = fs.readlinkSync(srcPath);
      fs.symlinkSync(real, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("Usage: node copy-dir.mjs <src> <dest>");
  process.exit(1);
}

rmDir(dest);
copyDir(src, dest);

