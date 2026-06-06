const test = require("node:test");
const assert = require("node:assert/strict");
const { interpolate, pruneUndefined } = require("../src/template/interpolate");

test("interpolates exact templates as native values", () => {
  const rendered = interpolate({ token: "{{cache.token}}", label: "Bearer {{cache.token}}" }, {
    cache: { token: "abc" }
  });

  assert.equal(rendered.token, "abc");
  assert.equal(rendered.label, "Bearer abc");
});

test("prunes missing exact template values", () => {
  const rendered = pruneUndefined(interpolate({ symbol: "{{args.symbol}}", fixed: "" }, { args: {} }));

  assert.deepEqual(rendered, { fixed: "" });
});
