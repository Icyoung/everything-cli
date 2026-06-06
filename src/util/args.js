function parseKeyValue(value, optionName) {
  const index = value.indexOf("=");
  if (index <= 0) {
    throw new Error(`${optionName} expects key=value`);
  }
  return [value.slice(0, index), value.slice(index + 1)];
}

function camelOption(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs(tokens) {
  const options = {
    _: [],
    set: {},
    headers: {}
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    const name = camelOption(equals >= 0 ? raw.slice(0, equals) : raw);
    const inlineValue = equals >= 0 ? raw.slice(equals + 1) : undefined;
    const booleanOption = new Set([
      "dryRun",
      "json",
      "verbose",
      "curl",
      "noInteractive",
      "unsafe",
      "includeDangerous",
      "noLogin",
      "missing",
      "help"
    ]);

    let value;
    if (booleanOption.has(name)) {
      value = inlineValue === undefined ? true : inlineValue !== "false";
    } else if (inlineValue !== undefined) {
      value = inlineValue;
    } else {
      index += 1;
      if (index >= tokens.length) {
        throw new Error(`--${raw} expects a value`);
      }
      value = tokens[index];
    }

    if (name === "set") {
      const [key, parsedValue] = parseKeyValue(value, "--set");
      options.set[key] = parsedValue;
    } else if (name === "header") {
      const [key, parsedValue] = parseKeyValue(value, "--header");
      options.headers[key] = parsedValue;
    } else {
      options[name] = value;
    }
  }

  return options;
}

module.exports = {
  parseArgs,
  parseKeyValue
};
