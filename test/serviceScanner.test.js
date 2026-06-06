const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { scanServices } = require("../src/config/serviceScanner");

function writeFile(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test("scans configurable kotlin, swift, js, and dart targets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "everything-scan-"));

  writeFile(root, "kotlin/ITradeService.kt", `
    class TradeService(val http: Http) {
      override suspend fun listTrades(): Resp<Unit> {
        return http.get("/api/trades")
      }

      suspend fun createTrade(code: String): Resp<Unit> {
        return http.postUrlEncoded<Unit, Unit, Unit>("/api/trades/$code", Unit)
      }
    }
  `);

  writeFile(root, "swift/AccountService.swift", `
    final class AccountService {
      func detail(id: String) async throws {
        try await client.get("/api/account/\\(id)")
      }
    }
  `);

  writeFile(root, "js/authApi.ts", `
    export async function login() {
      return axios.post("/api/login")
    }

    const logout = async (id) => {
      return fetch(\`/api/logout/\${id}\`, { method: "DELETE" })
    }
  `);

  writeFile(root, "dart/user_service.dart", `
    class UserService {
      Future<void> loadUser() async {
        return client.get('/api/user');
      }

      Future<void> updateUser(String id) async {
        return dio.post(Uri.parse('/api/user/$id'));
      }
    }
  `);

  const endpoints = scanServices({
    config: {
      root,
      targets: [
        { language: "kotlin", paths: ["kotlin"], namespaceStripPrefixes: ["I"], namespaceStripSuffixes: ["Service"] },
        { language: "swift", paths: ["swift"] },
        { language: "js", paths: ["js"] },
        { language: "dart", paths: ["dart"] }
      ]
    }
  });

  assert.deepEqual(
    endpoints.map((endpoint) => [endpoint.id, endpoint.method, endpoint.path, endpoint.bodyType]).sort(),
    [
      ["account.detail", "GET", "/api/account/:id", "json"],
      ["auth.login", "POST", "/api/login", "json"],
      ["auth.logout", "DELETE", "/api/logout/:id", "json"],
      ["trade.createTrade", "POST", "/api/trades/:code", "formUrlEncoded"],
      ["trade.listTrades", "GET", "/api/trades", "json"],
      ["user_service.loadUser", "GET", "/api/user", "json"],
      ["user_service.updateUser", "POST", "/api/user/:id", "json"]
    ]
  );
});

test("scans endpoints from an external skill command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "everything-skill-scan-"));
  writeFile(root, "scan.js", `
    process.stdout.write(JSON.stringify({
      endpoints: [
        {
          id: "wallet.balance",
          namespace: "wallet",
          functionName: "balance",
          method: "GET",
          path: "/api/wallet/balance",
          auth: true
        }
      ]
    }))
  `);

  const endpoints = scanServices({
    config: {
      root,
      targets: [
        {
          language: "skill",
          name: "fixture-scanner",
          command: process.execPath,
          args: ["scan.js"]
        }
      ]
    }
  });

  assert.deepEqual(endpoints, [
    {
      id: "wallet.balance",
      namespace: "wallet",
      functionName: "balance",
      method: "GET",
      path: "/api/wallet/balance",
      bodyType: "json",
      service: undefined,
      helper: "fixture-scanner",
      auth: true,
      dangerous: undefined,
      file: undefined,
      source: "fixture-scanner"
    }
  ]);
});

test("uses bundled skill scanner target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evt-bundled-skill-scan-"));
  writeFile(root, "src/AuthService.kt", `
    class AuthService(val http: Http) {
      suspend fun login(): Resp<Unit> {
        return http.post("/api/login")
      }
    }
  `);

  const endpoints = scanServices({
    config: {
      root,
      targets: [
        {
          language: "skill",
          name: "evt-api-scanner",
          skill: "evt-api-scanner"
        }
      ]
    }
  });

  assert.deepEqual(endpoints.map((endpoint) => [endpoint.id, endpoint.method, endpoint.path]), [
    ["auth.login", "POST", "/api/login"]
  ]);
});

test("falls back to regex targets when skill scanner fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evt-skill-fallback-"));
  writeFile(root, "src/ITradeService.kt", `
    class TradeService(val http: Http) {
      suspend fun listTrades(): Resp<Unit> {
        return http.get("/api/trades")
      }
    }
  `);

  const endpoints = scanServices({
    config: {
      root,
      targets: [
        {
          language: "skill",
          name: "broken-scanner",
          command: process.execPath,
          args: ["missing-scanner.js"]
        },
        {
          language: "kotlin",
          paths: ["src"],
          namespaceStripPrefixes: ["I"],
          namespaceStripSuffixes: ["Service"]
        }
      ]
    }
  });

  assert.deepEqual(endpoints.map((endpoint) => [endpoint.id, endpoint.method, endpoint.path]), [
    ["trade.listTrades", "GET", "/api/trades"]
  ]);
});
