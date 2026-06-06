const { parseArgs } = require("./util/args");
const { parseJsonObject, stableJson } = require("./util/json");
const { redact } = require("./util/redact");
const { setConfigRoot } = require("./util/paths");
const {
  listApiFiles,
  listProfiles,
  loadProfile,
  loadApiRegistry,
  listFlows,
  loadFlow
} = require("./config/loaders");
const { readCache, writeCache, clearCache, resolveCachePath } = require("./cache/sessionCache");
const { executeEndpoint } = require("./http/client");
const { runFlow } = require("./flow/runner");
const { toCurl } = require("./http/requestBuilder");
const { compareScanToRegistry, scanServices } = require("./config/serviceScanner");
const { runLiveApiTest } = require("./api/liveTester");

function print(value, json = false) {
  if (json || typeof value !== "string") {
    console.log(stableJson(value));
  } else {
    console.log(value);
  }
}

function usage() {
  return [
    "Usage:",
    "  evt profile list [--config-root ./cli]",
    "  evt profile show <name>",
    "  evt api list",
    "  evt api show <id>",
    "  evt api scan [--missing] [--scan-config path/to/scanner.json]",
    "  evt api call <id> [--profile local] [--set k=v] [--body '{...}'] [--dry-run]",
    "  evt api test-all [--profile local] [--include-dangerous] [--only namespace]",
    "  evt validate",
    "  evt flow list",
    "  evt flow run <name> [--profile local] [--set k=v] [--dry-run]",
    "  evt cache show|clear|path"
  ].join("\n");
}

function commonRuntime(options) {
  const profile = loadProfile(options.profile || "local");
  const cachePath = resolveCachePath(options.cache);
  const cache = readCache(cachePath);
  return {
    profile,
    cachePath,
    cache,
    registry: loadApiRegistry()
  };
}

async function handleProfile(tokens) {
  const sub = tokens[0];
  const options = parseArgs(tokens.slice(1));
  setConfigRoot(options.configRoot);
  if (sub === "list") {
    print(listProfiles(), options.json);
    return;
  }
  if (sub === "show") {
    print(loadProfile(options._[0]), true);
    return;
  }
  throw new Error(usage());
}

async function handleApi(tokens) {
  const sub = tokens[0];
  const options = parseArgs(tokens.slice(1));
  setConfigRoot(options.configRoot);
  const registry = loadApiRegistry();

  if (sub === "list") {
    print(Object.keys(registry).sort(), options.json);
    return;
  }
  if (sub === "show") {
    const endpoint = registry[options._[0]];
    if (!endpoint) throw new Error(`Endpoint not found: ${options._[0]}`);
    print(endpoint, true);
    return;
  }
  if (sub === "scan") {
    const scanned = scanServices({ scanConfig: options.scanConfig });
    const comparison = compareScanToRegistry(scanned, registry);
    const payload = options.missing ? comparison.missing : {
      scanned,
      covered: comparison.covered.length,
      missing: comparison.missing
    };
    print(payload, true);
    return;
  }
  if (sub === "call") {
    const id = options._[0];
    const endpoint = registry[id];
    if (!endpoint) throw new Error(`Endpoint not found: ${id}`);
    const runtime = commonRuntime(options);
    const body = parseJsonObject(options.body, "--body");
    const query = parseJsonObject(options.query, "--query");
    const context = {
      profile: runtime.profile,
      cache: runtime.cache,
      args: { ...(options.set || {}), ...body, ...query },
      inputs: {},
      env: process.env,
      steps: {}
    };
    const result = await executeEndpoint(endpoint, {
      ...runtime,
      context,
      body,
      query,
      cliHeaders: options.headers,
      baseUrl: options.baseUrl,
      dryRun: options.dryRun,
      unsafe: options.unsafe
    });
    if (options.curl) {
      print(result.curl || toCurl(result.request), false);
      return;
    }
    print(options.dryRun ? { ...result, request: redact(result.request) } : result, options.json || options.dryRun);
    return;
  }
  if (sub === "test-all") {
    const runtime = commonRuntime(options);
    const report = await runLiveApiTest(runtime, {
      ...options,
      includeDangerous: options.includeDangerous,
      noLogin: options.noLogin
    });
    print({
      ok: report.ok,
      profile: report.profile,
      total: report.total,
      summary: report.summary,
      login: report.login,
      reportPath: report.reportPath
    }, true);
    return;
  }
  throw new Error(usage());
}

async function handleFlow(tokens) {
  const sub = tokens[0];
  const options = parseArgs(tokens.slice(1));
  setConfigRoot(options.configRoot);
  if (sub === "list") {
    print(listFlows(), options.json);
    return;
  }
  if (sub === "run") {
    const name = options._[0];
    const runtime = commonRuntime(options);
    const flow = loadFlow(name);
    const result = await runFlow(flow, {
      ...runtime,
      set: options.set || {},
      cliHeaders: options.headers,
      baseUrl: options.baseUrl,
      dryRun: options.dryRun,
      unsafe: options.unsafe,
      noInteractive: Boolean(options.noInteractive) || !process.stdin.isTTY
    });
    print(redact(result), options.json || options.dryRun);
    return;
  }
  throw new Error(usage());
}

async function handleCache(tokens) {
  const sub = tokens[0];
  const options = parseArgs(tokens.slice(1));
  setConfigRoot(options.configRoot);
  const cachePath = resolveCachePath(options.cache);
  if (sub === "show") {
    print(redact(readCache(cachePath)), true);
    return;
  }
  if (sub === "clear") {
    clearCache(cachePath);
    print(`Cleared ${cachePath}`);
    return;
  }
  if (sub === "path") {
    print(cachePath);
    return;
  }
  if (sub === "write") {
    const value = parseJsonObject(options.body || options._[0], "cache write");
    writeCache(cachePath, value);
    print(`Wrote ${cachePath}`);
    return;
  }
  throw new Error(usage());
}

async function handleValidate(tokens) {
  const options = parseArgs(tokens);
  setConfigRoot(options.configRoot);
  const profiles = listProfiles();
  for (const profile of profiles) loadProfile(profile);
  const registry = loadApiRegistry();
  for (const flow of listFlows()) loadFlow(flow);
  print({
    ok: true,
    profiles: profiles.length,
    apiFiles: listApiFiles().length,
    endpoints: Object.keys(registry).length,
    flows: listFlows().length
  }, options.json);
}

async function run(argv) {
  const [command, ...tokens] = argv;
  if (!command || command === "help" || command === "--help") {
    print(usage());
    return;
  }
  if (command === "profile") return handleProfile(tokens);
  if (command === "api") return handleApi(tokens);
  if (command === "flow") return handleFlow(tokens);
  if (command === "cache") return handleCache(tokens);
  if (command === "validate") return handleValidate(tokens);
  throw new Error(usage());
}

module.exports = {
  run,
  usage
};
