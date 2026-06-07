const fs = require("node:fs");
const path = require("node:path");
const { resolveCliPath } = require("./paths");

function settingsPath() {
  return resolveCliPath("data", ".evt", "config.json");
}

function readSettings() {
  const file = settingsPath();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeSettings(settings) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function getDefaultProfile() {
  return readSettings().defaultProfile || "local";
}

function setDefaultProfile(profile) {
  const settings = readSettings();
  settings.defaultProfile = profile;
  writeSettings(settings);
  return {
    profile,
    path: settingsPath()
  };
}

function resolveProfileName(profile) {
  return profile || getDefaultProfile();
}

module.exports = {
  getDefaultProfile,
  readSettings,
  resolveProfileName,
  setDefaultProfile,
  settingsPath
};
