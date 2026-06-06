#!/usr/bin/env node

const { run } = require("../src");

run(process.argv.slice(2)).catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
