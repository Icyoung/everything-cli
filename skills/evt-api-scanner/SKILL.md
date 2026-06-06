---
name: evt-api-scanner
description: Use when an agent needs to discover API source locations, generate evt-cli scanner config, scan a codebase for HTTP endpoints, sync YAML API definitions, or check endpoint coverage for evt-cli projects.
---

# evt-api-scanner

Use this skill when working with an evt-cli project and you need to discover,
scan, sync, or audit YAML API definitions.

## Workflow

1. Locate the project root and evt config root.
   - Prefer the user's explicit `--config-root`.
   - Otherwise use `EVT_CLI_ROOT`.
   - Otherwise use `./cli` from the project root.
2. Discover source locations and write scanner config:

```bash
node skills/evt-api-scanner/scripts/discover.js --root . --config-root ./cli
```

3. Generate or update endpoint YAML:

```bash
evt api sync --config-root ./cli
```

4. Check YAML coverage:

```bash
evt api coverage --config-root ./cli
```

## Endpoint Format

Endpoint definitions are always persisted as YAML under `data/apis/*.yaml` or
legacy `apis/*.yaml`. JSON is only used as a machine-readable intermediate
between scanner scripts and evt-cli.

Example YAML:

```yaml
namespace: auth

endpoints:
  login:
    method: "POST"
    path: "/api/login"
    auth: false
    schema: {}
    response: {}
```

## Fallback

evt-cli should prefer this skill scanner when configured. If the skill scanner
fails or returns no endpoints, evt-cli falls back to the built-in regex scanner
targets. The fallback exists for users without an agent or skill-aware workflow,
but it is less complete.
