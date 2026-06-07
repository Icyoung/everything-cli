---
name: evt-api-scanner
description: Use when an agent needs to discover API source locations, generate evt-cli scanner config, scan a codebase for HTTP endpoints, sync YAML API definitions, check endpoint coverage, or bootstrap endpoint data for evt-cli projects.
---

# evt-api-scanner

Use this skill when working with an evt-cli project and you need to discover,
scan, sync, or audit YAML API definitions.

## Workflow

1. Locate the project root and evt config root.
   - Prefer the user's explicit `--config-root`.
   - Otherwise use `EVT_CLI_ROOT`.
   - Otherwise use `./cli` from the project root.
2. Read any existing non-example API YAML first. Preserve existing endpoint IDs,
   service names, auth flags, schema, response, and dangerous markers unless
   source evidence proves they are wrong.
3. Discover source locations and write scanner config:

```bash
node skills/evt-api-scanner/scripts/discover.js --root . --config-root ./cli
```

4. Generate or update endpoint YAML:

```bash
evt api sync --config-root ./cli
```

5. Enrich the generated YAML from source. Do not stop at scanner skeletons.
6. Audit YAML quality:

```bash
evt api audit --config-root ./cli --strict
```

If strict audit fails because of empty schemas, generic responses, unresolved
paths, or unmatched services, use the audit samples as the next edit queue and
continue enrichment.

7. Check YAML coverage:

```bash
evt api coverage --config-root ./cli
```

8. When bootstrapping an empty project, continue with:
   - `evt-profile-generator` to create `data/profiles/*.json`.
   - `evt-flow-generator` to create `data/flows/*.yaml`.

## Source Evidence

Collect these signals before finalizing YAML:

- HTTP service declarations for method, path, body type, and function names.
- Repository or client call sites for auth requirements, default arguments,
  endpoint aliases, and feature ownership.
- Request DTOs, method parameters, annotations, or typed request builders for
  `schema.path`, `schema.query`, and `schema.body`.
- Response DTOs, generic wrappers, serializers, or model declarations for
  `response.envelope`, `response.data.model`, `response.data.type`, and fields.
- App config, DI modules, HTTP clients, interceptors, or base URL providers for
  `service` names and absolute URL handling.
- Existing tests, docs, and product flows for dangerous operations and required
  ordering.

For Kotlin/KMP projects, inspect service interfaces, repositories, DTO/model
files, app config, DI modules, and header/interceptor builders. For Swift, JS,
and Dart projects, inspect equivalent API clients, request models, response
models, environment config, and auth/header middleware.

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
    schema:
      body:
        email:
          type: "string"
          required: true
    response:
      envelope: "Resp"
      data:
        type: "object"
        model: "LoginData"
        fields:
          token: "string"
          user:
            type: "object"
```

## Quality Rules

- Endpoint IDs should be stable. Preserve existing IDs. If no YAML exists, use
  source function names exactly and do not add, remove, or normalize prefixes
  such as `get` unless a project convention proves that mapping.
- Do not leave `schema: {}` when source parameters or request DTOs exist.
- Do not use generic `response.data.type: object` when a response type or DTO
  can be resolved.
- For wrapped responses such as `Resp<T>`, record the envelope and the nested
  data model.
- Preserve path parameters, query parameters embedded in path strings, and
  absolute URLs. Map alternate hosts to `service` when profiles can provide a
  named base URL.
- Infer `auth` from the HTTP client, repository call path, interceptor, or
  feature state. Public market/config endpoints are usually unauthenticated;
  user/account/order/history endpoints usually require auth. Mark uncertain
  cases in the final report.
- Mark mutating or irreversible endpoints with `dangerous: true`; examples are
  order creation/cancelation, withdrawal, transfer, account deletion, and
  credential changes.
- Keep scanner JSON internal. Runtime endpoint data remains YAML.

## Completion Check

Run these before final answer:

```bash
evt validate --config-root ./cli
evt api audit --config-root ./cli --strict
evt api coverage --config-root ./cli
```

Report endpoint count, empty-schema count, generic-response count, auth
uncertain count, and any endpoints whose ID or path could not be resolved
confidently.

## Fallback

evt-cli should prefer this skill scanner when configured. If the skill scanner
fails or returns no endpoints, evt-cli falls back to the built-in regex scanner
targets. The fallback exists for users without an agent or skill-aware workflow,
but it is less complete.
