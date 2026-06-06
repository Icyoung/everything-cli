const { buildRequest, toCurl } = require("./requestBuilder");

async function executeEndpoint(endpoint, options) {
  if (endpoint.dangerous && !options.dryRun && !options.unsafe) {
    throw new Error(`Endpoint ${endpoint.id} is dangerous. Re-run with --unsafe to execute it.`);
  }
  const request = buildRequest(endpoint, options);
  if (options.dryRun) {
    return {
      dryRun: true,
      request,
      curl: toCurl(request)
    };
  }

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.encodedBody
  });

  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_) {
    // Keep raw text for non-JSON responses.
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  }
  if (parsed && typeof parsed === "object" && "code" in parsed && parsed.code !== 0) {
    throw new Error(`API ${parsed.code}: ${parsed.msg || "Business error"}`);
  }

  return {
    status: response.status,
    response: parsed,
    data: parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed
  };
}

module.exports = {
  executeEndpoint
};
