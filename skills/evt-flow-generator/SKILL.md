---
name: evt-flow-generator
description: Use when an agent needs to create or update evt-cli YAML flows from API YAML definitions, product workflows, authentication requirements, or test scenarios, including interactive inputs, waits, token cache saves, and feature smoke flows.
---

# evt-flow-generator

Use this skill to produce executable evt-cli flows under `data/flows/*.yaml` or
legacy `flows/*.yaml`.

## Workflow

1. Locate the evt config root.
   - Prefer the user's explicit `--config-root`.
   - Otherwise use `EVT_CLI_ROOT`.
   - Otherwise use `./cli` from the project root.
2. Inspect available endpoints:

```bash
evt api list --config-root ./cli
evt api show <namespace.endpoint> --config-root ./cli
```

3. Read existing flow examples and product docs/source to identify:
   - login or session refresh sequence
   - token field path in the login response
   - prerequisite calls for feature flows
   - required waits between calls
   - safe smoke-test values from profile fixtures
4. Read the evt runtime semantics before saving values:
   - each step result contains `response`, the full parsed response
   - each step result contains `data`, the unwrapped `response.data` when present
   - for wrapped APIs, prefer `steps.<id>.response.data.<field>` for cache saves
5. Write YAML flows such as:
   - `data/flows/login.yaml`
   - `data/flows/smoke.yaml`
   - `data/flows/<feature>.yaml`
6. Validate:

```bash
evt validate --config-root ./cli
```

## Flow Format

```yaml
name: login
description: Login and save session token.

inputs:
  email:
    prompt: Email
    type: string
    required: true
  password:
    prompt: Password
    type: password
    required: true

steps:
  - id: login
    call: auth.login
    body:
      email: "{{inputs.email}}"
      password: "{{inputs.password}}"
    expect:
      path: response.data.token
      exists: true

save:
  cache:
    token: "{{steps.login.response.data.token}}"
  required:
    - cache.token
```

Use waits when the backend needs spacing:

```yaml
steps:
  - id: createOrder
    call: trade.createOrder
    body:
      symbol: "{{inputs.symbol}}"
      side: "BUY"
  - wait: 2s
  - id: queryOrder
    call: trade.orderDetail
    query:
      orderId: "{{steps.createOrder.response.data.orderId}}"
```

Use `afterWait` when only one step needs a post-call interval.

## Rules

- Runtime flows are YAML. Do not persist flow definitions as JSON.
- Keep bundled `*.example.yaml` generic; write project-specific flows to
  non-example YAML files.
- Use `inputs` for values a user may need to type dynamically.
- Use `profile.inputs` by naming flow inputs the same way as profile keys.
- Use profile-backed values for device/session fields when source does so, for
  example `{{profile.device.fingerprintId}}` instead of a new placeholder input.
- Use `wait` or `afterWait` for backend intervals; valid values include `500ms`,
  `2s`, and `1m`.
- Preserve waits found in source, tests, docs, or existing flows.
- Save login state through `save.cache.token` and `save.required`. For wrapped
  responses, prefer `{{steps.login.response.data.token}}`.
- Reference previous step outputs with `{{steps.<id>.<path>}}`.
- Prefer `expect` checks for required response fields when a flow depends on
  them.
- Put logout last in flows that include logout.
- For feature flows, include prerequisite reads, state-changing calls, follow-up
  reads, waits, cleanup, and final assertions when the scenario needs them.
- Use endpoint schema and profile fixtures to build request bodies. Do not
  invent field names that are absent from endpoint YAML or source models.
- Do not include destructive business actions unless the project or user states
  that the environment is safe for testing.

## Completion Check

After writing flows, run:

```bash
evt validate --config-root ./cli
evt flow run login --config-root ./cli --profile <profile> --dry-run
```

For login flows, inspect the dry-run output and verify:

- the expected endpoint order is present
- required waits are present
- token save path matches the response model
- headers come from the selected profile
- no required input is missing

When real credentials and a safe test environment are available, run the login
flow without `--dry-run`, confirm the token is written to cache, then run the
authenticated smoke or feature flow. Report any step that was only inferred.
