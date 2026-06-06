# everything-cli

everything-cli 是一个通用内部 HTTP CLI，用 YAML 定义接口、用 YAML 定义 flow、用 profile 管理 base URL/header/token/cache。它适合把客户端接口整理成可执行、可测试、可打包的本地工具。

## 核心原则

- 运行时端点只来自 `apis/*.yaml`。
- flow 只来自 `flows/*.yaml`。
- 环境、base URL、headers、测试 fixtures 只来自 `profiles/*.json`。
- 扫描器只用于覆盖率对比和生成缺失 YAML 骨架，不是运行时数据源。
- 默认数据目录是当前 CLI 包内目录；也可以通过 `--config-root` 或 `EVERYTHING_CLI_ROOT` 指向项目自己的数据目录。

## 快速开始

仓库内直接运行 example 数据：

```bash
node bin/everything-cli.js profile list
node bin/everything-cli.js api list
node bin/everything-cli.js validate
node bin/everything-cli.js api call todo.list --profile local --dry-run
```

使用项目自己的数据目录：

```bash
node bin/everything-cli.js validate --config-root /path/to/project/cli
node bin/everything-cli.js api list --config-root /path/to/project/cli
node bin/everything-cli.js flow run login --config-root /path/to/project/cli --profile dev
```

也可以设置环境变量：

```bash
export EVERYTHING_CLI_ROOT=/path/to/project/cli
everything-cli validate
```

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

everything-cli 自带 `data/**/*.example.*`，用于开箱验证和复制参考。真实项目可以维护 `data/apis/*.yaml`、`data/flows/*.yaml`、`data/profiles/*.json` 和 `data/scanner.json`。

为了兼容已有项目，`--config-root` 下直接存在 `apis/`、`flows/`、`profiles/`、`scanner.config.json` 时也会被读取。

## 本地校验和打包

```bash
npm run ci:local
```

执行内容：

- `npm test`
- `npm run check`
- `node bin/everything-cli.js validate`
- `npm run coverage:api`
- `node scripts/build-package.js`

产物：

- `dist/everything-cli/`
- `dist/everything-cli-<version>-<platform>-<arch>.tar.gz`

打包目录只包含：

- `everything-cli`
- `data/`
- `README.md`

不会包含 `src/`、`scripts/`、`test/`、`package.json`。

## 接口定义

查看接口：

```bash
everything-cli api show auth.login
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

## 扫描和覆盖率

扫描源码候选 endpoint：

```bash
everything-cli api scan --scan-config ./scanner.config.json
```

覆盖率检查：

```bash
npm run coverage:api -- --config-root /path/to/project/cli
```

同步缺失 YAML 骨架：

```bash
npm run sync:api -- --config-root /path/to/project/cli
```

扫描器支持 `kotlin`、`swift`、`js`、`dart`，也支持外部 skill/AST 扫描命令：

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
      "name": "ast-scanner",
      "command": "node",
      "args": ["tools/scan-endpoints.js"]
    }
  ]
}
```

外部 scanner 输出 JSON 数组，或 `{ "endpoints": [] }`。每个 endpoint 至少包含：

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

## 常用命令

```bash
everything-cli profile list
everything-cli api list
everything-cli api call todo.list --dry-run
everything-cli flow run login --profile local
everything-cli cache show
everything-cli cache clear
everything-cli api test-all --profile local
```
