#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { parseYaml } = require("../src/config/yaml");
const { parseCliScanOptions, scanServices } = require("../src/config/serviceScanner");
const { resolveCliPath, setConfigRoot } = require("../src/util/paths");

const endpointKey = (endpoint) => `${String(endpoint.method || "GET").toUpperCase()}:${endpoint.path}`;

function readApiDocument(namespace) {
  const apiDir = resolveCliPath("apis");
  const file = path.join(apiDir, `${namespace}.yaml`);
  if (!fs.existsSync(file)) {
    return { namespace, endpoints: {} };
  }
  return parseYaml(fs.readFileSync(file, "utf8"));
}

function isPublicEndpoint(endpoint) {
  const name = endpoint.functionName || endpoint.name || "";
  const pathValue = endpoint.path || "";
  return /^(login|register|oauth|public|health|status|version|languages?|config|list|get|search|check)/i.test(name) ||
    /\/(public|health|status|version|config)\b/i.test(pathValue);
}

function isDangerousEndpoint(endpoint) {
  const method = String(endpoint.method || "GET").toUpperCase();
  if (method === "GET") return false;

  const name = endpoint.functionName || endpoint.name || "";
  const pathValue = endpoint.path || "";
  if (/^(get|list|history|summary|check|send|login|verify|oauth)/i.test(name) && method === "POST") {
    return false;
  }
  return /create|change|adjust|cancel|close|open|transfer|withdraw|bind|unbind|modify|patch|add|update|delete|disable|deactivate|identity|kyc|set|unlink|margin|leverage|order|password/i
    .test(`${name} ${pathValue}`);
}

function makeEndpoint(scanned) {
  const endpoint = {
    method: scanned.method,
    path: scanned.path,
    auth: scanned.auth !== undefined ? scanned.auth : !isPublicEndpoint(scanned),
    schema: {},
    response: {}
  };

  if (scanned.service) {
    endpoint.service = scanned.service;
  }
  if (scanned.bodyType && scanned.bodyType !== "json") {
    endpoint.bodyType = scanned.bodyType;
  }
  const dangerous = scanned.dangerous !== undefined ? scanned.dangerous : isDangerousEndpoint(scanned);
  if (dangerous) {
    endpoint.dangerous = true;
  }
  return endpoint;
}

function augmentEndpoint(namespace, name, endpoint) {
  const inferred = { namespace, name, functionName: name, ...endpoint };
  if (endpoint.dangerous === undefined && isDangerousEndpoint(inferred)) {
    endpoint.dangerous = true;
  }
  endpoint.schema ||= {};
  endpoint.response ||= {};
  return endpoint;
}

function uniqueName(endpoints, preferred) {
  if (!Object.prototype.hasOwnProperty.call(endpoints, preferred)) return preferred;
  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(endpoints, `${preferred}${suffix}`)) {
    suffix += 1;
  }
  return `${preferred}${suffix}`;
}

function sortObjectByKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function orderedEntries(object) {
  const keyOrder = [
    "service",
    "method",
    "path",
    "auth",
    "dangerous",
    "bodyType",
    "headers",
    "query",
    "body",
    "schema",
    "response"
  ];
  return Object.entries(object).sort(([left], [right]) => {
    const leftIndex = keyOrder.indexOf(left);
    const rightIndex = keyOrder.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
    return left.localeCompare(right);
  });
}

function yamlScalar(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

function writeYamlValue(lines, key, value, indent) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix}${key}: []`);
      return;
    }
    lines.push(`${prefix}${key}:`);
    for (const item of value) {
      lines.push(`${prefix}  - ${yamlScalar(item)}`);
    }
    return;
  }
  if (value && typeof value === "object") {
    const entries = orderedEntries(value);
    if (entries.length === 0) {
      lines.push(`${prefix}${key}: {}`);
      return;
    }
    lines.push(`${prefix}${key}:`);
    for (const [childKey, childValue] of entries) {
      writeYamlValue(lines, childKey, childValue, indent + 2);
    }
    return;
  }
  lines.push(`${prefix}${key}: ${yamlScalar(value)}`);
}

function serializeDocument(document) {
  const lines = [`namespace: ${document.namespace}`, "", "endpoints:"];
  for (const [name, endpoint] of Object.entries(sortObjectByKeys(document.endpoints))) {
    lines.push(`  ${name}:`);
    for (const [key, value] of orderedEntries(endpoint)) {
      writeYamlValue(lines, key, value, 4);
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function main() {
  const scanOptions = parseCliScanOptions(process.argv.slice(2));
  setConfigRoot(scanOptions.configRoot);
  const apiDir = resolveCliPath("apis");
  fs.mkdirSync(apiDir, { recursive: true });
  const scanned = scanServices(scanOptions);
  const existingNamespaces = fs.existsSync(apiDir)
    ? fs.readdirSync(apiDir)
      .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
      .map((file) => path.basename(file, path.extname(file)))
    : [];
  const namespaces = [...new Set([...existingNamespaces, ...scanned.map((endpoint) => endpoint.namespace)])];
  const documents = new Map(namespaces.map((namespace) => [namespace, readApiDocument(namespace)]));
  const coveredPaths = new Set();

  for (const document of documents.values()) {
    document.endpoints ||= {};
    for (const [name, endpoint] of Object.entries(document.endpoints)) {
      document.endpoints[name] = augmentEndpoint(document.namespace, name, endpoint);
      coveredPaths.add(endpointKey(endpoint));
    }
  }

  let added = 0;
  for (const endpoint of scanned) {
    if (coveredPaths.has(endpointKey(endpoint))) continue;
    const document = documents.get(endpoint.namespace);
    const name = uniqueName(document.endpoints, endpoint.functionName);
    document.endpoints[name] = makeEndpoint(endpoint);
    coveredPaths.add(endpointKey(endpoint));
    added += 1;
  }

  for (const namespace of namespaces) {
    const document = documents.get(namespace);
    if (!document.endpoints || Object.keys(document.endpoints).length === 0) continue;
    fs.writeFileSync(path.join(apiDir, `${namespace}.yaml`), serializeDocument(document));
  }

  console.log(JSON.stringify({ scanned: scanned.length, added, namespaces: namespaces.length }, null, 2));
}

main();
