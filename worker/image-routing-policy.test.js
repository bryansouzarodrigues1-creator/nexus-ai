import assert from "node:assert/strict";
import {
  shouldPrioritizeImageFidelity,
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

console.log("image routing policy tests passed");
