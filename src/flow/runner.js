const { executeEndpoint } = require("../http/client");
const { getPath, interpolate, pruneUndefined } = require("../template/interpolate");
const { parseDuration, sleep } = require("../util/duration");
const { resolveInputs } = require("./inputResolver");
const { writeCache } = require("../cache/sessionCache");

function isTruthyWhen(value) {
  return !(value === undefined || value === null || value === false || value === "" || value === "false");
}

function normalizeExpect(expect) {
  if (!expect) return [];
  return Array.isArray(expect) ? expect : [expect];
}

function assertExpectation(stepId, result, expectation) {
  const path = expectation.path;
  if (!path) {
    throw new Error(`Flow step ${stepId} has expect without path`);
  }
  const actual = getPath(result, path);
  if ("equals" in expectation && actual !== expectation.equals) {
    throw new Error(`Flow step ${stepId} expected ${path} to equal ${expectation.equals}, got ${actual}`);
  }
  if (expectation.exists && (actual === undefined || actual === null || actual === "")) {
    throw new Error(`Flow step ${stepId} expected ${path} to exist`);
  }
}

async function maybeWait(value, dryRun) {
  const ms = parseDuration(value);
  if (!dryRun) {
    await sleep(ms);
  }
  return ms;
}

async function runFlow(flow, options) {
  const inputs = await resolveInputs(flow, options);
  const steps = {};
  const timeline = [];
  const baseContext = {
    profile: options.profile,
    cache: options.cache || {},
    args: options.set || {},
    inputs,
    env: process.env,
    vars: {},
    steps
  };

  for (const step of flow.steps || []) {
    if (step.when !== undefined) {
      const shouldRun = interpolate(step.when, baseContext);
      if (!isTruthyWhen(shouldRun)) {
        timeline.push({ id: step.id, skipped: true });
        continue;
      }
    }

    if (step.wait !== undefined && !step.call) {
      const ms = await maybeWait(step.wait, options.dryRun);
      timeline.push({ wait: ms, dryRun: Boolean(options.dryRun) });
      continue;
    }

    if (!step.call) {
      throw new Error("Flow step must declare call or wait");
    }

    const endpoint = options.registry[step.call];
    if (!endpoint) {
      throw new Error(`Unknown endpoint in flow: ${step.call}`);
    }

    const result = await executeEndpoint(endpoint, {
      ...options,
      context: baseContext,
      cache: baseContext.cache,
      body: step.body || {},
      query: step.query || {},
      headers: step.headers || {}
    });

    const id = step.id || step.call;
    if (!options.dryRun) {
      for (const expectation of normalizeExpect(step.expect)) {
        assertExpectation(id, result, expectation);
      }
    }
    steps[id] = result;
    if (step.extract && !options.dryRun) {
      for (const [key, sourcePath] of Object.entries(step.extract)) {
        baseContext.vars[key] = getPath(result, sourcePath);
      }
    }
    if (step.cache && !options.dryRun) {
      Object.assign(baseContext.cache, pruneUndefined(interpolate(step.cache, baseContext)));
    }
    timeline.push({
      id,
      call: step.call,
      dryRun: Boolean(options.dryRun),
      status: result.status,
      request: result.request,
      extract: step.extract ? Object.keys(step.extract) : undefined
    });

    if (step.afterWait !== undefined) {
      const ms = await maybeWait(step.afterWait, options.dryRun);
      timeline.push({ id, afterWait: ms, dryRun: Boolean(options.dryRun) });
    }
  }

  let savedCache;
  if (flow.save && flow.save.cache && !options.dryRun) {
    const rendered = pruneUndefined(interpolate(flow.save.cache, baseContext));
    const saveContext = {
      cache: rendered,
      flow: {
        name: flow.name
      },
      steps
    };
    for (const requiredPath of flow.save.required || []) {
      const value = getPath(saveContext, requiredPath);
      if (value === undefined || value === null || value === "") {
        throw new Error(`Flow ${flow.name} did not produce required save value: ${requiredPath}`);
      }
    }
    savedCache = {
      ...(options.cache || {}),
      ...rendered,
      updatedAt: new Date().toISOString(),
      lastFlow: {
        name: flow.name,
        finishedAt: new Date().toISOString()
      }
    };
    writeCache(options.cachePath, savedCache);
  }

  return {
    flow: flow.name,
    inputs: Object.keys(inputs),
    vars: Object.keys(baseContext.vars),
    timeline,
    steps,
    savedCache: Boolean(savedCache)
  };
}

module.exports = {
  runFlow,
  isTruthyWhen
};
