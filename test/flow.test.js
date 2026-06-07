const test = require("node:test");
const assert = require("node:assert/strict");
const { runFlow } = require("../src/flow/runner");
const { loadApiRegistry, loadProfile } = require("../src/config/loaders");

test("runs login flow in dry-run mode without prompt", async () => {
  const result = await runFlow({
    name: "login",
    inputs: {
      email: { required: true },
      password: { required: true },
      code: { default: "" },
      googleCode: { default: "" }
    },
    steps: [
      {
        id: "login",
        call: "auth.login",
        body: {
          email: "{{inputs.email}}",
          password: "{{inputs.password}}"
        }
      }
    ]
  }, {
    registry: loadApiRegistry(),
    profile: loadProfile("local"),
    cache: {},
    cachePath: "/tmp/evt-cli-test-cache.json",
    set: {
      email: "user@example.com",
      password: "secret"
    },
    dryRun: true,
    noInteractive: true
  });

  assert.equal(result.flow, "login");
  assert.equal(result.timeline.filter((item) => item.call).length, 1);
  assert.equal(result.steps.login.request.method, "POST");
});

test("fails when required cache save value is missing", async () => {
  const cachePath = "/tmp/evt-cli-required-cache-test.json";
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: { info: { email: "user@example.com" } } })
  });

  try {
    await assert.rejects(
      runFlow({
        name: "save-required",
        steps: [
          {
            id: "login",
            call: "auth.login",
            body: {
              email: "user@example.com",
              password: "secret"
            }
          }
        ],
        save: {
          cache: {
            token: "{{steps.login.response.data.token}}"
          },
          required: ["cache.token"]
        }
      }, {
        registry: loadApiRegistry(),
        profile: loadProfile("local"),
        cache: {},
        cachePath,
        set: {},
        dryRun: false,
        noInteractive: true
      }),
      /required save value: cache\.token/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("supports step expect and extract variables", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: { token: "token-value" } })
  });

  try {
    const result = await runFlow({
      name: "expect-extract",
      steps: [
        {
          id: "login",
          call: "auth.login",
          body: {
            email: "user@example.com",
            password: "secret"
          },
          expect: [
            { path: "response.code", equals: 0 },
            { path: "response.data.token", exists: true }
          ],
          extract: {
            token: "response.data.token"
          }
        }
      ]
    }, {
      registry: loadApiRegistry(),
      profile: loadProfile("local"),
      cache: {},
      cachePath: "/tmp/evt-cli-extract-cache-test.json",
      set: {},
      dryRun: false,
      noInteractive: true
    });

    assert.deepEqual(result.vars, ["token"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("updates flow cache for later authenticated steps", async () => {
  const originalFetch = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url, options });
    if (seen.length === 1) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 0, data: { token: "token-value" } })
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 0, data: { email: "user@example.com" } })
    };
  };

  try {
    await runFlow({
      name: "flow-cache",
      steps: [
        {
          id: "login",
          call: "auth.login",
          body: {
            email: "user@example.com",
            password: "secret"
          },
          extract: {
            token: "response.data.token"
          },
          cache: {
            token: "{{vars.token}}"
          }
        },
        {
          id: "user",
          call: "todo.list"
        }
      ]
    }, {
      registry: loadApiRegistry(),
      profile: loadProfile("local"),
      cache: {},
      cachePath: "/tmp/evt-cli-flow-cache-test.json",
      set: {},
      dryRun: false,
      noInteractive: true
    });

    assert.equal(seen[1].options.headers.Authorization, "Bearer token-value");
  } finally {
    global.fetch = originalFetch;
  }
});

test("skips response expectations during dry-run", async () => {
  const result = await runFlow({
    name: "dry-run-expect",
    steps: [
      {
        id: "oauth",
        call: "auth.login",
        expect: { path: "response.code", equals: 0 },
        extract: {
          token: "response.data.token"
        }
      }
    ]
  }, {
    registry: loadApiRegistry(),
    profile: loadProfile("local"),
    cache: {},
    cachePath: "/tmp/evt-cli-dry-run-expect-cache-test.json",
    set: {},
    dryRun: true,
    noInteractive: true
  });

  assert.equal(result.flow, "dry-run-expect");
  assert.deepEqual(result.vars, []);
});

test("accepts one input from an anyOf input group", async () => {
  const result = await runFlow({
    name: "login-any-of",
    inputs: {
      email: { required: true },
      password: { required: true, type: "password" },
      code: { default: "" },
      googleCode: { default: "" }
    },
    inputGroups: {
      anyOf: [
        { fields: ["code", "googleCode"], message: "email code or Google OTP" }
      ]
    },
    steps: [
      {
        id: "login",
        call: "auth.login",
        body: {
          email: "{{inputs.email}}",
          password: "{{inputs.password}}",
          code: "{{inputs.code}}",
          googleCode: "{{inputs.googleCode}}"
        }
      }
    ]
  }, {
    registry: loadApiRegistry(),
    profile: loadProfile("local"),
    cache: {},
    cachePath: "/tmp/evt-cli-any-of-cache-test.json",
    set: {
      email: "user@example.com",
      password: "secret",
      googleCode: "123456"
    },
    dryRun: true,
    noInteractive: true
  });

  assert.deepEqual(result.inputs.sort(), ["code", "email", "googleCode", "password"].sort());
  assert.equal(result.steps.login.request.body.code, "");
  assert.equal(result.steps.login.request.body.googleCode, "123456");
});

test("fails when no input from an anyOf input group is available", async () => {
  await assert.rejects(
    runFlow({
      name: "login-any-of-missing",
      inputs: {
        email: { required: true },
        password: { required: true, type: "password" },
        code: { default: "" },
        googleCode: { default: "" }
      },
      inputGroups: {
        anyOf: [
          { fields: ["code", "googleCode"], message: "email code or Google OTP" }
        ]
      },
      steps: [
        {
          id: "login",
          call: "auth.login",
          body: {
            email: "{{inputs.email}}",
            password: "{{inputs.password}}"
          }
        }
      ]
    }, {
      registry: loadApiRegistry(),
      profile: { name: "test", baseUrl: "https://api.example.com", inputs: {} },
      cache: {},
      cachePath: "/tmp/evt-cli-any-of-missing-cache-test.json",
      set: {
        email: "user@example.com",
        password: "secret"
      },
      dryRun: true,
      noInteractive: true
    }),
    /Missing required flow input group: email code or Google OTP/
  );
});
