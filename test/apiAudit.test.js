const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runApiAudit } = require("../scripts/check-api-audit");

function writeFile(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evt-api-audit-"));
  writeFile(root, "src/AuthService.kt", `
    class AuthService(val http: Http) {
      suspend fun login(): Resp<LoginData> {
        return http.post("/api/login")
      }
    }
  `);
  writeFile(root, "data/scanner.json", JSON.stringify({
    root,
    targets: [
      {
        language: "kotlin",
        paths: ["src"],
        namespaceStripSuffixes: ["Service"]
      }
    ]
  }, null, 2));
  return root;
}

test("api audit flags scanner skeletons in strict mode", () => {
  const root = fixtureRoot();
  writeFile(root, "data/apis/auth.yaml", `
namespace: auth

endpoints:
  login:
    method: "POST"
    path: "/api/login"
    auth: false
    schema: {}
    response:
      data:
        type: "object"
`);

  const result = runApiAudit(["--config-root", root, "--strict"], { silent: true });

  assert.equal(result.failed, true);
  assert.equal(result.payload.counts.emptySchema, 1);
  assert.equal(result.payload.counts.genericResponse, 1);
  assert.match(result.payload.failures.join("\\n"), /empty schema ratio/);
  assert.match(result.payload.failures.join("\\n"), /generic response ratio/);
});

test("api audit passes enriched endpoint definitions", () => {
  const root = fixtureRoot();
  writeFile(root, "data/apis/auth.yaml", `
namespace: auth

endpoints:
  login:
    method: "POST"
    path: "/api/login"
    auth: false
    schema:
      body:
        email:
          type: "string"
          required: true
        password:
          type: "string"
          required: true
    response:
      envelope: "Resp"
      data:
        type: "object"
        model: "LoginData"
        fields:
          token: "string"
`);

  const result = runApiAudit(["--config-root", root, "--strict"], { silent: true });

  assert.equal(result.failed, false);
  assert.equal(result.payload.counts.emptySchema, 0);
  assert.equal(result.payload.counts.genericResponse, 0);
  assert.deepEqual(result.payload.failures, []);
});

test("cli api audit accepts strict as a boolean flag", () => {
  const root = fixtureRoot();
  writeFile(root, "data/apis/auth.yaml", `
namespace: auth

endpoints:
  login:
    method: "POST"
    path: "/api/login"
    auth: false
    schema:
      body:
        email:
          type: "string"
          required: true
    response:
      envelope: "Resp"
      data:
        type: "object"
        model: "LoginData"
        fields:
          token: "string"
`);

  const result = spawnSync(process.execPath, [
    path.join(__dirname, "..", "bin", "evt.js"),
    "api",
    "audit",
    "--config-root",
    root,
    "--strict"
  ], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.strict, true);
});
