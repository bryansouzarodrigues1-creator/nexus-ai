import test from "node:test";
import assert from "node:assert/strict";
import { CoreClientError, normalizeCoreEndpoint, queryNexusCore } from "./core-client.mjs";

const secret = "test-only-long-opaque-key-0123456789";
const config = { baseUrl: "http://127.0.0.1:18080", apiKey: secret, model: "nexus-core-0.1" };
const sample = [{ role: "user", content: "Responda em português." }];

test("local endpoint and hosted HTTPS are accepted", () => {
  assert.equal(normalizeCoreEndpoint("http://localhost:8080/v1"), "http://localhost:8080/v1/chat/completions");
  assert.equal(normalizeCoreEndpoint("https://core.example.com"), "https://core.example.com/v1/chat/completions");
});

test("remote HTTP, embedded secrets and arbitrary paths are rejected", () => {
  for (const value of ["http://core.example.com", "https://user:password@core.example.com",
    "https://core.example.com/evil", "https://core.example.com?key=x", "file:///etc/passwd"]) {
    assert.throws(() => normalizeCoreEndpoint(value), CoreClientError);
  }
});

test("request uses own endpoint and bearer key only on the server", async () => {
  let seen;
  const result = await queryNexusCore(config, sample, {
    fetcher: async (url, options) => {
      seen = { url, options };
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          model: "nexus-core-0.1", usage: { completion_tokens: 4 },
          choices: [{ message: { content: "  Tudo certo.  " }, finish_reason: "stop" }],
        }),
      };
    },
  });
  assert.equal(seen.url, "http://127.0.0.1:18080/v1/chat/completions");
  assert.equal(seen.options.headers.Authorization, "Bearer " + secret);
  assert.equal(seen.options.redirect, "error");
  assert.equal(JSON.parse(seen.options.body).messages[0].content, sample[0].content);
  assert.equal(result.answer, "Tudo certo.");
  assert.equal(result.provider, "nexus-core-self-hosted");
});

test("invalid inputs fail without contacting upstream", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw Error("unexpected"); };
  await assert.rejects(queryNexusCore({ ...config, apiKey: "short" }, sample, { fetcher }), CoreClientError);
  await assert.rejects(queryNexusCore(config, [{ role: "tool", content: "x" }], { fetcher }), CoreClientError);
  assert.equal(calls, 0);
});

test("provider failures expose no credentials or upstream body", async () => {
  await assert.rejects(
    queryNexusCore(config, sample, { fetcher: async () => ({
      ok: false, status: 503, text: async () => secret,
    }) }),
    error => error.code === "UPSTREAM_ERROR" && !error.message.includes(secret)
  );
});

test("malformed successful response fails closed", async () => {
  await assert.rejects(
    queryNexusCore(config, sample, { fetcher: async () => ({ ok: true, text: async () => "<html>" }) }),
    error => error.code === "INVALID_RESPONSE"
  );
});

test("timeout never leaks the key", async () => {
  const error = await queryNexusCore(config, sample, {
    timeoutMs: 1000,
    fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error(secret)), { once: true });
    }),
  }).then(() => null, e => e);
  assert.equal(error.code, "TIMEOUT");
  assert(!error.message.includes(secret));
});
