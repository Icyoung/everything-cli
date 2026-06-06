function parseDuration(value) {
  if (typeof value === "number") {
    return value;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] || "ms";
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60 * 1000;
  throw new Error(`Invalid duration unit: ${unit}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  parseDuration,
  sleep
};
