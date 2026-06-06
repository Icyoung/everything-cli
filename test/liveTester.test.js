const test = require("node:test");
const assert = require("node:assert/strict");
const { sampleArgsForEndpoint } = require("../src/api/liveTester");

test("builds live test values from profile fixtures and schema metadata", () => {
  const endpoint = {
    id: "demo.create",
    namespace: "demo",
    schema: {
      path: {
        id: { type: "integer", example: 9 }
      },
      query: {
        page: { type: "integer", default: 1 },
        mode: { type: "string", enum: ["fast", "slow"] }
      },
      body: {
        name: { type: "string", required: true },
        enabled: { type: "boolean" }
      }
    }
  };

  const args = sampleArgsForEndpoint(endpoint, {
    profile: {
      fixtures: {
        defaults: {
          name: "default-name"
        },
        namespaces: {
          demo: {
            mode: "slow"
          }
        },
        endpoints: {
          "demo.create": {
            path: {
              id: 42
            }
          }
        }
      }
    },
    cache: {}
  });

  assert.deepEqual(args, {
    id: 42,
    page: 1,
    mode: "slow",
    name: "default-name",
    enabled: false
  });
});
