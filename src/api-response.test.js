import assert from "node:assert/strict";
import { readApiJson } from "./api-response.js";

function response(body, type, status = 200) {
  return new Response(body, { status, headers: { "content-type": type } });
}
assert.deepEqual(await readApiJson(response('{"answer":"oi"}', "chat")), { answer: "oi" });
assert.deepEqual(await readApiJson(response('{"error":"Falhou"}', "application/json", 502)), { error: "Falhou" });
await assert.rejects(
  readApiJson(response("<!DOCTYPE html><html>falha</html>", "text/html", 404), "chat"),
  /página HTML.*HTTP|HTTP 404.*página HTML/
);
await assert.rejects(
  readApiJson(response('{"broken":', "application/json", 200), "chat"),
  /resposta.*inválida/
);
console.log("API response tests: OK");
