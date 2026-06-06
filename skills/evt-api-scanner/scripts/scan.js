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
    receivers: ["http", "client", "api"],
    helpers: ["get", "getRaw", "post", "postUrlEncoded", "postForm", "put", "patch", "delete", "deleteWithBody", "upload"],
    functions: [/(?:override\s+)?suspend\s+fun\s+([A-Za-z_][A-Za-z0-9_]*)/g, /fun\s+([A-Za-z_][A-Za-z0-9_]*)/g],
    stripPrefixes: ["I"],
    stripSuffixes: ["Service", "Api", "API", "Repository"]
  },
  swift: {
    extensions: [".swift"],
    receivers: ["http", "client", "api"],
    helpers: ["get", "post", "put", "patch", "delete", "upload"],
    functions: [/func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g],
    stripSuffixes: ["Service", "Api", "API"]
  },
  js: {
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"],
    receivers: ["http", "client", "api", "axios"],
    helpers: ["get", "post", "put", "patch", "delete"],
    functions: [
      /(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
      /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g,
      /([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(?:async\s*)?function\s*\(/g
    ],
    stripSuffixes: ["Service", "Api", "API"]
  },
  dart: {
    extensions: [".dart"],
    receivers: ["http", "client", "api", "dio"],
    helpers: ["get", "post", "put", "patch", "delete"],
    functions: [
      /(?:Future(?:<[^>]+>)?|Stream(?:<[^>]+>)?|void|[A-Za-z_][A-Za-z0-9_<>?]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:async\s*)?\{/g
    ],
    stripSuffixes: ["Service", "Api", "API"]
  }
};

const METHOD_BY_HELPER = {
  get: "GET",
  getRaw: "GET",
  fetch: "GET",
  post: "POST",
  postForm: "POST",
  postUrlEncoded: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
  deleteWithBody: "DELETE",
  upload: "POST"
};

const STRING_PATTERN = `"([^"]+)"|'([^']+)'|\`([^\`]+)\``;

function parseArgs(argv) {
  const options = { paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      options.paths.push(token);
      continue;
    }
    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    const key = (equals >= 0 ? raw.slice(0, equals) : raw)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = equals >= 0 ? raw.slice(equals + 1) : argv[++index];
  }
  return options;
}

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join("/") || ".";
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

function languageForFile(file) {
  const extension = path.extname(file);
  return Object.entries(LANGUAGE_DEFS).find(([, def]) => def.extensions.includes(extension))?.[0];
}

function makeRegexUnion(values) {
  return values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

function firstQuoted(match, startIndex) {
  for (let index = startIndex; index < match.length; index += 1) {
    if (match[index] !== undefined) return match[index];
  }
  return undefined;
}

function nearestFunction(source, index, def) {
  const before = source.slice(0, index);
  let nearest = { index: -1, name: "unknown" };
  for (const pattern of def.functions) {
    pattern.lastIndex = 0;
    for (const match of before.matchAll(pattern)) {
      if (match.index > nearest.index) nearest = { index: match.index, name: match[1] };
    }
  }
  return nearest.name;
}

function namespaceForFile(file, language) {
  const def = LANGUAGE_DEFS[language];
  let namespace = path.basename(file, path.extname(file));
  for (const prefix of def.stripPrefixes || []) {
    if (namespace.startsWith(prefix)) namespace = namespace.slice(prefix.length);
  }
  for (const suffix of def.stripSuffixes || []) {
    if (namespace.endsWith(suffix)) namespace = namespace.slice(0, -suffix.length);
  }
  return namespace.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function normalizePath(rawPath, language) {
  if (!rawPath || !rawPath.startsWith("/")) return undefined;
  let value = rawPath
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ":$1")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, ":$1");
  if (language === "swift") value = value.replace(/\\\(([A-Za-z_][A-Za-z0-9_]*)\)/g, ":$1");
  return value;
}

function bodyTypeFor(helper) {
  if (helper === "postUrlEncoded") return "formUrlEncoded";
  if (helper === "postForm" || helper === "upload") return "multipart";
  return "json";
}

function pushEndpoint(endpoints, seen, file, root, source, language, helper, rawPath, matchIndex, explicitMethod) {
  const pathTemplate = normalizePath(rawPath, language);
  if (!pathTemplate) return;
  const namespace = namespaceForFile(file, language);
  const functionName = nearestFunction(source, matchIndex, LANGUAGE_DEFS[language]);
  const method = String(explicitMethod || METHOD_BY_HELPER[helper] || helper).toUpperCase();
  const key = `${method}:${pathTemplate}:${functionName}`;
  if (seen.has(key)) return;
  seen.add(key);
  endpoints.push({
    id: `${namespace}.${functionName}`,
    namespace,
    functionName,
    method,
    path: pathTemplate,
    bodyType: bodyTypeFor(helper),
    helper,
    file: posixRelative(root, file),
    source: "evt-api-scanner"
  });
}

function scanFile(file, root) {
  const language = languageForFile(file);
  if (!language) return [];
  const def = LANGUAGE_DEFS[language];
  const source = fs.readFileSync(file, "utf8");
  const endpoints = [];
  const seen = new Set();
  const receiverPattern = makeRegexUnion(def.receivers);
  const helperPattern = makeRegexUnion(def.helpers);
  const calls = [
    new RegExp(`\\b(?:${receiverPattern})\\s*\\.\\s*(${helperPattern})(?:<[^>]+>)?\\s*\\(\\s*(?:${STRING_PATTERN})`, "g"),
    new RegExp(`\\b(?:${receiverPattern})\\s*\\.\\s*(${helperPattern})(?:<[^>]+>)?\\s*\\([\\s\\S]{0,300}?\\burl\\s*=\\s*(?:${STRING_PATTERN})`, "g"),
    new RegExp(`\\b(?:${receiverPattern})\\s*\\.\\s*(${helperPattern})\\s*\\(\\s*Uri\\.parse\\s*\\(\\s*(?:${STRING_PATTERN})`, "g")
  ];
  for (const pattern of calls) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      pushEndpoint(endpoints, seen, file, root, source, language, match[1], firstQuoted(match, 2), match.index);
    }
  }

  if (language === "js") {
    const fetchCall = new RegExp(`\\bfetch\\s*\\(\\s*(?:${STRING_PATTERN})([\\s\\S]{0,300}?)\\)`, "g");
    let match;
    while ((match = fetchCall.exec(source)) !== null) {
      const optionsSource = match[4] || "";
      const methodMatch = optionsSource.match(/\bmethod\s*:\s*["'`]([A-Za-z]+)["'`]/);
      pushEndpoint(endpoints, seen, file, root, source, language, "fetch", firstQuoted(match, 1), match.index, methodMatch && methodMatch[1]);
    }
  }
  return endpoints;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root || process.env.EVT_SCAN_ROOT || process.cwd());
  const entries = options.paths.length > 0 ? options.paths.map((entry) => path.resolve(root, entry)) : [root];
  const files = entries.flatMap((entry) => walkFiles(entry)).filter(languageForFile);
  const endpoints = files.flatMap((file) => scanFile(file, root));
  process.stdout.write(`${JSON.stringify({ endpoints }, null, 2)}\n`);
}

main();
