function prepareLines(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw, number) => ({
      number: number + 1,
      indent: raw.match(/^ */)[0].length,
      text: raw.trimEnd()
    }))
    .filter((line) => {
      const trimmed = line.text.trim();
      return trimmed !== "" && !trimmed.startsWith("#");
    });
}

function splitKeyValue(text) {
  const index = text.indexOf(":");
  if (index < 0) {
    return null;
  }
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") return "";
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "{}") return {};
  if (value === "[]") return [];
  if (value === "\"\"") return "";
  if (value === "''") return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    const body = value.slice(1, -1);
    return value.startsWith("\"") ? body.replace(/\\"/g, "\"") : body.replace(/''/g, "'");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseBlock(lines, startIndex, indent) {
  let index = startIndex;
  while (index < lines.length && lines[index].indent < indent) {
    index += 1;
  }
  if (index >= lines.length) {
    return { value: {}, index };
  }
  const line = lines[index];
  if (line.indent !== indent) {
    throw new Error(`Invalid YAML indentation at line ${line.number}`);
  }
  return line.text.trimStart().startsWith("- ")
    ? parseSequence(lines, index, indent)
    : parseMapping(lines, index, indent);
}

function parseMapping(lines, startIndex, indent) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.number}`);
    }

    const text = line.text.trim();
    if (text.startsWith("- ")) break;

    const pair = splitKeyValue(text);
    if (!pair) {
      throw new Error(`Expected key: value at line ${line.number}`);
    }

    const [key, rawValue] = pair;
    index += 1;
    if (rawValue === "") {
      if (index < lines.length && lines[index].indent > indent) {
        const child = parseBlock(lines, index, lines[index].indent);
        result[key] = child.value;
        index = child.index;
      } else {
        result[key] = {};
      }
    } else {
      result[key] = parseScalar(rawValue);
    }
  }

  return { value: result, index };
}

function parseSequence(lines, startIndex, indent) {
  const result = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`Unexpected indentation at line ${line.number}`);
    }

    const text = line.text.trim();
    if (!text.startsWith("- ")) break;
    const itemText = text.slice(2).trim();
    index += 1;

    if (itemText === "") {
      const child = parseBlock(lines, index, lines[index].indent);
      result.push(child.value);
      index = child.index;
      continue;
    }

    const pair = splitKeyValue(itemText);
    if (!pair) {
      result.push(parseScalar(itemText));
      continue;
    }

    const item = {};
    const [key, rawValue] = pair;
    if (rawValue === "") {
      if (index < lines.length && lines[index].indent > indent) {
        const child = parseBlock(lines, index, lines[index].indent);
        item[key] = child.value;
        index = child.index;
      } else {
        item[key] = {};
      }
    } else {
      item[key] = parseScalar(rawValue);
    }

    if (index < lines.length && lines[index].indent > indent) {
      const child = parseMapping(lines, index, lines[index].indent);
      Object.assign(item, child.value);
      index = child.index;
    }

    result.push(item);
  }

  return { value: result, index };
}

function parseYaml(text) {
  const lines = prepareLines(text);
  if (lines.length === 0) return {};
  return parseBlock(lines, 0, lines[0].indent).value;
}

module.exports = {
  parseYaml
};
