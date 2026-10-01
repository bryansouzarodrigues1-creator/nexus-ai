import assert from "node:assert/strict";
import {
  shouldPrioritizeImageFidelity,
  shouldUseExpressImageEdit,
  shouldVerifyFastImageCandidate,
} from "./image-routing-policy.js";

assert.equal(
  shouldPrioritizeImageFidelity({
    hasSourceImage: true,
    taskMode: "strict_edit",
    preservationLevel: "maximum",
  }),
  true
);

assert.equal(
  shouldPrioritizeImageFidelity({
    hasSourceImage: true,
    taskMode: "enhance",
    preservationLevel: "maximum",
  }),
  true
);

assert.equal(
  shouldPrioritizeImageFidelity({
    hasSourceImage: true,
    taskMode: "background",
    preservationLevel: "high",
  }),
  true
);

assert.equal(
  shouldPrioritizeImageFidelity({
    hasSourceImage: false,
    taskMode: "poster",
    preservationLevel: "medium",
    requiresTextAccuracy: true,
  }),
  true
);

assert.equal(
  shouldPrioritizeImageFidelity({
    hasSourceImage: false,
    taskMode: "create",
    preservationLevel: "medium",
    requiresTextAccuracy: false,
  }),
  false
);

assert.equal(
  shouldUseExpressImageEdit({
    prompt: "Troque a cor da camisa para azul",
    requestedQuality: "fast",
    hasSourceImage: true,
    taskMode: "remove_replace",
  }),
  true
);

assert.equal(
  shouldUseExpressImageEdit({
    prompt: "Troque o fundo e preserve exatamente o rosto da pessoa",
    requestedQuality: "fast",
    hasSourceImage: true,
    taskMode: "background",
  }),
  false
);

assert.equal(
  shouldUseExpressImageEdit({
    prompt: "Remova o objeto pequeno do canto",
    requestedQuality: "fast",
    hasSourceImage: true,
    taskMode: "remove_replace",
  }),
  true
);

assert.equal(
  shouldUseExpressImageEdit({
    prompt: "Troque a cor da camisa para azul",
    requestedQuality: "quality",
    hasSourceImage: true,
    taskMode: "remove_replace",
  }),
  false
);

assert.equal(
  shouldVerifyFastImageCandidate({
    hasSourceImage: true,
    requestedQuality: "fast",
    taskMode: "strict_edit",
    expressEdit: true,
  }),
  false
);

assert.equal(
  shouldVerifyFastImageCandidate({
    hasSourceImage: true,
    requestedQuality: "fast",
    taskMode: "identity_lock",
    expressEdit: false,
  }),
  true
);

console.log("image routing policy tests passed");
