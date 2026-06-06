# evt-cli

English | [简体中文](./README.zh-CN.md)

evt-cli is a general-purpose HTTP CLI for running YAML-defined APIs and workflows. It uses YAML for endpoint and flow definitions, and JSON profiles for base URLs, headers, tokens, fixtures, and cache configuration. After installation, use the `evt` command.

## Principles

- Runtime endpoints come only from `apis/*.yaml`.
- Flows come only from `flows/*.yaml`.
- Environments, base URLs, headers, and test fixtures come only from `profiles/*.json`.
- Endpoint definitions are persisted as YAML. Scanner JSON is only an internal machine-readable handoff.
- The bundled skill scanner is preferred for discovery and YAML generation. The built-in regex scanner remains as a fallback for users without an agent or skill workflow.
- The default data directory is bundled with the CLI package. You can also point to your own project data directory with `--config-root` or `EVT_CLI_ROOT`.

## Quick Start

Install:

```bash
npm install -g @icyouo/evt-cli
```

Run the bundled example data:

```bash
evt profile list
evt api list
evt validate
evt api call todo.list --profile local --dry-run
```

During local development, run the entry file directly:

```bash
node bin/evt.js profile list
node bin/evt.js api list
node bin/evt.js validate
node bin/evt.js api call todo.list --profile local --dry-run
```

Use your own project data directory:

```bash
evt validate --config-root /path/to/project/cli
evt api list --config-root /path/to/project/cli
evt flow run login --config-root /path/to/project/cli --profile dev
```

Or set an environment variable:

```bash
export EVT_CLI_ROOT=/path/to/project/cli
evt validate
```

## Data Layout

Recommended project data layout:

```text
cli/
  data/
    apis/
      *.yaml
      *.example.yaml
    flows/
      *.yaml
      *.example.yaml
    profiles/
      *.json
      *.example.json
    scanner.json
    scanner.example.json
```

evt-cli ships with `data/**/*.example.*` for validation and reference. Real projects can maintain `data/apis/*.yaml`, `data/flows/*.yaml`, `data/profiles/*.json`, and `data/scanner.json`.

For compatibility with existing projects, evt also reads `apis/`, `flows/`, `profiles/`, and `scanner.config.json` directly under `--config-root` when those paths exist.

## Local Check And Package

```bash
npm run ci:local
```

The npm package includes source code, scripts, tests, data examples, and skills
so users can run local checks and build the standalone local binary package.

This runs:

- `npm test`
- `npm run check`
- `node bin/evt.js validate`
- `npm run coverage:api`
- `node scripts/build-package.js`

Local package artifacts:

- `dist/evt-cli/`
- `dist/evt-cli-<version>-<platform>-<arch>.tar.gz`

The local package directory contains only:

- `evt`
- `data/`
- `skills/`
- `README.md`
- `README.zh-CN.md`

It does not include `src/`, `scripts/`, `test/`, or `package.json`.

## API Definitions

Inspect an endpoint:

```bash
evt api show auth.login
```

Example API YAML:

```yaml
namespace: todo

endpoints:
  list:
    method: "GET"
    path: "/api/todos"
    auth: true
    schema:
      query:
        page:
          type: "integer"
          default: 1
    response:
      envelope: "Resp"
      data:
        type: "object"
        model: "TodoList"
```

Each endpoint should include:

- `method`
- `path`
- `auth`
- `bodyType`
- `service`
- `schema`
- `response`
- `dangerous: true` when the endpoint is destructive or sensitive

## Skill Scan, Sync, And Coverage

evt-cli includes `skills/evt-api-scanner/SKILL.md`. Agents can use this skill to
discover source directories, write scanner config, generate YAML endpoint
definitions, and audit coverage.

Endpoint definitions are written to YAML under `data/apis/*.yaml`. The scanner
may use JSON internally, but JSON is not the endpoint definition format.

Discover API source paths and write `data/scanner.json`:

```bash
evt api discover --config-root ./cli
```

Generate or update YAML endpoint definitions:

```bash
evt api sync --config-root ./cli
```

Check YAML coverage:

```bash
evt api coverage --config-root ./cli
```

The built-in regex scanner is still available as a fallback. It is less complete
than the skill-guided workflow, but it works without an agent.

Scan source code for candidate endpoints:

```bash
evt api scan --scan-config ./scanner.config.json
```

Check endpoint coverage:

```bash
npm run coverage:api -- --config-root /path/to/project/cli
```

Generate missing YAML skeletons:

```bash
npm run sync:api -- --config-root /path/to/project/cli
```

The scanner supports `kotlin`, `swift`, `js`, and `dart`. It also supports the
bundled skill scanner and external command scanners:

```json
{
  "root": ".",
  "targets": [
    {
      "language": "kotlin",
      "paths": ["shared/src/commonMain/kotlin"],
      "include": ["**/*Service.kt"]
    },
    {
      "language": "skill",
      "name": "evt-api-scanner",
      "skill": "evt-api-scanner"
    }
  ]
}
```

An external scanner can output a JSON array or `{ "endpoints": [] }` as an
internal scan result. `evt api sync` converts that scan result into YAML. Each
intermediate endpoint should include at least:

```json
{
  "id": "auth.login",
  "namespace": "auth",
  "functionName": "login",
  "method": "POST",
  "path": "/api/login"
}
```

This JSON is used only for scanning, coverage, and sync. Runtime execution still reads YAML.

## Common Commands

```bash
evt profile list
evt api list
evt api discover --config-root ./cli
evt api sync --config-root ./cli
evt api coverage --config-root ./cli
evt api call todo.list --dry-run
evt flow run login --profile local
evt cache show
evt cache clear
evt api test-all --profile local
```
