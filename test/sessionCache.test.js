const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { readCache, resolveCachePath, writeCache } = require("../src/cache/sessionCache");
const { defaultCachePath, setConfigRoot } = require("../src/util/paths");

test("uses .evt/cache as the default session cache directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evt-cache-new-"));
  setConfigRoot(root);

  assert.equal(defaultCachePath(), path.join(root, ".evt", "cache", "session.local.json"));
  assert.equal(resolveCachePath(), path.join(root, ".evt", "cache", "session.local.json"));

  writeCache(undefined, { token: "new-token" });
  assert.equal(fs.existsSync(path.join(root, ".evt", "cache", "session.local.json")), true);
  assert.deepEqual(readCache(), { token: "new-token" });
});

test("reads legacy .cache session cache when new cache does not exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evt-cache-legacy-"));
  setConfigRoot(root);
  fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(root, ".cache", "session.local.json"), JSON.stringify({
    token: "legacy-token"
  }));

  assert.deepEqual(readCache(), { token: "legacy-token" });
});
