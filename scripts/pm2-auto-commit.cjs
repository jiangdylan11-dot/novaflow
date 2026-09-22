const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const nodeExe = fs.existsSync("C:\\Program Files\\nodejs\\node.exe")
  ? "C:\\Program Files\\nodejs\\node.exe"
  : process.execPath;
const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

if (!fs.existsSync(npmCli)) {
  console.error(`npm cli not found: ${npmCli}`);
  process.exit(1);
}

const child = spawn(nodeExe, [npmCli, "run", "watch:auto-commit"], {
  cwd: path.resolve(__dirname, ".."),
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
  windowsHide: true
});

child.stdout?.pipe(process.stdout);
child.stderr?.pipe(process.stderr);

child.on("exit", code => {
  process.exit(code ?? 0);
});

child.on("error", error => {
  console.error(error);
  process.exit(1);
});
