---
name: evt-profile-generator
description: Use when an agent needs to create or update evt-cli profile JSON files from project source, environment config, API YAML schemas, documentation, or user-provided credentials so evt-cli can run real APIs and flows.
---

# evt-profile-generator

Use this skill to produce usable evt-cli profiles under `data/profiles/*.json`
or legacy `profiles/*.json`.

## Workflow

1. Locate the evt config root.
   - Prefer the user's explicit `--config-root`.
   - Otherwise use `EVT_CLI_ROOT`.
   - Otherwise use `./cli` from the project root.
2. Read existing profile examples:

```bash
evt profile list --config-root ./cli
```

3. Inspect project source, docs, and environment files for:
   - base URLs by environment
   - static headers, app version, device/platform headers, tenant headers
   - auth header name and token scheme
   - login inputs and test fixtures required by endpoint schemas
4. Inspect the project's HTTP runtime before writing headers:
   - environment config and app config
   - DI modules or client factories
   - header builders and interceptors
   - auth/session/cache code
   - platform/device providers
5. Write real profiles such as `data/profiles/dev.json`,
   `data/profiles/android.dev.json`, or `data/profiles/ios.dev.json`.
6. Validate:

```bash
evt validate --config-root ./cli
```

## Profile Format

Use valid JSON only. Do not add comments.

```json
{
  "name": "dev",
  "env": "dev",
  "platform": "ANDROID",
  "baseUrls": {
    "default": "https://api.dev.example.com"
  },
  "auth": {
    "header": "Authorization",
    "scheme": "bearer"
  },
  "headers": {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Platform": "{{profile.platform}}"
  },
  "device": {
    "fingerprintId": "dev-fingerprint"
  },
  "inputs": {
    "email": "user@example.com",
    "password": "Password123."
  },
  "fixtures": {
    "defaults": {
      "page": 1,
      "pageSize": 20
    }
  }
}
```

## Rules

- Keep bundled `*.example.json` generic; write project-specific data to
  non-example profile files.
- Do not invent production secrets. Use user-provided test credentials,
  documented test values, or safe placeholders.
- Prefer separate profiles when platforms have different headers, device
  fields, or base URLs.
- Use exact enum casing and header names from source. If source uses `ANDROID`,
  do not write `android`.
- Include backing fields for every templated header value, such as
  `{{profile.device.fingerprintId}}`.
- Only include headers sent by the same runtime client. Do not merge unrelated
  web, server, or third-party headers just because they appear elsewhere in the
  repository.
- Keep static app headers and device headers in the profile; keep dynamic
  per-request headers in endpoint YAML or flow steps.
- Put values needed by interactive flows in `inputs`.
- Put reusable endpoint test values in `fixtures.defaults` or grouped fixture
  objects named after the endpoint domain.
- Configure token injection with `auth.header` and `auth.scheme`; token values
  themselves belong in evt cache after login, not in the profile.
- If multiple API hosts exist, add named entries in `baseUrls` and set matching
  endpoint metadata only when the API YAML supports it.
- Make `baseUrls` names match endpoint `service` values exactly.
- If auth uses a raw token header, set `"scheme": "raw"`. If it uses an
  Authorization bearer token, set `"scheme": "bearer"`.
- Prefer values from source or docs over guesses. If a required runtime value is
  unknown, leave a realistic placeholder and make the related flow input
  interactive.

## Completion Check

After writing the profile, run:

```bash
evt validate --config-root ./cli
evt profile list --config-root ./cli
```

If endpoint YAML and flows already exist, also dry-run login with the generated
profile and compare the produced request headers with the source header builder.
Report placeholder credentials, uncertain headers, and base URLs that were not
found in source.
