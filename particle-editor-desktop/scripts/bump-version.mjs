import fs from "fs";

const pkgPath = new URL("../package.json", import.meta.url);
const lockPath = new URL("../package-lock.json", import.meta.url);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const typeArg = args.find((a) => a.startsWith("--type="));
const bumpType = (typeArg ? typeArg.slice("--type=".length) : "patch").trim();
const setArg = args.find((a) => a.startsWith("--set="));
const setVersion = setArg ? setArg.slice("--set=".length).trim() : "";

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(String(v || "").trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3])
  };
}

function bump(v, type) {
  const p = parseSemver(v);
  if (!p) throw new Error(`invalid version: ${v}`);
  if (type === "major") return `${p.major + 1}.0.0`;
  if (type === "minor") return `${p.major}.${p.minor + 1}.0`;
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}

const pkgRaw = fs.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(pkgRaw);

const current = String(pkg?.version || "").trim();
if (!current) throw new Error("package.json version missing");

const next = setVersion ? setVersion : bump(current, bumpType);

if (dryRun) {
  console.log(`version (dry-run): ${current} -> ${next}`);
  process.exit(0);
}

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

try {
  if (fs.existsSync(lockPath)) {
    const lockRaw = fs.readFileSync(lockPath, "utf8");
    const lock = JSON.parse(lockRaw);
    lock.version = next;
    if (lock.packages && lock.packages[""] && typeof lock.packages[""] === "object") {
      lock.packages[""].version = next;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
  }
} catch {
  void 0;
}

console.log(`version bumped: ${current} -> ${next}`);
