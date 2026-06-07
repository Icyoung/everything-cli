const readline = require("node:readline");

function envNameFor(key, input) {
  return input.env || `NEPTUNE_${key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
}

function hasValue(value) {
  return !(value === undefined || value === null || value === "");
}

function promptPassword(question, input) {
  return new Promise((resolve, reject) => {
    let value = "";
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      const rl = readline.createInterface({
        input: stdin,
        output: stdout,
        terminal: true
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer === "" && input.default !== undefined ? input.default : answer);
      });
      return;
    }

    const wasRaw = stdin.isRaw;
    stdout.write(question);
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(Boolean(wasRaw));
      stdout.write("\n");
    };

    function onKeypress(sequence, key = {}) {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Input cancelled"));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value === "" && input.default !== undefined ? input.default : value);
        return;
      }
      if (key.name === "backspace" || key.name === "delete") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }
      if (key.ctrl || key.meta || !sequence || /[\r\n]/.test(sequence)) {
        return;
      }
      value += sequence;
      stdout.write("*");
    }

    stdin.on("keypress", onKeypress);
  });
}

function promptValue(key, input) {
  const label = input.prompt || key;
  const suffix = input.default !== undefined && input.default !== "" ? ` (${input.default})` : "";
  const question = `${label}${suffix}: `;

  if (input.type === "password") {
    return promptPassword(question, input);
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer === "" && input.default !== undefined ? input.default : answer);
    });
  });
}

function readConfiguredInput(key, input, options) {
  const envName = envNameFor(key, input);
  if (Object.prototype.hasOwnProperty.call(options.set || {}, key)) {
    return options.set[key];
  }
  if (process.env[envName] !== undefined) {
    return process.env[envName];
  }
  if (options.cache && options.cache.inputs && options.cache.inputs[key] !== undefined) {
    return options.cache.inputs[key];
  }
  if (options.profile && options.profile.inputs && options.profile.inputs[key] !== undefined) {
    return options.profile.inputs[key];
  }
  return undefined;
}

function anyOfGroups(flow) {
  const inputGroups = flow.inputGroups || {};
  const groups = inputGroups.anyOf || [];
  return Array.isArray(groups) ? groups : [];
}

function groupedKeys(flow) {
  const keys = new Set();
  for (const group of anyOfGroups(flow)) {
    for (const key of group.fields || []) keys.add(key);
  }
  return keys;
}

async function resolveAnyOfGroups(flow, options, result) {
  const definitions = flow.inputs || {};

  for (const group of anyOfGroups(flow)) {
    const fields = group.fields || [];
    if (fields.some((key) => hasValue(result[key]))) {
      continue;
    }

    let resolved = false;
    if (!options.noInteractive && process.stdin.isTTY) {
      if (group.prompt) {
        process.stdout.write(`${group.prompt}\n`);
      }
      for (const key of fields) {
        const input = definitions[key];
        if (!input) continue;
        const value = await promptValue(key, { ...input, default: undefined });
        if (hasValue(value)) {
          result[key] = value;
          resolved = true;
          break;
        }
      }
    }

    if (!resolved && !fields.some((key) => hasValue(result[key]))) {
      const label = group.message || `One of ${fields.join(", ")} is required`;
      throw new Error(`Missing required flow input group: ${label}`);
    }
  }
}

async function resolveInputs(flow, options) {
  const definitions = flow.inputs || {};
  const result = {};
  const anyOfKeys = groupedKeys(flow);

  for (const [key, input] of Object.entries(definitions)) {
    let value = readConfiguredInput(key, input, options);
    const deferInteractive = anyOfKeys.has(key) && !input.required;
    if (value === undefined && !deferInteractive && !options.noInteractive && process.stdin.isTTY) {
      value = await promptValue(key, input);
    } else if (value === undefined && input.default !== undefined) {
      value = input.default;
    }

    if (input.required && !hasValue(value)) {
      throw new Error(`Missing required flow input: ${key}`);
    }
    if (value !== undefined) {
      result[key] = value;
    }
  }

  await resolveAnyOfGroups(flow, options, result);

  return result;
}

module.exports = {
  hasValue,
  promptPassword,
  promptValue,
  resolveInputs
};
