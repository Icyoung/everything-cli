const test = require("node:test");
const assert = require("node:assert/strict");
const { parseYaml } = require("../src/config/yaml");

test("parses mappings and sequence objects", () => {
  const parsed = parseYaml(`
name: login
steps:
  - id: loginCheck
    call: auth.loginCheck
    body:
      email: "{{inputs.email}}"
  - wait: 1s
`);

  assert.equal(parsed.name, "login");
  assert.equal(parsed.steps[0].id, "loginCheck");
  assert.equal(parsed.steps[0].body.email, "{{inputs.email}}");
  assert.equal(parsed.steps[1].wait, "1s");
});
