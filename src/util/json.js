function parseJsonObject(value, optionName) {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`${optionName} must be valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${optionName} must be a JSON object`);
  }
  return parsed;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

module.exports = {
  parseJsonObject,
  stableJson
};
