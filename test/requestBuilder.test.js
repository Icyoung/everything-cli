const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRequest, toCurl } = require("../src/http/requestBuilder");
const { executeEndpoint } = require("../src/http/client");
const { redact } = require("../src/util/redact");

test("builds authenticated form-url-encoded requests", () => {
  const request = buildRequest({
    id: "trade.createOrder",
    service: "trade",
    method: "POST",
    path: "/api/trade/orders",
    auth: true,
    bodyType: "formUrlEncoded",
    body: {
      symbol: "{{args.symbol}}",
      orderSide: "{{args.orderSide}}",
      origQty: "{{args.origQty}}",
      positionSide: "{{args.positionSide}}",
      price: "{{args.price}}"
    }
  }, {
    profile: {
      baseUrls: { default: "https://api.example.com", trade: "https://f.example.com" },
      headers: { Platform: "IOS" },
      auth: { header: "Authorization", scheme: "raw" }
    },
    cache: { token: "token-value" },
    context: {
      args: {
        symbol: "btc_usdt",
        orderSide: "BUY",
        origQty: "1",
        positionSide: "LONG"
      },
      profile: {},
      cache: {},
      env: {},
      steps: {},
      inputs: {}
    }
  });

  assert.equal(request.url, "https://f.example.com/api/trade/orders");
  assert.equal(request.headers.Authorization, "token-value");
  assert.equal(request.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(request.encodedBody, "symbol=btc_usdt&orderSide=BUY&origQty=1&positionSide=LONG");
});

test("renders dynamic path parameters from args", () => {
  const request = buildRequest({
    id: "spot.cancelSpotOrder",
    method: "PATCH",
    path: "/api/spot/order/:code/cancel",
    auth: false
  }, {
    profile: { baseUrl: "https://api.example.com", headers: {} },
    cache: {},
    context: { args: { code: "abc/123" }, profile: {}, cache: {}, env: {}, steps: {}, inputs: {} }
  });

  assert.equal(request.url, "https://api.example.com/api/spot/order/abc%2F123/cancel");
});

test("materializes schema query and body values from args", () => {
  const request = buildRequest({
    id: "market.getKline",
    service: "market",
    method: "GET",
    path: "/api/market/kline",
    auth: false,
    schema: {
      query: {
        symbol: { type: "string", required: true },
        interval: { type: "string", default: "1m" },
        limit: { type: "integer", default: 100 }
      }
    }
  }, {
    profile: { baseUrls: { default: "https://api.example.com", market: "https://m.example.com" }, headers: {} },
    cache: {},
    context: { args: { symbol: "btc_usdt" }, profile: {}, cache: {}, env: {}, steps: {}, inputs: {} }
  });

  assert.equal(request.url, "https://m.example.com/api/market/kline?symbol=btc_usdt&interval=1m&limit=100");
});

test("validates required schema values", () => {
  assert.throws(
    () => buildRequest({
      id: "market.getSymbolDetail",
      service: "market",
      method: "GET",
      path: "/api/market/symbol/detail",
      auth: false,
      schema: {
        query: {
          symbol: { type: "string", required: true }
        }
      }
    }, {
      profile: { baseUrls: { default: "https://api.example.com", market: "https://m.example.com" }, headers: {} },
      cache: {},
      context: { args: {}, profile: {}, cache: {}, env: {}, steps: {}, inputs: {} }
    }),
    /Missing required parameter: symbol/
  );
});

test("builds multipart file upload requests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evt-cli-"));
  const filePath = path.join(dir, "avatar.png");
  fs.writeFileSync(filePath, "fake image");

  const request = buildRequest({
    id: "user.uploadImage",
    method: "POST",
    path: "/api/user/upload/image",
    auth: true,
    bodyType: "multipart"
  }, {
    profile: {
      baseUrl: "https://api.example.com",
      headers: { "Content-Type": "application/json" },
      auth: { header: "Authorization", scheme: "raw" }
    },
    cache: { token: "token-value" },
    body: { file: filePath, contentType: "image/png" },
    context: { args: {}, profile: {}, cache: {}, env: {}, steps: {}, inputs: {} }
  });

  assert.equal(request.headers.Authorization, "token-value");
  assert.equal(request.headers["Content-Type"], undefined);
  assert.equal(request.encodedBody.constructor.name, "FormData");
  assert.equal(request.encodedBody.get("file").name, "avatar.png");
  assert.match(toCurl(request), /-F "file=@.*avatar\.png"/);
});

test("does not require multipart files during dry-run", () => {
  const request = buildRequest({
    id: "user.uploadImage",
    method: "POST",
    path: "/api/user/upload/image",
    auth: false,
    bodyType: "multipart"
  }, {
    profile: { baseUrl: "https://api.example.com", headers: {} },
    cache: {},
    body: { file: "/path/that/does/not/exist.png", contentType: "image/png" },
    context: { args: {}, profile: {}, cache: {}, env: {}, steps: {}, inputs: {} },
    dryRun: true
  });

  assert.equal(request.encodedBody, undefined);
  assert.match(toCurl(request), /-F "file=@\/path\/that\/does\/not\/exist\.png"/);
});

test("redacts encoded bodies in dry-run output", () => {
  const safe = redact({
    body: {
      password: "secret"
    },
    encodedBody: "{\"password\":\"secret\"}"
  });

  assert.equal(safe.body.password, "***");
  assert.equal(safe.encodedBody, "***");
});

test("keeps response business code visible while redacting request verification code", () => {
  const safe = redact({
    response: {
      code: 0,
      data: {
        order: {
          code: 123
        }
      }
    },
    body: {
      code: "123456"
    }
  });

  assert.equal(safe.response.code, 0);
  assert.equal(safe.response.data.order.code, 123);
  assert.equal(safe.body.code, "***");
});

test("blocks dangerous endpoints without unsafe flag", async () => {
  await assert.rejects(
    executeEndpoint({
      id: "trade.createOrder",
      service: "trade",
      method: "POST",
      path: "/api/trade/orders",
      auth: false,
      dangerous: true,
      bodyType: "formUrlEncoded"
    }, {
      profile: {
        baseUrls: { default: "https://api.example.com", trade: "https://t.example.com" },
        headers: {}
      },
      cache: {},
      context: { args: {}, profile: {}, cache: {}, env: {}, steps: {}, inputs: {} },
      dryRun: false
    }),
    /dangerous/
  );
});
