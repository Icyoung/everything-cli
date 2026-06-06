const fs = require("node:fs");
const path = require("node:path");
const { URL, URLSearchParams } = require("node:url");
const { materializeEndpointSchema } = require("../config/schema");
const { interpolate, pruneUndefined } = require("../template/interpolate");
const { redact } = require("../util/redact");

function mergeObjects(...values) {
  return Object.assign({}, ...values.filter((value) => value && typeof value === "object"));
}

function resolveBaseUrl(profile, endpoint, override) {
  if (override) return override;
  if (profile.baseUrls) {
    return profile.baseUrls[endpoint.service || "default"] || profile.baseUrls.default || profile.baseUrl;
  }
  return profile.baseUrl;
}

function joinUrl(baseUrl, endpointPath) {
  if (/^https?:\/\//i.test(endpointPath)) {
    return endpointPath;
  }
  if (!baseUrl) {
    throw new Error("Missing baseUrl");
  }
  return `${baseUrl.replace(/\/+$/, "")}/${String(endpointPath).replace(/^\/+/, "")}`;
}

function renderPath(endpointPath, context, dryRun) {
  const source = mergeObjects(context.inputs, context.vars, context.args);
  return String(interpolate(endpointPath, context)).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (token, key) => {
    const value = source[key];
    if (value === undefined || value === null || value === "") {
      if (!dryRun) {
        throw new Error(`Missing path parameter: ${key}`);
      }
      return token;
    }
    return encodeURIComponent(String(value));
  });
}

function encodeBody(bodyType, body, options = {}) {
  if (!body || Object.keys(body).length === 0) return undefined;
  if (bodyType === "formUrlEncoded") {
    return new URLSearchParams(body).toString();
  }
  if (bodyType === "json") {
    return JSON.stringify(body);
  }
  if (bodyType === "multipart") {
    if (options.dryRun) {
      return undefined;
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      if (key === "file" || key === "filePath") {
        const filePath = String(value);
        const file = fs.readFileSync(filePath);
        const contentType = body.contentType || "application/octet-stream";
        const filename = body.filename || path.basename(filePath);
        form.append("file", new Blob([file], { type: contentType }), filename);
        continue;
      }
      if (key === "filename" || key === "contentType") continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          form.append(key, String(item));
        }
      } else {
        form.append(key, String(value));
      }
    }
    return form;
  }
  if (bodyType === "raw") {
    return typeof body === "string" ? body : JSON.stringify(body);
  }
  throw new Error(`Unsupported bodyType: ${bodyType}`);
}

function contentTypeFor(bodyType) {
  if (bodyType === "formUrlEncoded") return "application/x-www-form-urlencoded";
  if (bodyType === "json") return "application/json";
  return undefined;
}

function applyAuth(headers, endpoint, profile, cache, dryRun) {
  if (!endpoint.auth) return;
  const token = cache.token;
  if (!token && !dryRun) {
    throw new Error(`Endpoint ${endpoint.id} requires login token. Run login flow first.`);
  }
  if (!token) return;
  const auth = profile.auth || {};
  const headerName = auth.header || "Authorization";
  headers[headerName] = auth.scheme === "bearer" ? `Bearer ${token}` : token;
}

function buildRequest(endpoint, options) {
  const context = options.context;
  const schemaValues = materializeEndpointSchema(endpoint, context, {
    body: options.body || {},
    query: options.query || {}
  }, { dryRun: options.dryRun });
  const schemaContext = {
    ...context,
    args: mergeObjects(schemaValues.path, context.args)
  };
  const endpointHeaders = interpolate(endpoint.headers || {}, context);
  const stepHeaders = interpolate(options.headers || {}, context);
  const cliHeaders = options.cliHeaders || {};
  const bodyType = options.bodyType || endpoint.bodyType || "json";
  const method = String(options.method || endpoint.method || "GET").toUpperCase();

  const renderedEndpointBody = pruneUndefined(interpolate(endpoint.body || {}, context));
  const renderedBodyOverride = pruneUndefined(interpolate(options.body || {}, context));
  const renderedEndpointQuery = pruneUndefined(interpolate(endpoint.query || {}, context));
  const renderedQueryOverride = pruneUndefined(interpolate(options.query || {}, context));

  const body = pruneUndefined(mergeObjects(schemaValues.body, renderedEndpointBody, renderedBodyOverride));
  const query = pruneUndefined(mergeObjects(schemaValues.query, renderedEndpointQuery, renderedQueryOverride));

  const headers = pruneUndefined(
    mergeObjects(
      { Accept: "application/json" },
      interpolate(options.profile.headers || {}, context),
      endpointHeaders,
      stepHeaders,
      cliHeaders
    ),
    { dropEmptyStrings: true }
  );

  const contentType = contentTypeFor(bodyType);
  if (contentType && method !== "GET" && method !== "DELETE") {
    headers["Content-Type"] = contentType;
  }
  if (bodyType === "multipart") {
    delete headers["Content-Type"];
  }
  applyAuth(headers, endpoint, options.profile, options.cache || {}, options.dryRun);

  const baseUrl = resolveBaseUrl(options.profile, endpoint, options.baseUrl);
  const endpointPath = renderPath(endpoint.path, schemaContext, options.dryRun);
  const url = new URL(joinUrl(baseUrl, endpointPath));
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  return {
    endpoint: endpoint.id,
    method,
    url: url.toString(),
    headers,
    bodyType,
    body,
    encodedBody: method === "GET" ? undefined : encodeBody(bodyType, body, { dryRun: options.dryRun })
  };
}

function encodeCurlBody(request) {
  const safeBody = redact(request.body || {});
  if (request.bodyType === "formUrlEncoded") {
    return new URLSearchParams(safeBody).toString();
  }
  if (request.bodyType === "json") {
    return JSON.stringify(safeBody);
  }
  if (typeof safeBody === "string") {
    return safeBody;
  }
  return JSON.stringify(safeBody);
}

function addMultipartCurlParts(parts, request) {
  const safeBody = redact(request.body || {});
  for (const [key, value] of Object.entries(safeBody)) {
    if (value === undefined || value === null) continue;
    if (key === "file" || key === "filePath") {
      parts.push("-F", JSON.stringify(`file=@${value}`));
      continue;
    }
    if (key === "filename" || key === "contentType") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push("-F", JSON.stringify(`${key}=${item}`));
      }
    } else {
      parts.push("-F", JSON.stringify(`${key}=${value}`));
    }
  }
}

function toCurl(request) {
  const parts = ["curl", "-X", request.method, JSON.stringify(request.url)];
  for (const [key, value] of Object.entries(redact(request.headers))) {
    parts.push("-H", JSON.stringify(`${key}: ${value}`));
  }
  if (request.bodyType === "multipart") {
    addMultipartCurlParts(parts, request);
    return parts.join(" ");
  }
  if (request.encodedBody !== undefined) {
    parts.push("--data", JSON.stringify(encodeCurlBody(request)));
  }
  return parts.join(" ");
}

module.exports = {
  buildRequest,
  toCurl,
  mergeObjects,
  resolveBaseUrl
};
