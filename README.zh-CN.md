# evt-cli

简体中文 | [English](./README.md)

evt-cli 是一个通用 HTTP CLI，用 YAML 定义接口、用 YAML 定义 flow、用 profile 管理 base URL/header/token/cache。它适合把客户端接口整理成可执行、可测试、可打包的命令行工具。安装后使用 `evt` 命令。

## 核心原则

- 运行时端点只来自 `apis/*.yaml`。
- flow 只来自 `flows/*.yaml`。
- 环境、base URL、headers、测试 fixtures 只来自 `profiles/*.json`。
- endpoint 定义持久化格式始终是 YAML。scanner JSON 只作为内部机器中间结果。
- 内置 skills 优先用于项目 data 初始化。现有正则 scanner 只保留给没有 agent 或 skill workflow 的用户做 endpoint 扫描兜底。
- 默认数据目录是当前 CLI 包内目录；也可以通过 `--config-root` 或 `EVT_CLI_ROOT` 指向项目自己的数据目录。

## 快速开始

安装：

```bash
npm install -g @icyouo/evt-cli
```

安装后直接运行自带 example 数据：

```bash
evt profile list
evt profile set local
evt profile current
evt api list
evt validate
evt api call todo.list --dry-run
```

仓库内开发时也可以直接运行：

```bash
node bin/evt.js profile list
node bin/evt.js profile set local
node bin/evt.js api list
node bin/evt.js validate
node bin/evt.js api call todo.list --dry-run
```

使用项目自己的数据目录：

```bash
evt validate --config-root /path/to/project/cli
evt api list --config-root /path/to/project/cli
evt profile set dev --config-root /path/to/project/cli
evt flow run login --config-root /path/to/project/cli
```

也可以设置环境变量：

```bash
export EVT_CLI_ROOT=/path/to/project/cli
evt validate
```

`evt profile set <name>` 会把默认 profile 写到当前 config root 下的
`.evt/config.json`。需要 profile 的命令在未传 `--profile` 时会使用这个默认值。
临时传入 `--profile <name>` 仍然可以覆盖本次命令。

## 数据目录

项目数据目录结构：

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

evt-cli 自带 `data/**/*.example.*`，用于开箱验证和复制参考。真实项目可以维护 `data/apis/*.yaml`、`data/flows/*.yaml`、`data/profiles/*.json` 和 `data/scanner.json`。

为了兼容已有项目，`--config-root` 下直接存在 `apis/`、`flows/`、`profiles/`、`scanner.config.json` 时也会被读取。

## 用 Skills 初始化项目 Data

evt-cli 自带通用 example data 和内置 skills。支持 skill 的 agent 可以把一个空的项目 data 目录生成成可运行的项目 data：

1. 使用 `evt-profile-generator` 根据源码配置、文档、endpoint schema 和用户提供的测试账号生成 `data/profiles/<env>.json`。
2. 使用 `evt-api-scanner` 发现 API 源码路径，写入 `data/scanner.json`，并生成 `data/apis/*.yaml`。
3. 使用 `evt-flow-generator` 根据生成的 endpoint 和产品流程生成 `data/flows/login.yaml`、smoke flow 和 feature flow。
4. 执行 `evt validate --config-root ./cli`。
5. 先用 `--dry-run` 跑 flow，再在安全测试环境里跑真实请求。

profile 和 flow 生成是 AI-first 任务，因为 base URL、headers、登录态、测试账号、token 返回路径和 feature 调用顺序都依赖具体项目语义。evt-cli 只保留 endpoint 扫描的代码兜底。

## 本地校验和打包

```bash
npm run ci:local
```

npm 包会包含源码、脚本、测试、示例数据和 skills，用户可以自行运行本地校验并构建独立本地二进制包。

执行内容：

- `npm test`
- `npm run check`
- `node bin/evt.js validate`
- `npm run coverage:api`
- `node scripts/build-package.js`

产物：

- `dist/evt-cli/`
- `dist/evt-cli-<version>-<platform>-<arch>.tar.gz`

打包目录只包含：

- `evt`
- `data/`
- `skills/`
- `README.md`
- `README.zh-CN.md`

不会包含 `src/`、`scripts/`、`test/`、`package.json`。

## 接口定义

查看接口：

```bash
evt api show auth.login
```

接口 YAML 示例：

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

每个 endpoint 应包含：

- `method`
- `path`
- `auth`
- `bodyType`
- `service`
- `schema`
- `response`
- 必要时标记 `dangerous: true`

## Skills、扫描、同步和覆盖率

evt-cli 内置这些 skills：

- `skills/evt-profile-generator/SKILL.md`
- `skills/evt-api-scanner/SKILL.md`
- `skills/evt-flow-generator/SKILL.md`

agent 可以使用这些 skills 生成 profile JSON、发现源码目录、写入 scanner 配置、
生成 YAML endpoint 定义、生成 flow YAML，并做覆盖率审计。

endpoint 定义会写到 `data/apis/*.yaml`。scanner 可以在内部使用 JSON，但 JSON
不是 endpoint 的最终定义格式。

发现 API 源码路径并写入 `data/scanner.json`：

```bash
evt api discover --config-root ./cli
```

生成或更新 YAML endpoint 定义：

```bash
evt api sync --config-root ./cli
```

检查 YAML 质量门禁：

```bash
evt api audit --config-root ./cli --strict
```

检查 YAML 覆盖率：

```bash
evt api coverage --config-root ./cli
```

内置正则 scanner 仍然保留为兜底方案。它不如 skill workflow 完整，但不依赖
agent，也能让没有 agent 的用户勉强使用。

扫描源码候选 endpoint：

```bash
evt api scan --scan-config ./scanner.config.json
```

覆盖率检查：

```bash
npm run coverage:api -- --config-root /path/to/project/cli
```

同步缺失 YAML 骨架：

```bash
npm run sync:api -- --config-root /path/to/project/cli
```

扫描器支持 `kotlin`、`swift`、`js`、`dart`，也支持内置 skill scanner 和外部命令 scanner：

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

外部 scanner 可以输出 JSON 数组，或 `{ "endpoints": [] }` 作为内部扫描结果。
`evt api sync` 会把这个扫描结果转换成 YAML。每个中间 endpoint 至少包含：

```json
{
  "id": "auth.login",
  "namespace": "auth",
  "functionName": "login",
  "method": "POST",
  "path": "/api/login"
}
```

这个 JSON 只参与扫描/覆盖率/sync，最终运行仍然读取 YAML。

## Flow 输入

flow inputs 支持交互式输入。`type: "password"` 的输入会在键入时显示为 `*`。

当一组输入里必须至少提供一个值时，可以使用 `inputGroups.anyOf`。例如登录 flow
可以支持邮箱验证码和 Google OTP 二选一：

```yaml
inputs:
  email:
    prompt: Email
    type: string
    required: true
  password:
    prompt: Password
    type: password
    required: true
  code:
    prompt: Email code
    type: string
    default: ""
  googleCode:
    prompt: Google OTP
    type: string
    default: ""

inputGroups:
  anyOf:
    - fields:
        - code
        - googleCode
      prompt: Enter either an email code or Google OTP.
      message: email code or Google OTP
```

## 常用命令

```bash
evt profile list
evt profile set local
evt profile current
evt api list
evt api discover --config-root ./cli
evt api sync --config-root ./cli
evt api audit --config-root ./cli --strict
evt api coverage --config-root ./cli
evt api call todo.list --dry-run
evt flow run login
evt cache show
evt cache clear
evt api test-all
```
