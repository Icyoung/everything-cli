#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const IGNORE_DIRS = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".ufoo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "Pods",
  "target"
]);

const LANGUAGE_DEFS = {
  kotlin: {
    extensions: [".kt"],
    hints: [/Service\.kt$/i, /Api\.kt$/i, /Repository\.kt$/i, /http\.(get|post|put|patch|delete)/]
  },
  swift: {
    extensions: [".swift"],
    hints: [/Service\.swift$/i, /API\.swift$/i, /Api\.swift$/i, /client\.(get|post|put|patch|delete)/]
  },
  js: {
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"],
    hints: [/(service|api|client|request|http)\.[cm]?[jt]sx?$/i, /\b(fetch|axios)\s*\(/, /\.(get|post|put|patch|delete)\s*\(/]
  },
  dart: {
    extensions: [".dart"],
    hints: [/(service|api|client|repository)\.dart$/i, /\.(get|post|put|patch|delete)\s*\(/]
  }
};

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    const key = (equals >= 0 ? raw.slice(0, equals) : raw)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === "dryRun" || key === "json") {
      options[key] = true;
    } else {
      options[key] = equals >= 0 ? raw.slice(equals + 1) : argv[++index];
    }
  }
  return options;
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/") || ".";
}

function defaultConfigRoot(cwd) {
  if (process.env.EVT_CLI_ROOT) return path.resolve(process.env.EVT_CLI_ROOT);
  if (process.env.EVERYTHING_CLI_ROOT) return path.resolve(process.env.EVERYTHING_CLI_ROOT);
  if (path.basename(cwd) === "cli") return cwd;
  return path.join(cwd, "cli");
}

function walkFiles(root, files = []) {
  if (!fs.existsSync(root)) return files;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    files.push(root);
    return files;
  }
  if (!stat.isDirectory()) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    walkFiles(path.join(root, entry.name), files);
  }
  return files;
}

function fileLooksRelevant(file, language, root) {
  const def = LANGUAGE_DEFS[language];
  const relative = posixRelative(root, file);
  const basename = path.basename(file);
  const text = fs.readFileSync(file, "utf8").slice(0, 20000);
  return def.hints.some((hint) => hint.test(basename) || hint.test(relative) || hint.test(text));
}

function collapseDirs(root, files) {
  const dirs = [...new Set(files.map((file) => path.dirname(file)))]
    .map((dir) => posixRelative(root, dir))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  const collapsed = [];
  for (const dir of dirs) {
    if (!collapsed.some((parent) => dir === parent || dir.startsWith(`${parent}/`))) {
      collapsed.push(dir);
    }
  }
  return collapsed;
}

function discoverTargets(projectRoot) {
  const files = walkFiles(projectRoot);
  const targets = [];
  for (const [language, def] of Object.entries(LANGUAGE_DEFS)) {
    const matching = files
      .filter((file) => def.extensions.includes(path.extname(file)))
      .filter((file) => fileLooksRelevant(file, language, projectRoot));
    if (matching.length === 0) continue;
    targets.push({ language, paths: collapseDirs(projectRoot, matching) });
  }
  return targets;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const configRoot = path.resolve(options.configRoot || defaultConfigRoot(cwd));
  const projectRoot = path.resolve(options.root || (path.basename(configRoot) === "cli" ? path.dirname(configRoot) : cwd));
  const dataDir = path.join(configRoot, "data");
  const apiDir = path.join(dataDir, "apis");
  const scannerFile = path.resolve(options.scannerFile || path.join(dataDir, "scanner.json"));
  const scannerDir = path.dirname(scannerFile);
  const fallbackTargets = discoverTargets(projectRoot);
  const config = {
    root: posixRelative(scannerDir, projectRoot),
    apiDir: posixRelative(scannerDir, apiDir),
    targets: [
      {
        language: "skill",
        name: "evt-api-scanner",
        skill: "evt-api-scanner"
      },
      ...fallbackTargets
    ]
  };

  if (!options.dryRun) {
    fs.mkdirSync(apiDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, "flows"), { recursive: true });
    fs.mkdirSync(path.join(dataDir, "profiles"), { recursive: true });
    fs.mkdirSync(scannerDir, { recursive: true });
    fs.writeFileSync(scannerFile, `${JSON.stringify(config, null, 2)}\n`);
  }

  process.stdout.write(`${JSON.stringify({
    wrote: !options.dryRun,
    projectRoot,
    configRoot,
    scannerFile,
    apiDir,
    targets: config.targets
  }, null, 2)}\n`);
}

main();
