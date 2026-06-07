const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { run } = require("../src/index");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function capture(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (value) => lines.push(value);
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

function createConfigRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evt-profile-default-"));
  write(path.join(root, "data", "profiles", "dev.json"), JSON.stringify({
    name: "dev",
    baseUrl: "https://dev.example.test",
    headers: {
      "X-Profile": "dev"
    }
  }, null, 2));
  write(path.join(root, "data", "apis", "todo.yaml"), [
    "namespace: todo",
    "",
    "endpoints:",
    "  list:",
    "    method: \"GET\"",
    "    path: \"/api/todos\"",
    "    auth: false",
    "    response:",
    "      data:",
    "        type: \"array\"",
    ""
  ].join("\n"));
  return root;
}

test("profile set stores a project default profile used by api calls", async () => {
  const root = createConfigRoot();

  await capture(() => run(["profile", "set", "dev", "--config-root", root]));
  assert.equal(fs.existsSync(path.join(root, ".evt", "config.json")), true);
  assert.equal(fs.existsSync(path.join(root, "data", ".evt", "config.json")), false);

  const current = await capture(() => run(["profile", "current", "--config-root", root]));
  assert.equal(current[0], "dev");

  const output = await capture(() => run([
    "api",
    "call",
    "todo.list",
    "--config-root",
    root,
    "--dry-run",
    "--json"
  ]));
  const payload = JSON.parse(output[0]);
  assert.equal(payload.request.url, "https://dev.example.test/api/todos");
  assert.equal(payload.request.headers["X-Profile"], "dev");
});

test("profile default still reads legacy data .evt settings", async () => {
  const root = createConfigRoot();
  write(path.join(root, "data", ".evt", "config.json"), JSON.stringify({
    defaultProfile: "dev"
  }, null, 2));

  const current = await capture(() => run(["profile", "current", "--config-root", root]));
  assert.equal(current[0], "dev");
});
