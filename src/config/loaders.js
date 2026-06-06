const fs = require("node:fs");
const path = require("node:path");
const { parseYaml } = require("./yaml");
const { resolveCliPath, resolveConfigDir } = require("../util/paths");
const {
  throwIfInvalid,
  validateApiDocument,
  validateApiRegistry,
  validateFlow,
  validateProfile
} = require("./validate");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readYaml(file) {
  return parseYaml(fs.readFileSync(file, "utf8"));
}

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => extensions.includes(path.extname(file)))
    .sort()
    .map((file) => path.join(dir, file));
}

function stripExampleSuffix(name) {
  return name.replace(/\.example$/, "");
}

function listProfiles() {
  return listFiles(resolveConfigDir("profiles"), [".json"])
    .map((file) => stripExampleSuffix(path.basename(file, ".json")));
}

function loadProfile(name = "local") {
  const profilesDir = resolveConfigDir("profiles");
  const file = name.endsWith(".json") || name.includes(path.sep)
    ? path.resolve(name)
    : [path.join(profilesDir, `${name}.json`), path.join(profilesDir, `${name}.example.json`)]
      .find((candidate) => fs.existsSync(candidate));
  if (!file || !fs.existsSync(file)) {
    throw new Error(`Profile not found: ${name}`);
  }
  const profile = readJson(file);
  throwIfInvalid(validateProfile(profile, file));
  return profile;
}

function listApiFiles() {
  return listFiles(resolveConfigDir("apis"), [".yaml", ".yml"]);
}

function loadApiRegistry() {
  const registry = {};
  for (const file of listApiFiles()) {
    const api = readYaml(file);
    throwIfInvalid(validateApiDocument(api, file));
    if (!api.namespace || !api.endpoints) {
      throw new Error(`Invalid API YAML: ${file}`);
    }
    for (const [name, endpoint] of Object.entries(api.endpoints)) {
      const id = `${api.namespace}.${name}`;
      registry[id] = {
        id,
        namespace: api.namespace,
        name,
        bodyType: "json",
        method: "GET",
        auth: false,
        ...endpoint
      };
    }
  }
  throwIfInvalid(validateApiRegistry(registry));
  return registry;
}

function listFlows() {
  return listFiles(resolveConfigDir("flows"), [".yaml", ".yml"])
    .map((file) => stripExampleSuffix(path.basename(file, path.extname(file))));
}

function loadFlow(name) {
  const flowsDir = resolveConfigDir("flows");
  const file = name.endsWith(".yaml") || name.endsWith(".yml") || name.includes(path.sep)
    ? path.resolve(name)
    : [path.join(flowsDir, `${name}.yaml`), path.join(flowsDir, `${name}.example.yaml`)]
      .find((candidate) => fs.existsSync(candidate));
  if (!file || !fs.existsSync(file)) {
    throw new Error(`Flow not found: ${name}`);
  }
  const flow = readYaml(file);
  throwIfInvalid(validateFlow(flow, file));
  return flow;
}

module.exports = {
  listProfiles,
  loadProfile,
  listApiFiles,
  loadApiRegistry,
  listFlows,
  loadFlow
};
