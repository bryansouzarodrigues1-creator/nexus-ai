import assert from "node:assert/strict";
import { withDeadline } from "./chat-timeout.js";

assert.equal(await withDeadline(async () => "ok", 1000, "chat"), "ok");
const started = Date.now();
const controllerSignal = { value: null };
await assert.rejects(
  withDeadline((signal) => {
    controllerSignal.value = signal;
    return new Promise(() => {});
  }, 200, "modelo de teste"),
  /Tempo limite excedido em modelo de teste/
);
assert(controllerSignal.value?.aborted);
assert(Date.now() - started < 2000);
await assert.rejects(
  withDeadline(async () => { throw new Error("provider down"); }, 1000),
  /provider down/
);
console.log("chat deadline tests passed");
