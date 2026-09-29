import assert from "node:assert/strict";
import {
  extractExactRequestedText,
  inferNaturalAspectRatio,
} from "./image-task-core.js";

assert.deepEqual(
  extractExactRequestedText(
    'Crie um cartaz escrito "OFERTA DE HOJE" e abaixo “R$ 29,90”'
  ),
  ["OFERTA DE HOJE", "R$ 29,90"]
);

assert.deepEqual(
  extractExactRequestedText('Use "NEXUS" e repita "NEXUS"'),
  ["NEXUS"]
);

assert.equal(
  inferNaturalAspectRatio("arte para Story do Instagram"),
  "9:16"
);
assert.equal(
  inferNaturalAspectRatio("thumbnail para YouTube"),
  "16:9"
);
assert.equal(
  inferNaturalAspectRatio("post vertical para feed"),
  "4:5"
);
assert.equal(
  inferNaturalAspectRatio("foto de perfil quadrada"),
  "1:1"
);
assert.equal(
  inferNaturalAspectRatio("banner 2:3", "16:9"),
  "2:3"
);
assert.equal(
  inferNaturalAspectRatio("uma pintura a óleo", "1:1"),
  "1:1"
);

console.log("image-task-core tests passed");
