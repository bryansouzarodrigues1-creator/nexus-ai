import assert from "node:assert/strict";
import {
  shouldContinueImageContext,
  wantsFreshImage,
} from "./image-context.js";

assert.equal(wantsFreshImage("faz outra imagem do zero"), true);
assert.equal(wantsFreshImage("deixe essa imagem mais realista"), false);

assert.equal(
  shouldContinueImageContext("troque só a cor da camisa", true),
  true
);
assert.equal(
  shouldContinueImageContext("deixe o cabelo cacheado", true),
  true
);
assert.equal(
  shouldContinueImageContext("mais realista", true),
  true
);
assert.equal(
  shouldContinueImageContext("gere uma imagem de um cavalo na praia", true),
  false
);
assert.equal(
  shouldContinueImageContext("crie uma nova foto de uma cidade", true),
  false
);
assert.equal(
  shouldContinueImageContext("use essa imagem e remova o fundo", true),
  true
);
assert.equal(
  shouldContinueImageContext("qualquer coisa", false),
  false
);

console.log("image-context tests passed");
