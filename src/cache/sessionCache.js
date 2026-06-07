const fs = require("node:fs");
const path = require("node:path");
const { defaultCachePath, legacyCachePath } = require("../util/paths");

function resolveCachePath(cachePath) {
  return cachePath ? path.resolve(cachePath) : defaultCachePath();
}

function readCache(cachePath) {
  const file = resolveCachePath(cachePath);
  const legacyFile = !cachePath ? legacyCachePath() : undefined;
  const readableFile = fs.existsSync(file) ? file : legacyFile;
  if (!readableFile || !fs.existsSync(readableFile)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(readableFile, "utf8"));
}

function writeCache(cachePath, value) {
  const file = resolveCachePath(cachePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function clearCache(cachePath) {
  const file = resolveCachePath(cachePath);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  return file;
}

module.exports = {
  resolveCachePath,
  readCache,
  writeCache,
  clearCache
};
