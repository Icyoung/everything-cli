#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cliRoot = path.resolve(__dirname, "..");
const distDir = path.join(cliRoot, "dist");

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: cliRoot,
    stdio: "inherit",
    shell: false,
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function cleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });
}

function main() {
  run("npm", ["test"]);
  run("npm", ["run", "check"]);
  run("node", ["bin/everything-cli.js", "validate"]);
  run("npm", ["run", "coverage:api"]);
  cleanDist();
  run("node", ["scripts/build-package.js"]);
}

main();
