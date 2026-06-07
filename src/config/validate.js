const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const VALID_BODY_TYPES = new Set(["json", "formUrlEncoded", "multipart", "raw"]);
const VALID_INPUT_TYPES = new Set(["string", "password", "number", "boolean"]);
const VALID_SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function push(errors, file, message) {
  errors.push(file ? `${file}: ${message}` : message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateProfile(profile, file) {
  const errors = [];
  if (!isObject(profile)) {
    push(errors, file, "profile must be an object");
    return errors;
  }
  if (!profile.name) push(errors, file, "profile.name is required");
  if (!profile.baseUrl && !profile.baseUrls) push(errors, file, "profile.baseUrl or profile.baseUrls is required");
  if (profile.baseUrls && !isObject(profile.baseUrls)) push(errors, file, "profile.baseUrls must be an object");
  if (profile.headers && !isObject(profile.headers)) push(errors, file, "profile.headers must be an object");
  if (profile.auth && !isObject(profile.auth)) push(errors, file, "profile.auth must be an object");
  if (profile.inputs && !isObject(profile.inputs)) push(errors, file, "profile.inputs must be an object");
  if (profile.fixtures && !isObject(profile.fixtures)) push(errors, file, "profile.fixtures must be an object");
  if (profile.test && !isObject(profile.test)) push(errors, file, "profile.test must be an object");
  return errors;
}

function validateApiDocument(api, file) {
  const errors = [];
  if (!isObject(api)) {
    push(errors, file, "API YAML must be an object");
    return errors;
  }
  if (!api.namespace || typeof api.namespace !== "string") {
    push(errors, file, "namespace is required");
  }
  if (!isObject(api.endpoints)) {
    push(errors, file, "endpoints must be an object");
    return errors;
  }

  for (const [name, endpoint] of Object.entries(api.endpoints)) {
    const label = `${api.namespace || "unknown"}.${name}`;
    if (!isObject(endpoint)) {
      push(errors, file, `${label} must be an object`);
      continue;
    }
    const method = String(endpoint.method || "GET").toUpperCase();
    const bodyType = endpoint.bodyType || "json";
    if (!VALID_METHODS.has(method)) push(errors, file, `${label}.method is invalid: ${endpoint.method}`);
    if (!endpoint.path || typeof endpoint.path !== "string") push(errors, file, `${label}.path is required`);
    if (!VALID_BODY_TYPES.has(bodyType)) push(errors, file, `${label}.bodyType is invalid: ${bodyType}`);
    if (endpoint.query && !isObject(endpoint.query)) push(errors, file, `${label}.query must be an object`);
    if (endpoint.body && !isObject(endpoint.body)) push(errors, file, `${label}.body must be an object`);
    if (endpoint.headers && !isObject(endpoint.headers)) push(errors, file, `${label}.headers must be an object`);
    if (endpoint.service && typeof endpoint.service !== "string") push(errors, file, `${label}.service must be a string`);
    if (endpoint.description !== undefined && typeof endpoint.description !== "string") {
      push(errors, file, `${label}.description must be a string`);
    }
    if (endpoint.dangerous !== undefined && typeof endpoint.dangerous !== "boolean") {
      push(errors, file, `${label}.dangerous must be a boolean`);
    }
    validateEndpointSchema(endpoint.schema, file, label, errors);
  }
  return errors;
}

function validateSchemaGroup(group, file, label, errors) {
  if (group === undefined) return;
  if (!isObject(group)) {
    push(errors, file, `${label} must be an object`);
    return;
  }
  for (const [name, definition] of Object.entries(group)) {
    const field = `${label}.${name}`;
    if (typeof definition === "string") {
      if (!VALID_SCHEMA_TYPES.has(definition)) push(errors, file, `${field} type is invalid: ${definition}`);
      continue;
    }
    if (!isObject(definition)) {
      push(errors, file, `${field} must be an object or type string`);
      continue;
    }
    if (definition.type && !VALID_SCHEMA_TYPES.has(definition.type)) {
      push(errors, file, `${field}.type is invalid: ${definition.type}`);
    }
    if (definition.required !== undefined && typeof definition.required !== "boolean") {
      push(errors, file, `${field}.required must be a boolean`);
    }
    if (definition.enum !== undefined && !Array.isArray(definition.enum)) {
      push(errors, file, `${field}.enum must be an array`);
    }
    if (definition.from !== undefined && typeof definition.from !== "string") {
      push(errors, file, `${field}.from must be a string`);
    }
    if (definition.description !== undefined && typeof definition.description !== "string") {
      push(errors, file, `${field}.description must be a string`);
    }
  }
}

function validateEndpointSchema(schema, file, label, errors) {
  if (schema === undefined) return;
  if (!isObject(schema)) {
    push(errors, file, `${label}.schema must be an object`);
    return;
  }
  validateSchemaGroup(schema.path, file, `${label}.schema.path`, errors);
  validateSchemaGroup(schema.query, file, `${label}.schema.query`, errors);
  validateSchemaGroup(schema.body, file, `${label}.schema.body`, errors);
}

function validateApiRegistry(registry) {
  const errors = [];
  const seen = new Set();
  for (const [id, endpoint] of Object.entries(registry)) {
    if (seen.has(id)) push(errors, "", `duplicate endpoint id: ${id}`);
    seen.add(id);
    if (!endpoint.path) push(errors, "", `${id}.path is required`);
    if (!isObject(endpoint.response) || Object.keys(endpoint.response).length === 0) {
      push(errors, "", `${id}.response is required`);
    }
  }
  return errors;
}

function validateFlow(flow, file) {
  const errors = [];
  if (!isObject(flow)) {
    push(errors, file, "flow must be an object");
    return errors;
  }
  if (!flow.name || typeof flow.name !== "string") push(errors, file, "flow.name is required");
  if (flow.inputs !== undefined) {
    if (!isObject(flow.inputs)) {
      push(errors, file, "flow.inputs must be an object");
    } else {
      for (const [key, input] of Object.entries(flow.inputs)) {
        if (!isObject(input)) {
          push(errors, file, `inputs.${key} must be an object`);
          continue;
        }
        if (input.type && !VALID_INPUT_TYPES.has(input.type)) {
          push(errors, file, `inputs.${key}.type is invalid: ${input.type}`);
        }
      }
    }
  }
  if (flow.inputGroups !== undefined) {
    if (!isObject(flow.inputGroups)) {
      push(errors, file, "flow.inputGroups must be an object");
    } else if (flow.inputGroups.anyOf !== undefined) {
      if (!Array.isArray(flow.inputGroups.anyOf)) {
        push(errors, file, "flow.inputGroups.anyOf must be an array");
      } else {
        for (const [index, group] of flow.inputGroups.anyOf.entries()) {
          if (!isObject(group)) {
            push(errors, file, `inputGroups.anyOf[${index}] must be an object`);
            continue;
          }
          if (!Array.isArray(group.fields) || group.fields.length === 0) {
            push(errors, file, `inputGroups.anyOf[${index}].fields must be a non-empty array`);
          }
        }
      }
    }
  }
  if (flow.steps !== undefined && !Array.isArray(flow.steps)) push(errors, file, "flow.steps must be an array");
  for (const [index, step] of (flow.steps || []).entries()) {
    if (!isObject(step)) {
      push(errors, file, `steps[${index}] must be an object`);
      continue;
    }
    if (!step.call && step.wait === undefined) push(errors, file, `steps[${index}] must declare call or wait`);
    if (step.call && typeof step.call !== "string") push(errors, file, `steps[${index}].call must be a string`);
    if (step.body && !isObject(step.body)) push(errors, file, `steps[${index}].body must be an object`);
    if (step.query && !isObject(step.query)) push(errors, file, `steps[${index}].query must be an object`);
    if (step.headers && !isObject(step.headers)) push(errors, file, `steps[${index}].headers must be an object`);
    if (step.extract && !isObject(step.extract)) push(errors, file, `steps[${index}].extract must be an object`);
    if (step.cache && !isObject(step.cache)) push(errors, file, `steps[${index}].cache must be an object`);
    if (step.expect && !Array.isArray(step.expect) && !isObject(step.expect)) {
      push(errors, file, `steps[${index}].expect must be an object or array`);
    }
  }
  if (flow.save !== undefined) {
    if (!isObject(flow.save)) {
      push(errors, file, "flow.save must be an object");
    } else {
      if (flow.save.cache && !isObject(flow.save.cache)) push(errors, file, "flow.save.cache must be an object");
      if (flow.save.required && !Array.isArray(flow.save.required)) push(errors, file, "flow.save.required must be an array");
    }
  }
  return errors;
}

function throwIfInvalid(errors) {
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join("\n")}`);
  }
}

module.exports = {
  validateProfile,
  validateApiDocument,
  validateApiRegistry,
  validateFlow,
  throwIfInvalid,
  VALID_BODY_TYPES,
  VALID_METHODS,
  VALID_SCHEMA_TYPES
};
