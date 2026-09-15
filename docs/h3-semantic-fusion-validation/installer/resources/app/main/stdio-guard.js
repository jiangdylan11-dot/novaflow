"use strict";

// A detached launcher can close its output pipe while Electron is still alive.
// Only ignore that transport error; other stream errors must remain visible.
function guardStdio(stream) {
  if (!stream || stream.__novaFlowStdioGuard) return;
  stream.__novaFlowStdioGuard = true;
  stream.on("error", (error) => {
    if (error?.code !== "EPIPE") throw error;
  });
}

function installStdioGuards() {
  guardStdio(process.stdout);
  guardStdio(process.stderr);
}

module.exports = { guardStdio, installStdioGuards };
