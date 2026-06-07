const fs = require("node:fs");
const path = require("node:path");
const { resolveCliPath } = require("./paths");

function settingsPath() {
  return resolveCliPath(".evt", "config.json");
}

function legacySettingsPath() {
  return resolveCliPath("data", ".evt", "config.json");
}

function readSettings() {
  const file = settingsPath();
  const legacyFile = legacySettingsPath();
  const readableFile = fs.existsSync(file) ? file : legacyFile;
  if (!fs.existsSync(readableFile)) return {};
  return JSON.parse(fs.readFileSync(readableFile, "utf8"));
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
  legacySettingsPath,
  readSettings,
  resolveProfileName,
  setDefaultProfile,
  settingsPath
};
