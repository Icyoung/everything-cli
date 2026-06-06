#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cliRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(cliRoot, "package.json"));
const distDir = path.join(cliRoot, "dist");
const packageName = "evt-cli";
const packageDir = path.join(distDir, packageName);
const entryId = "bin/evt.js";

function toPosix(file) {
  return file.split(path.sep).join("/");
}

function normalizeModuleId(file) {
  return path.posix.normalize(toPosix(path.relative(cliRoot, file)));
}

function resolveLocalModule(fromId, request) {
  const base = path.posix.dirname(fromId);
  const target = path.posix.normalize(path.posix.join(base, request));
  const candidates = [
    target,
    `${target}.js`,
    path.posix.join(target, "index.js")
  ];
  for (const candidate of candidates) {
    const absolute = path.join(cliRoot, ...candidate.split("/"));
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return normalizeModuleId(absolute);
    }
  }
  throw new Error(`Unable to resolve ${request} from ${fromId}`);
}

function findLocalRequires(source) {
  const requires = [];
  const pattern = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1].startsWith(".")) {
      requires.push(match[1]);
    }
  }
  return requires;
}

function collectModules(entry) {
  const modules = new Map();
  const queue = [entry];

  while (queue.length > 0) {
    const id = queue.shift();
    if (modules.has(id)) continue;

    const absolute = path.join(cliRoot, ...id.split("/"));
    let source = fs.readFileSync(absolute, "utf8");
    if (source.startsWith("#!")) {
      source = source.replace(/^#!.*\n/, "");
    }
    modules.set(id, source);

    for (const request of findLocalRequires(source)) {
      const resolved = resolveLocalModule(id, request);
      if (!modules.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return modules;
}

function renderExecutable(modules) {
  const moduleEntries = Array.from(modules.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, source]) => `modules[${JSON.stringify(id)}] = function(require, module, exports, __filename, __dirname) {\n${source}\n};`)
    .join("\n\n");

  return `#!/usr/bin/env node
const __nodeRequire = require;
const path = __nodeRequire("node:path");
const runtimeRoot = path.dirname(process.argv[1] ? path.resolve(process.argv[1]) : __filename);
const modules = Object.create(null);
const moduleCache = Object.create(null);

${moduleEntries}

function resolveModule(fromId, request) {
  if (!request.startsWith(".")) return request;
  const base = path.posix.dirname(fromId);
  const target = path.posix.normalize(path.posix.join(base, request));
  const candidates = [target, target + ".js", path.posix.join(target, "index.js")];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(modules, candidate)) return candidate;
  }
  throw new Error("Unable to resolve " + request + " from " + fromId);
}

function loadModule(id) {
  if (!Object.prototype.hasOwnProperty.call(modules, id)) {
    return __nodeRequire(id);
  }
  if (moduleCache[id]) return moduleCache[id].exports;
  const filename = path.join(runtimeRoot, ...id.split("/"));
  const dirname = path.dirname(filename);
  const module = { exports: {} };
  moduleCache[id] = module;
  const localRequire = (request) => loadModule(resolveModule(id, request));
  modules[id](localRequire, module, module.exports, filename, dirname);
  return module.exports;
}

loadModule(${JSON.stringify(entryId)});
`;
}

function copyDir(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: distDir,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function cleanDist() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
}

function main() {
  cleanDist();

  const executablePath = path.join(packageDir, "evt");
  fs.writeFileSync(executablePath, renderExecutable(collectModules(entryId)));
  fs.chmodSync(executablePath, 0o755);

  copyDir(path.join(cliRoot, "data"), path.join(packageDir, "data"));
  copyDir(path.join(cliRoot, "skills"), path.join(packageDir, "skills"));
  fs.copyFileSync(path.join(cliRoot, "README.md"), path.join(packageDir, "README.md"));
  fs.copyFileSync(path.join(cliRoot, "README.zh-CN.md"), path.join(packageDir, "README.zh-CN.md"));

  const artifactName = `${packageName}-${packageJson.version}-${process.platform}-${process.arch}.tar.gz`;
  run("tar", ["-czf", artifactName, packageName]);

  console.log("\nLocal package artifacts:");
  console.log(`- dist/${packageName}/`);
  console.log(`- dist/${artifactName}`);
  console.log("\nPackage contents are limited to evt, data examples, skills, README.md, and README.zh-CN.md.");
  console.log("No npm publish or remote upload was performed.");
}

main();
