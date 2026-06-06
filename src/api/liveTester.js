const fs = require("node:fs");
const path = require("node:path");
const { buildRequest } = require("../http/requestBuilder");
const { readCache } = require("../cache/sessionCache");
const { loadFlow } = require("../config/loaders");
const { runFlow } = require("../flow/runner");
const { resolveCliPath } = require("../util/paths");
const { redact } = require("../util/redact");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowCompact() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").slice(0, 15);
}

function ensureCacheDir() {
  const dir = resolveCliPath(".cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function schemaGroups(endpoint) {
  const schema = endpoint.schema || {};
  return [
    ["path", schema.path],
    ["query", schema.query],
    ["body", schema.body]
  ].filter(([, group]) => isPlainObject(group));
}

function schemaEntries(endpoint) {
  return schemaGroups(endpoint).flatMap(([groupName, group]) =>
    Object.entries(group).map(([key, definition]) => ({ groupName, key, definition }))
  );
}

function accountInput(profile, key) {
  return profile && profile.inputs ? profile.inputs[key] : undefined;
}

function profileTestOption(profile, key) {
  return profile && profile.test ? profile.test[key] : undefined;
}

function valueFromBucket(bucket, groupName, key) {
  if (!isPlainObject(bucket)) return undefined;
  if (isPlainObject(bucket[groupName]) && Object.prototype.hasOwnProperty.call(bucket[groupName], key)) {
    return bucket[groupName][key];
  }
  if (Object.prototype.hasOwnProperty.call(bucket, key)) {
    return bucket[key];
  }
  return undefined;
}

function fixtureValue(endpoint, groupName, key, runtime) {
  const fixtures = runtime.profile.fixtures || {};
  const endpointFixtures = fixtures.endpoints || {};
  const namespaceFixtures = fixtures.namespaces || {};

  const endpointValue = valueFromBucket(endpointFixtures[endpoint.id], groupName, key);
  if (endpointValue !== undefined) return endpointValue;

  const namespaceValue = valueFromBucket(namespaceFixtures[endpoint.namespace], groupName, key);
  if (namespaceValue !== undefined) return namespaceValue;

  return valueFromBucket(fixtures.defaults, groupName, key);
}

function genericTypeSample(type) {
  if (type === "integer") return 1;
  if (type === "number") return 1;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  return "test";
}

function sampleValue(endpoint, groupName, key, rawDefinition, runtime) {
  const definition = isPlainObject(rawDefinition) ? rawDefinition : { type: String(rawDefinition) };
  const fixture = fixtureValue(endpoint, groupName, key, runtime);
  if (fixture !== undefined) return fixture;
  if (definition.example !== undefined) return definition.example;
  if (definition.default !== undefined) return definition.default;
  if (Array.isArray(definition.enum) && definition.enum.length > 0) {
    return definition.enum[0];
  }
  return genericTypeSample(definition.type || "string");
}

function sampleValuesForEndpoint(endpoint, runtime) {
  const values = {
    args: {},
    path: {},
    query: {},
    body: {}
  };
  for (const { groupName, key, definition } of schemaEntries(endpoint)) {
    const value = sampleValue(endpoint, groupName, key, definition, runtime);
    values[groupName][key] = value;
    if (!Object.prototype.hasOwnProperty.call(values.args, key)) {
      values.args[key] = value;
    }
  }
  return values;
}

function sampleArgsForEndpoint(endpoint, runtime) {
  return sampleValuesForEndpoint(endpoint, runtime).args;
}

function applySetOverrides(group, set) {
  const result = { ...group };
  for (const key of Object.keys(result)) {
    if (Object.prototype.hasOwnProperty.call(set || {}, key)) {
      result[key] = set[key];
    }
  }
  return result;
}

function endpointOrder(left, right) {
  if (left.id === "auth.logout") return 1;
  if (right.id === "auth.logout") return -1;
  if (Boolean(left.dangerous) !== Boolean(right.dangerous)) {
    return left.dangerous ? 1 : -1;
  }
  return left.id.localeCompare(right.id);
}

async function ensureLogin(runtime, options) {
  if (options.noLogin || runtime.cache.token) {
    return { attempted: false, loggedIn: Boolean(runtime.cache.token) };
  }
  if (!accountInput(runtime.profile, "email") || !accountInput(runtime.profile, "password")) {
    return {
      attempted: false,
      loggedIn: false,
      reason: "profile.inputs.email/profile.inputs.password not configured"
    };
  }

  const flow = loadFlow("login");
  await runFlow(flow, {
    ...runtime,
    set: {},
    cliHeaders: {},
    dryRun: false,
    unsafe: false,
    noInteractive: true
  });
  runtime.cache = readCache(runtime.cachePath);
  return { attempted: true, loggedIn: Boolean(runtime.cache.token) };
}

function parseResponseText(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return text;
  }
}

function classifyResponse(httpStatus, parsed) {
  if (httpStatus < 200 || httpStatus >= 300) return "http_error";
  if (parsed && typeof parsed === "object" && "code" in parsed && parsed.code !== 0) return "api_error";
  return "ok";
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.encodedBody,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function testEndpoint(endpoint, runtime, options) {
  if (endpoint.dangerous && !options.includeDangerous) {
    return {
      endpoint: endpoint.id,
      status: "skipped_dangerous",
      dangerous: true
    };
  }
  if (endpoint.auth && !runtime.cache.token) {
    return {
      endpoint: endpoint.id,
      status: "skipped_auth",
      auth: true
    };
  }

  const samples = sampleValuesForEndpoint(endpoint, runtime);
  const args = { ...samples.path, ...samples.args, ...(options.set || {}) };
  const context = {
    profile: runtime.profile,
    cache: runtime.cache,
    args,
    inputs: runtime.profile.inputs || {},
    env: process.env,
    steps: {}
  };

  let request;
  try {
    request = buildRequest(endpoint, {
      ...runtime,
      context,
      body: applySetOverrides(samples.body, options.set),
      query: applySetOverrides(samples.query, options.set),
      cliHeaders: options.headers || {},
      baseUrl: options.baseUrl,
      dryRun: false
    });
  } catch (error) {
    return {
      endpoint: endpoint.id,
      status: "build_error",
      error: error.message
    };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(request, options.timeoutMs);
    const text = await response.text();
    const parsed = parseResponseText(text);
    const status = classifyResponse(response.status, parsed);
    return {
      endpoint: endpoint.id,
      status,
      httpStatus: response.status,
      code: parsed && typeof parsed === "object" ? parsed.code : undefined,
      msg: parsed && typeof parsed === "object" ? parsed.msg : undefined,
      durationMs: Date.now() - startedAt,
      request: redact(request),
      response: redact(parsed)
    };
  } catch (error) {
    return {
      endpoint: endpoint.id,
      status: "network_error",
      durationMs: Date.now() - startedAt,
      error: error.message,
      request: redact(request)
    };
  }
}

function summarize(results) {
  return results.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {});
}

function reportPath(options) {
  if (options.report) return path.resolve(options.report);
  return path.join(ensureCacheDir(), `api-live-report-${nowCompact()}.json`);
}

async function runLiveApiTest(runtime, options = {}) {
  const settings = {
    includeDangerous: Boolean(options.includeDangerous || profileTestOption(runtime.profile, "includeDangerous")),
    noLogin: Boolean(options.noLogin),
    timeoutMs: Number(options.timeoutMs || options.timeout || 15000),
    delayMs: Number(options.delayMs || options.delay || 0),
    only: options.only,
    set: options.set || {},
    headers: options.headers || {},
    baseUrl: options.baseUrl,
    report: options.report
  };

  const login = await ensureLogin(runtime, settings);
  const endpoints = Object.values(runtime.registry)
    .filter((endpoint) => !settings.only || endpoint.id.startsWith(`${settings.only}.`) || endpoint.namespace === settings.only)
    .sort(endpointOrder);
  const results = [];

  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint, runtime, settings);
    results.push(result);
    console.log(`[${results.length}/${endpoints.length}] ${endpoint.id} ${result.status}${result.httpStatus ? ` HTTP ${result.httpStatus}` : ""}`);
    if (settings.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settings.delayMs));
    }
  }

  const report = {
    ok: true,
    profile: runtime.profile.name,
    generatedAt: new Date().toISOString(),
    includeDangerous: settings.includeDangerous,
    login,
    total: endpoints.length,
    summary: summarize(results),
    results
  };
  const file = reportPath(settings);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(redact(report), null, 2)}\n`);
  report.reportPath = file;
  return report;
}

module.exports = {
  runLiveApiTest,
  sampleArgsForEndpoint
};
