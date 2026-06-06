const SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "token",
  "googlecode",
  "idtoken",
  "temptoken",
  "encodedbody"
]);

const REQUEST_CODE_PARENT_KEYS = new Set([
  "body",
  "inputs",
  "args",
  "set"
]);

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

function redact(value, parentKey = "") {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, parentKey));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      shouldRedactKey(key, parentKey) && item !== undefined && item !== null ? "***" : redact(item, key)
    ])
  );
}

function shouldRedactKey(key, parentKey) {
  const normalized = String(key).toLowerCase();
  if (isSensitiveKey(normalized)) {
    return true;
  }
  return normalized === "code" && REQUEST_CODE_PARENT_KEYS.has(String(parentKey).toLowerCase());
}

module.exports = {
  redact,
  isSensitiveKey,
  shouldRedactKey
};
