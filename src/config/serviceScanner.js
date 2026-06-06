const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { cliRoot, configRoot, resolveCliPath } = require("../util/paths");

const repoRoot = path.resolve(cliRoot, "..");

const STRING_PATTERN = `"([^"]+)"|'([^']+)'|\`([^\`]+)\``;
const METHOD_MAP = {
  get: "GET",
  getRaw: "GET",
  fetch: "GET",
  post: "POST",
  postForm: "POST",
  patch: "PATCH",
  put: "PUT",
  delete: "DELETE",
  deleteWithBody: "DELETE",
  postUrlEncoded: "POST",
  upload: "POST"
};

const LANGUAGE_DEFAULTS = {
  kotlin: {
    extensions: [".kt"],
    receivers: ["http"],
    helpers: ["get", "post", "patch", "put", "delete", "deleteWithBody", "postUrlEncoded", "postForm", "getRaw"],
    functionPatterns: [
      /(?:override\s+)?suspend\s+fun\s+([A-Za-z_][A-Za-z0-9_]*)/g,
      /fun\s+([A-Za-z_][A-Za-z0-9_]*)/g
    ],
    namespaceStripPrefixes: ["I"],
    namespaceStripSuffixes: ["Service"]
  },
  swift: {
    extensions: [".swift"],
    receivers: ["http", "client", "api"],
    helpers: ["get", "post", "patch", "put", "delete", "upload"],
    functionPatterns: [/func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g],
    namespaceStripSuffixes: ["Service", "API", "Api"]
  },
  js: {
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"],
    receivers: ["http", "client", "api", "axios"],
    helpers: ["get", "post", "patch", "put", "delete"],
    functionPatterns: [
      /(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
      /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g,
      /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s*)?function\s*\(/g,
      /([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g
    ],
    namespaceStripSuffixes: ["Service", "Api", "API"]
  },
  dart: {
    extensions: [".dart"],
    receivers: ["http", "client", "api", "dio"],
    helpers: ["get", "post", "patch", "put", "delete"],
    functionPatterns: [
      /(?:Future(?:<[^>]+>)?|Stream(?:<[^>]+>)?|void|[A-Za-z_][A-Za-z0-9_<>?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:async\s*)?\{/g
    ],
    namespaceStripSuffixes: ["Service", "Api", "API"]
  }
};

function defaultScanConfig() {
  return {
    root: configRoot(),
    targets: []
  };
}

function parseCliScanOptions(tokens = []) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--scan-config") {
      index += 1;
      options.scanConfig = tokens[index];
    } else if (token.startsWith("--scan-config=")) {
      options.scanConfig = token.slice("--scan-config=".length);
    } else if (token === "--config-root") {
      index += 1;
      options.configRoot = tokens[index];
    } else if (token.startsWith("--config-root=")) {
      options.configRoot = token.slice("--config-root=".length);
    }
  }
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeConfig(config, baseDir = repoRoot) {
  const root = config.root ? path.resolve(baseDir, config.root) : repoRoot;
  return {
    ...config,
    root,
    apiDir: config.apiDir ? path.resolve(baseDir, config.apiDir) : undefined,
    targets: (config.targets || []).map((target) => ({ ...target }))
  };
}

function loadScanConfig(options = {}) {
  if (options.config) {
    return normalizeConfig(options.config, options.baseDir || repoRoot);
  }

  const explicit = options.scanConfig || process.env.EVERYTHING_SCAN_CONFIG || process.env.NEPTUNE_SCAN_CONFIG;
  if (explicit) {
    const file = path.resolve(explicit);
    return normalizeConfig(readJson(file), path.dirname(file));
  }

  const localConfigs = [
    resolveCliPath("scanner.config.json"),
    resolveCliPath("data", "scanner.json")
  ];
  const localConfig = localConfigs.find((file) => fs.existsSync(file));
  if (localConfig) {
    return normalizeConfig(readJson(localConfig), path.dirname(localConfig));
  }

  return normalizeConfig(defaultScanConfig(), repoRoot);
}

function languageDefaults(language) {
  const defaults = LANGUAGE_DEFAULTS[language];
  if (!defaults) {
    throw new Error(`Unsupported scanner language: ${language}`);
  }
  return defaults;
}

function makeRegexUnion(values) {
  return values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

function globToRegExp(glob) {
  let pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  pattern = pattern
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
    .replace(/__GLOBSTAR__/g, ".*");
  return new RegExp(`^${pattern}$`);
}

function matchesAny(file, patterns, root) {
  if (!patterns || patterns.length === 0) return false;
  const relative = path.relative(root, file).split(path.sep).join("/");
  return patterns.some((pattern) => globToRegExp(pattern).test(relative));
}

function walkFiles(entry) {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(entry)
    .flatMap((child) => walkFiles(path.join(entry, child)));
}

function targetFiles(config, target, defaults) {
  const roots = (target.paths || target.path ? [].concat(target.paths || target.path) : []);
  const extensions = target.extensions || defaults.extensions;
  return roots
    .map((entry) => path.resolve(config.root, entry))
    .flatMap(walkFiles)
    .filter((file) => extensions.includes(path.extname(file)))
    .filter((file) => !target.include || matchesAny(file, target.include, config.root))
    .filter((file) => !matchesAny(file, target.exclude, config.root))
    .sort();
}

function isSkillTarget(target) {
  return target.language === "skill" || target.language === "command" || target.type === "skill" || target.type === "command";
}

function namespaceFromFile(file, target, defaults) {
  if (target.namespace) return target.namespace;
  let namespace = path.basename(file, path.extname(file));
  for (const prefix of target.namespaceStripPrefixes || defaults.namespaceStripPrefixes || []) {
    if (namespace.startsWith(prefix)) namespace = namespace.slice(prefix.length);
  }
  for (const suffix of target.namespaceStripSuffixes || defaults.namespaceStripSuffixes || []) {
    if (namespace.endsWith(suffix)) namespace = namespace.slice(0, -suffix.length);
  }
  return namespace.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function findNearestFunction(source, index, target, defaults) {
  const before = source.slice(0, index);
  const patterns = target.functionPatterns || defaults.functionPatterns;
  let nearest = { index: -1, name: "unknown" };
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of before.matchAll(pattern)) {
      if (match.index > nearest.index) {
        nearest = { index: match.index, name: match[1] };
      }
    }
  }
  return nearest.name;
}

function bodyTypeFor(helper, target) {
  if (target.bodyTypes && target.bodyTypes[helper]) return target.bodyTypes[helper];
  if (helper === "postUrlEncoded") return "formUrlEncoded";
  if (helper === "postForm" || helper === "upload") return "multipart";
  return "json";
}

function firstQuoted(match, startIndex) {
  for (let index = startIndex; index < match.length; index += 1) {
    if (match[index] !== undefined) return match[index];
  }
  return undefined;
}

function methodForHelper(helper, explicitMethod) {
  if (explicitMethod) return explicitMethod.toUpperCase();
  return METHOD_MAP[helper] || helper.toUpperCase();
}

function normalizePathTemplate(rawPath, target, language) {
  let pathTemplate = rawPath;
  let service = target.service;

  for (const [prefix, serviceName] of Object.entries(target.servicePrefixes || {})) {
    if (pathTemplate.startsWith(prefix)) {
      pathTemplate = pathTemplate.slice(prefix.length);
      service = serviceName;
      break;
    }
  }

  for (const pattern of target.skipPathPatterns || []) {
    if (new RegExp(pattern).test(pathTemplate)) return undefined;
  }

  pathTemplate = pathTemplate
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ":$1")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, ":$1");

  if (language === "swift") {
    pathTemplate = pathTemplate.replace(/\\\(([A-Za-z_][A-Za-z0-9_]*)\)/g, ":$1");
  }

  return { path: pathTemplate, service };
}

function pushEndpoint(endpoints, seen, source, target, defaults, file, matchIndex, helper, rawPath, explicitMethod) {
  if (!rawPath) return;
  const normalized = normalizePathTemplate(rawPath, target, target.language);
  if (!normalized) return;
  const namespace = namespaceFromFile(file, target, defaults);
  if ((target.excludeNamespaces || []).includes(namespace)) return;
  const functionName = findNearestFunction(source, matchIndex, target, defaults);
  const method = methodForHelper(helper, explicitMethod);
  const key = `${functionName}:${method}:${normalized.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  endpoints.push({
    id: `${namespace}.${functionName}`,
    namespace,
    functionName,
    method,
    path: normalized.path,
    bodyType: bodyTypeFor(helper, target),
    service: normalized.service,
    helper,
    auth: target.auth,
    dangerous: target.dangerous,
    file: path.relative(repoRoot, file)
  });
}

function scanReceiverCalls(source, target, defaults, file, endpoints, seen) {
  const receivers = target.receivers || defaults.receivers;
  const helpers = target.helpers || defaults.helpers;
  const receiverPattern = makeRegexUnion(receivers);
  const helperPattern = makeRegexUnion(helpers);
  const directCall = new RegExp(`\\b(?:${receiverPattern})\\s*\\.\\s*(${helperPattern})(?:<[^>]+>)?\\s*\\(\\s*(?:${STRING_PATTERN})`, "g");
  const namedUrlCall = new RegExp(`\\b(?:${receiverPattern})\\s*\\.\\s*(${helperPattern})(?:<[^>]+>)?\\s*\\([\\s\\S]{0,300}?\\burl\\s*=\\s*(?:${STRING_PATTERN})`, "g");
  const uriParseCall = new RegExp(`\\b(?:${receiverPattern})\\s*\\.\\s*(${helperPattern})\\s*\\(\\s*Uri\\.parse\\s*\\(\\s*(?:${STRING_PATTERN})`, "g");

  for (const re of [directCall, namedUrlCall, uriParseCall]) {
    let match;
    while ((match = re.exec(source)) !== null) {
      pushEndpoint(endpoints, seen, source, target, defaults, file, match.index, match[1], firstQuoted(match, 2));
    }
  }
}

function scanFetchCalls(source, target, defaults, file, endpoints, seen) {
  if (target.language !== "js" && !target.scanFetch) return;
  const fetchCall = new RegExp(`\\bfetch\\s*\\(\\s*(?:${STRING_PATTERN})([\\s\\S]{0,300}?)\\)`, "g");
  let match;
  while ((match = fetchCall.exec(source)) !== null) {
    const rawPath = firstQuoted(match, 1);
    const optionsSource = match[4] || "";
    const methodMatch = optionsSource.match(/\bmethod\s*:\s*["'`]([A-Za-z]+)["'`]/);
    pushEndpoint(endpoints, seen, source, target, defaults, file, match.index, "fetch", rawPath, methodMatch && methodMatch[1]);
  }
}

function scanServiceFile(file, target = defaultScanConfig().targets[0], config = defaultScanConfig()) {
  const defaults = languageDefaults(target.language || "kotlin");
  const source = fs.readFileSync(file, "utf8");
  const endpoints = [];
  const seen = new Set();
  scanReceiverCalls(source, target, defaults, file, endpoints, seen);
  scanFetchCalls(source, target, defaults, file, endpoints, seen);
  return endpoints.map((endpoint) => ({
    ...endpoint,
    file: path.relative(config.root || repoRoot, file)
  }));
}

function scanTarget(config, target) {
  if (isSkillTarget(target)) {
    return scanSkillTarget(config, target);
  }
  const defaults = languageDefaults(target.language || "kotlin");
  return targetFiles(config, target, defaults)
    .flatMap((file) => scanServiceFile(file, target, config));
}

function parseSkillOutput(stdout, target) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Skill scanner ${target.name || target.command} must output JSON: ${error.message}`);
  }
  const endpoints = Array.isArray(parsed) ? parsed : parsed.endpoints;
  if (!Array.isArray(endpoints)) {
    throw new Error(`Skill scanner ${target.name || target.command} output must be an array or { endpoints: [] }`);
  }
  return endpoints;
}

function normalizeSkillEndpoint(rawEndpoint, target, config) {
  if (!rawEndpoint || typeof rawEndpoint !== "object") {
    throw new Error(`Skill scanner ${target.name || target.command} returned a non-object endpoint`);
  }
  const namespace = rawEndpoint.namespace || target.namespace;
  const functionName = rawEndpoint.functionName || rawEndpoint.name ||
    (rawEndpoint.id && String(rawEndpoint.id).includes(".") ? String(rawEndpoint.id).split(".").pop() : undefined);
  const id = rawEndpoint.id || (namespace && functionName ? `${namespace}.${functionName}` : undefined);
  if (!id || !namespace || !functionName) {
    throw new Error(`Skill scanner endpoint must include id or namespace + name/functionName`);
  }
  if (!rawEndpoint.path) {
    throw new Error(`Skill scanner endpoint ${id} is missing path`);
  }

  const method = String(rawEndpoint.method || "GET").toUpperCase();
  const bodyType = rawEndpoint.bodyType || "json";
  return {
    id,
    namespace,
    functionName,
    method,
    path: rawEndpoint.path,
    bodyType,
    service: rawEndpoint.service || target.service,
    helper: rawEndpoint.helper || target.name || "skill",
    auth: rawEndpoint.auth !== undefined ? rawEndpoint.auth : target.auth,
    dangerous: rawEndpoint.dangerous !== undefined ? rawEndpoint.dangerous : target.dangerous,
    file: rawEndpoint.file || target.file || undefined,
    source: target.name || "skill"
  };
}

function scanSkillTarget(config, target) {
  const resolvedTarget = resolveSkillTarget(target);
  if (!resolvedTarget.command) {
    throw new Error("Skill scanner target must define command");
  }
  const cwd = resolvedTarget.cwd ? path.resolve(config.root, resolvedTarget.cwd) : config.root;
  const result = spawnSync(resolvedTarget.command, (resolvedTarget.args || []).map(String), {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      EVT_SCAN_ROOT: config.root,
      ...(resolvedTarget.env || {})
    },
    maxBuffer: resolvedTarget.maxBuffer || 10 * 1024 * 1024
  });

  if (result.error) {
    throw new Error(`Skill scanner ${resolvedTarget.name || resolvedTarget.command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(`Skill scanner ${resolvedTarget.name || resolvedTarget.command} exited with ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }

  return parseSkillOutput(result.stdout, resolvedTarget)
    .map((endpoint) => normalizeSkillEndpoint(endpoint, resolvedTarget, config));
}

function resolveSkillTarget(target) {
  if (!target.skill) return target;
  if (target.skill !== "evt-api-scanner") return target;
  return {
    ...target,
    name: target.name || "evt-api-scanner",
    command: process.execPath,
    args: target.args || [
      path.join(cliRoot, "skills", "evt-api-scanner", "scripts", "scan.js"),
      "--root",
      "."
    ]
  };
}

function splitTargets(targets) {
  const skillTargets = [];
  const fallbackTargets = [];
  for (const target of targets || []) {
    if (isSkillTarget(target)) {
      skillTargets.push(target);
    } else {
      fallbackTargets.push(target);
    }
  }
  return { skillTargets, fallbackTargets };
}

function scanTargets(config, targets) {
  return targets.flatMap((target) => scanTarget(config, target));
}

function scanServices(options = {}) {
  const config = loadScanConfig(options);
  if (!config.targets || config.targets.length === 0) return [];
  if (options.preferFallback) {
    return scanTargets(config, config.targets.filter((target) => !isSkillTarget(target)));
  }

  const { skillTargets, fallbackTargets } = splitTargets(config.targets);
  if (skillTargets.length === 0) {
    return scanTargets(config, fallbackTargets);
  }
  try {
    const skillEndpoints = scanTargets(config, skillTargets);
    if (skillEndpoints.length > 0 || fallbackTargets.length === 0) return skillEndpoints;
  } catch (error) {
    if (fallbackTargets.length === 0 || options.strictSkill) throw error;
  }
  return scanTargets(config, fallbackTargets);
}

function compareScanToRegistry(scanned, registry) {
  const yamlByPath = new Map(Object.values(registry).map((endpoint) => [`${endpoint.method}:${endpoint.path}`, endpoint]));
  const missing = scanned.filter((endpoint) => !yamlByPath.has(`${endpoint.method}:${endpoint.path}`));
  const covered = scanned.filter((endpoint) => yamlByPath.has(`${endpoint.method}:${endpoint.path}`));
  return { missing, covered };
}

module.exports = {
  scanServices,
  compareScanToRegistry,
  scanServiceFile,
  loadScanConfig,
  defaultScanConfig,
  parseCliScanOptions,
  resolveSkillTarget,
  repoRoot
};
