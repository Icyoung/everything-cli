const path = require("node:path");

const cliRoot = path.resolve(__dirname, "../..");
let configuredRoot;

function setConfigRoot(root) {
  configuredRoot = root ? path.resolve(root) : undefined;
}

function configRoot() {
  return path.resolve(process.env.EVT_CLI_ROOT || process.env.EVERYTHING_CLI_ROOT || configuredRoot || cliRoot);
}

function resolveCliPath(...parts) {
  return path.resolve(configRoot(), ...parts);
}

function resolveConfigDir(name) {
  const fs = require("node:fs");
  const candidates = [
    resolveCliPath(name),
    resolveCliPath("data", name)
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function defaultCachePath() {
  return resolveCliPath(".cache", "session.local.json");
}

module.exports = {
  cliRoot,
  configRoot,
  defaultCachePath,
  resolveCliPath,
  resolveConfigDir,
  setConfigRoot
};
