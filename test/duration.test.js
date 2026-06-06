const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDuration } = require("../src/util/duration");

test("parses duration values", () => {
  assert.equal(parseDuration(1000), 1000);
  assert.equal(parseDuration("1000"), 1000);
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("2s"), 2000);
  assert.equal(parseDuration("1m"), 60000);
});
