const { getPath, interpolate, pruneUndefined } = require("../template/interpolate");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaEntries(schemaGroup) {
  return isPlainObject(schemaGroup) ? Object.entries(schemaGroup) : [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function sourceValue(name, definition, context, explicit) {
  if (explicit && Object.prototype.hasOwnProperty.call(explicit, name)) {
    return explicit[name];
  }
  if (definition.from) {
    const value = getPath(context, definition.from);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return firstDefined(
    context.args && context.args[name],
    context.inputs && context.inputs[name],
    context.vars && context.vars[name],
    definition.default
  );
}

function coerceValue(name, value, definition) {
  if (value === undefined || value === null || value === "") return undefined;
  const type = definition.type || "string";

  if (type === "string") return String(value);
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) throw new Error(`Parameter ${name} must be a number`);
    return number;
  }
  if (type === "integer") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(number)) throw new Error(`Parameter ${name} must be an integer`);
    return number;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`Parameter ${name} must be a boolean`);
  }
  if (type === "array") {
    return Array.isArray(value) ? value : String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (type === "object") {
    if (isPlainObject(value)) return value;
    try {
      return JSON.parse(String(value));
    } catch (_) {
      throw new Error(`Parameter ${name} must be an object`);
    }
  }
  throw new Error(`Unsupported schema type for ${name}: ${type}`);
}

function validateEnum(name, value, definition) {
  if (value === undefined || !Array.isArray(definition.enum)) return;
  const allowed = definition.enum.map(String);
  if (!allowed.includes(String(value))) {
    throw new Error(`Parameter ${name} must be one of: ${allowed.join(", ")}`);
  }
}

function materializeSchemaGroup(schemaGroup, context, explicit = {}, options = {}) {
  const result = {};
  for (const [name, rawDefinition] of schemaEntries(schemaGroup)) {
    const definition = isPlainObject(rawDefinition) ? rawDefinition : { type: String(rawDefinition) };
    let value = sourceValue(name, definition, context, explicit);
    if (typeof value === "string") {
      value = interpolate(value, context);
    }
    if (definition.required && (value === undefined || value === null || value === "")) {
      if (!options.dryRun) {
        throw new Error(`Missing required parameter: ${name}`);
      }
      continue;
    }
    value = coerceValue(name, value, definition);
    validateEnum(name, value, definition);
    if (value !== undefined) result[name] = value;
  }
  return pruneUndefined(result);
}

function materializeEndpointSchema(endpoint, context, explicit, options = {}) {
  const schema = endpoint.schema || {};
  return {
    path: materializeSchemaGroup(schema.path, context, explicit.path || {}, options),
    query: materializeSchemaGroup(schema.query, context, explicit.query || {}, options),
    body: materializeSchemaGroup(schema.body, context, explicit.body || {}, options)
  };
}

module.exports = {
  materializeEndpointSchema,
  materializeSchemaGroup
};
