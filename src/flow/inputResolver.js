const readline = require("node:readline");

function envNameFor(key, input) {
  return input.env || `NEPTUNE_${key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
}

function promptValue(key, input) {
  const label = input.prompt || key;
  const suffix = input.default !== undefined && input.default !== "" ? ` (${input.default})` : "";
  const question = `${label}${suffix}: `;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    if (input.type === "password") {
      rl.stdoutMuted = true;
      rl._writeToOutput = function writeToOutput(stringToWrite) {
        if (!rl.stdoutMuted) {
          rl.output.write(stringToWrite);
        }
      };
    }

    rl.question(question, (answer) => {
      rl.close();
      if (input.type === "password") {
        process.stdout.write("\n");
      }
      resolve(answer === "" && input.default !== undefined ? input.default : answer);
    });
  });
}

async function resolveInputs(flow, options) {
  const definitions = flow.inputs || {};
  const result = {};

  for (const [key, input] of Object.entries(definitions)) {
    const envName = envNameFor(key, input);
    let value;
    if (Object.prototype.hasOwnProperty.call(options.set || {}, key)) {
      value = options.set[key];
    } else if (process.env[envName] !== undefined) {
      value = process.env[envName];
    } else if (options.cache && options.cache.inputs && options.cache.inputs[key] !== undefined) {
      value = options.cache.inputs[key];
    } else if (options.profile && options.profile.inputs && options.profile.inputs[key] !== undefined) {
      value = options.profile.inputs[key];
    } else if (!options.noInteractive && process.stdin.isTTY) {
      value = await promptValue(key, input);
    } else if (input.default !== undefined) {
      value = input.default;
    }

    if (input.required && (value === undefined || value === null || value === "")) {
      throw new Error(`Missing required flow input: ${key}`);
    }
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

module.exports = {
  resolveInputs
};
