#!/usr/bin/env node

const { listProfiles, loadApiRegistry, loadProfile } = require("../src/config/loaders");
const { compareScanToRegistry, scanServices } = require("../src/config/serviceScanner");
const { setConfigRoot } = require("../src/util/paths");

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, got: ${value}`);
  return parsed;
}

function camelOption(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseAuditOptions(argv = []) {
  const options = {};
  const booleanOptions = new Set(["strict", "preferFallback", "strictSkill"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    const name = camelOption(equals >= 0 ? raw.slice(0, equals) : raw);
    const inlineValue = equals >= 0 ? raw.slice(equals + 1) : undefined;
    if (booleanOptions.has(name)) {
      options[name] = inlineValue === undefined ? true : inlineValue !== "false";
    } else if (inlineValue !== undefined) {
      options[name] = inlineValue;
    } else {
      index += 1;
      if (index >= argv.length) throw new Error(`--${raw} expects a value`);
      options[name] = argv[index];
    }
  }
  return options;
}

function hasObjectEntries(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function schemaGroupHasFields(group) {
  return hasObjectEntries(group);
}

function hasMeaningfulSchema(endpoint) {
  const schema = endpoint.schema;
  if (!hasObjectEntries(schema)) return false;
  return schemaGroupHasFields(schema.path) || schemaGroupHasFields(schema.query) || schemaGroupHasFields(schema.body);
}

function hasDetailedResponse(endpoint) {
  const response = endpoint.response;
  if (!hasObjectEntries(response)) return false;
  const data = response.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return true;
  if (data.type !== "object") return true;
  return Boolean(data.model || data.fields || data.items || response.envelope);
}

function isGenericResponse(endpoint) {
  return hasObjectEntries(endpoint.response) && !hasDetailedResponse(endpoint);
}

function hasUnresolvedPath(endpoint) {
  const value = String(endpoint.path || "");
  return /\$\{|AppConfig|undefined|null/.test(value);
}

function hasUsablePath(endpoint) {
  const value = String(endpoint.path || "");
  return /^https?:\/\//i.test(value) || value.startsWith("/") || Boolean(endpoint.service);
}

function looksPrivate(endpoint) {
  const haystack = `${endpoint.id || ""} ${endpoint.path || ""}`.toLowerCase();
  return /(user|account|asset|balance|order|position|history|withdraw|deposit|transfer|address|invite|identity|auth|password|bind|google|phone|email)/.test(haystack) &&
    !/(login|register|oauth|public|config|country|currency|currencies|banner|language|version|market|ticker|kline|depth|symbol|spotitems|contractitems)/.test(haystack);
}

function looksPublic(endpoint) {
  const haystack = `${endpoint.id || ""} ${endpoint.path || ""}`.toLowerCase();
  return /(login|register|oauth|public|config|country|currency|currencies|banner|language|version|market|ticker|kline|depth|symbol|spotitems|contractitems)/.test(haystack);
}

function looksDangerous(endpoint) {
  const method = String(endpoint.method || "GET").toUpperCase();
  if (method === "GET") return false;
  const haystack = `${endpoint.id || ""} ${endpoint.path || ""}`.toLowerCase();
  return /(create|change|adjust|cancel|close|open|transfer|withdraw|bind|unbind|modify|patch|add|update|delete|disable|identity|set|unlink|margin|leverage|order|password)/.test(haystack) &&
    !/(login|check|send|verify|oauth)/.test(haystack);
}

function endpointList(registry) {
  return Object.values(registry).sort((left, right) => left.id.localeCompare(right.id));
}

function ratio(count, total) {
  return total === 0 ? 0 : count / total;
}

function collectProfileServices() {
  const services = new Set();
  const profiles = [];
  for (const profileName of listProfiles()) {
    const profile = loadProfile(profileName);
    profiles.push(profileName);
    for (const service of Object.keys(profile.baseUrls || {})) {
      services.add(service);
    }
    if (profile.baseUrl) services.add("default");
  }
  return { profiles, services };
}

function summarize(registry, scanned) {
  const endpoints = endpointList(registry);
  const comparison = compareScanToRegistry(scanned, registry);
  const { profiles, services } = collectProfileServices();
  const byMethodPath = new Map();
  for (const endpoint of endpoints) {
    const key = `${String(endpoint.method || "GET").toUpperCase()}:${endpoint.path}`;
    if (!byMethodPath.has(key)) byMethodPath.set(key, []);
    byMethodPath.get(key).push(endpoint.id);
  }

  const emptySchema = endpoints.filter((endpoint) => !hasMeaningfulSchema(endpoint));
  const missingResponse = endpoints.filter((endpoint) => !hasObjectEntries(endpoint.response));
  const genericResponse = endpoints.filter(isGenericResponse);
  const unresolvedPath = endpoints.filter(hasUnresolvedPath);
  const unusablePath = endpoints.filter((endpoint) => !hasUsablePath(endpoint));
  const unmatchedService = endpoints.filter((endpoint) => endpoint.service && profiles.length > 0 && !services.has(endpoint.service));
  const duplicateMethodPath = Array.from(byMethodPath.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
  const authSuspect = endpoints.filter((endpoint) =>
    (endpoint.auth === false && looksPrivate(endpoint)) ||
    (endpoint.auth === true && looksPublic(endpoint))
  );
  const dangerousSuspect = endpoints.filter((endpoint) => !endpoint.dangerous && looksDangerous(endpoint));

  return {
    scanned: scanned.length,
    endpoints: endpoints.length,
    covered: comparison.covered.length,
    missing: comparison.missing.map((endpoint) => endpoint.id),
    profiles,
    emptySchema: emptySchema.map((endpoint) => endpoint.id),
    missingResponse: missingResponse.map((endpoint) => endpoint.id),
    genericResponse: genericResponse.map((endpoint) => endpoint.id),
    unresolvedPath: unresolvedPath.map((endpoint) => endpoint.id),
    unusablePath: unusablePath.map((endpoint) => endpoint.id),
    unmatchedService: unmatchedService.map((endpoint) => `${endpoint.id}:${endpoint.service}`),
    duplicateMethodPath,
    authSuspect: authSuspect.map((endpoint) => endpoint.id),
    dangerousSuspect: dangerousSuspect.map((endpoint) => endpoint.id),
    ratios: {
      emptySchema: ratio(emptySchema.length, endpoints.length),
      genericResponse: ratio(genericResponse.length, endpoints.length)
    }
  };
}

function evaluateStrict(summary, options) {
  const maxMissing = toNumber(options.maxMissing, 0);
  const maxEmptySchemaRatio = toNumber(options.maxEmptySchemaRatio, 0.25);
  const maxGenericResponseRatio = toNumber(options.maxGenericResponseRatio, 0.05);
  const maxUnresolvedPath = toNumber(options.maxUnresolvedPath, 0);
  const maxUnmatchedService = toNumber(options.maxUnmatchedService, 0);
  const maxUnusablePath = toNumber(options.maxUnusablePath, 0);
  const maxDuplicateMethodPath = toNumber(options.maxDuplicateMethodPath, 0);
  const failures = [];

  if (summary.missing.length > maxMissing) failures.push(`missing scan coverage ${summary.missing.length} > ${maxMissing}`);
  if (summary.ratios.emptySchema > maxEmptySchemaRatio) {
    failures.push(`empty schema ratio ${summary.ratios.emptySchema.toFixed(3)} > ${maxEmptySchemaRatio}`);
  }
  if (summary.ratios.genericResponse > maxGenericResponseRatio) {
    failures.push(`generic response ratio ${summary.ratios.genericResponse.toFixed(3)} > ${maxGenericResponseRatio}`);
  }
  if (summary.unresolvedPath.length > maxUnresolvedPath) failures.push(`unresolved paths ${summary.unresolvedPath.length} > ${maxUnresolvedPath}`);
  if (summary.unmatchedService.length > maxUnmatchedService) failures.push(`unmatched services ${summary.unmatchedService.length} > ${maxUnmatchedService}`);
  if (summary.unusablePath.length > maxUnusablePath) failures.push(`unusable paths ${summary.unusablePath.length} > ${maxUnusablePath}`);
  if (summary.duplicateMethodPath.length > maxDuplicateMethodPath) {
    failures.push(`duplicate method+path ${summary.duplicateMethodPath.length} > ${maxDuplicateMethodPath}`);
  }
  if (summary.missingResponse.length > 0) failures.push(`missing responses ${summary.missingResponse.length} > 0`);

  return failures;
}

function compact(summary) {
  return {
    scanned: summary.scanned,
    endpoints: summary.endpoints,
    covered: summary.covered,
    missing: summary.missing,
    profiles: summary.profiles,
    counts: {
      emptySchema: summary.emptySchema.length,
      missingResponse: summary.missingResponse.length,
      genericResponse: summary.genericResponse.length,
      unresolvedPath: summary.unresolvedPath.length,
      unusablePath: summary.unusablePath.length,
      unmatchedService: summary.unmatchedService.length,
      duplicateMethodPath: summary.duplicateMethodPath.length,
      authSuspect: summary.authSuspect.length,
      dangerousSuspect: summary.dangerousSuspect.length
    },
    ratios: summary.ratios,
    samples: {
      emptySchema: summary.emptySchema.slice(0, 25),
      genericResponse: summary.genericResponse.slice(0, 25),
      unresolvedPath: summary.unresolvedPath.slice(0, 25),
      unmatchedService: summary.unmatchedService.slice(0, 25),
      authSuspect: summary.authSuspect.slice(0, 25),
      dangerousSuspect: summary.dangerousSuspect.slice(0, 25)
    },
    duplicateMethodPath: summary.duplicateMethodPath.slice(0, 25)
  };
}

function runApiAudit(argv = process.argv.slice(2), options = {}) {
  const auditOptions = parseAuditOptions(argv);
  const strict = Boolean(auditOptions.strict || options.strict);
  setConfigRoot(auditOptions.configRoot);
  const registry = loadApiRegistry();
  const scanned = scanServices(auditOptions);
  const summary = summarize(registry, scanned);
  const failures = strict ? evaluateStrict(summary, auditOptions) : [];
  const payload = {
    ok: failures.length === 0,
    strict: Boolean(strict),
    ...compact(summary),
    failures
  };

  if (!options.silent) {
    console.log(JSON.stringify(payload, null, 2));
  }
  if (failures.length > 0 && options.exitOnFailure) process.exit(1);
  return { failed: failures.length > 0, payload, summary };
}

if (require.main === module) {
  runApiAudit(process.argv.slice(2), { exitOnFailure: true });
}

module.exports = {
  runApiAudit,
  summarize,
  evaluateStrict,
  parseAuditOptions,
  hasMeaningfulSchema,
  hasDetailedResponse,
  isGenericResponse
};
