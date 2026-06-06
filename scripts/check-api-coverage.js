#!/usr/bin/env node

const { loadApiRegistry } = require("../src/config/loaders");
const { compareScanToRegistry, parseCliScanOptions, scanServices } = require("../src/config/serviceScanner");
const { setConfigRoot } = require("../src/util/paths");

function main() {
  const scanOptions = parseCliScanOptions(process.argv.slice(2));
  setConfigRoot(scanOptions.configRoot);
  const registry = loadApiRegistry();
  const scanned = scanServices(scanOptions);
  const comparison = compareScanToRegistry(scanned, registry);
  const missingSchema = Object.values(registry)
    .filter((endpoint) => !endpoint.schema)
    .map((endpoint) => endpoint.id);
  const missingResponse = Object.values(registry)
    .filter((endpoint) => !endpoint.response || Object.keys(endpoint.response).length === 0)
    .map((endpoint) => endpoint.id);

  const failed = comparison.missing.length > 0 || missingSchema.length > 0 || missingResponse.length > 0;
  const payload = {
    scanned: scanned.length,
    covered: comparison.covered.length,
    missing: comparison.missing.map((endpoint) => endpoint.id),
    endpoints: Object.keys(registry).length,
    missingSchema,
    missingResponse
  };

  console.log(JSON.stringify(payload, null, 2));
  if (failed) process.exit(1);
}

main();
