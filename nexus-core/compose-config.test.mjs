import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const file = new URL("./compose.yaml", import.meta.url);
const compose = readFileSync(file, "utf8");
const envExample = readFileSync(new URL("./.env.example", import.meta.url), "utf8");

test("experimental deployment remains opt-in and local-only", () => {
  assert.match(compose, /profiles:\s*\["inference"\]/);
  assert.match(compose, /127\.0\.0\.1:/);
  assert.doesNotMatch(compose, /^\s+-\s*"0\.0\.0\.0:\d+:8080"\s*$/m);
  assert.match(compose, /--hf-repo/);
  assert.match(compose, /Qwen\/Qwen3-0\.6B-GGUF:Q8_0/);
});

test("API key is required and never committed with a valid value", () => {
  assert.match(compose, /\$\{NEXUS_CORE_API_KEY:\?/);
  assert.match(envExample, /REPLACE_WITH/);
  assert(!/sk-proj-[a-zA-Z0-9]/.test(envExample));
});
