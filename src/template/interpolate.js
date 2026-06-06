const crypto = require("node:crypto");

function getPath(source, dottedPath) {
  if (dottedPath === "now.iso") return new Date().toISOString();
  if (dottedPath === "uuid") return crypto.randomUUID();

  const parts = dottedPath.split(".");
  let current = source;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function interpolateString(value, context) {
  const exact = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (exact) {
    return getPath(context, exact[1].trim());
  }
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => {
    const resolved = getPath(context, expression.trim());
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

function interpolate(value, context) {
  if (typeof value === "string") {
    return interpolateString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, context));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, context)])
    );
  }
  return value;
}

function pruneUndefined(value, options = {}) {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefined(item, options))
      .filter((item) => item !== undefined && item !== null);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const pruned = pruneUndefined(item, options);
      if (pruned === undefined || pruned === null) continue;
      if (options.dropEmptyStrings && pruned === "") continue;
      result[key] = pruned;
    }
    return result;
  }
  return value;
}

module.exports = {
  getPath,
  interpolate,
  pruneUndefined
};
