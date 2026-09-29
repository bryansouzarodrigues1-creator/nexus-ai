import assert from "node:assert/strict";
import {
  allocateImageReferenceSlots,
} from "./image-reference-policy.js";

assert.deepEqual(
  allocateImageReferenceSlots({
    hasSourceImage: false,
    hasRootReference: false,
    requestedExtraCount: 3,
  }),
  {
    sourceIndex: null,
    rootIndex: null,
    extraStartIndex: null,
    extraCount: 0,
    totalReferences: 0,
    maxReferences: 4,
  }
);

assert.deepEqual(
  allocateImageReferenceSlots({
    hasSourceImage: true,
    hasRootReference: false,
    requestedExtraCount: 10,
  }),
  {
    sourceIndex: 0,
    rootIndex: null,
    extraStartIndex: 1,
    extraCount: 3,
    totalReferences: 4,
    maxReferences: 4,
  }
);

assert.deepEqual(
  allocateImageReferenceSlots({
    hasSourceImage: true,
    hasRootReference: true,
    requestedExtraCount: 10,
  }),
  {
    sourceIndex: 0,
    rootIndex: 1,
    extraStartIndex: 2,
    extraCount: 2,
    totalReferences: 4,
    maxReferences: 4,
  }
);

assert.deepEqual(
  allocateImageReferenceSlots({
    hasSourceImage: true,
    hasRootReference: true,
    requestedExtraCount: 0,
  }),
  {
    sourceIndex: 0,
    rootIndex: 1,
    extraStartIndex: null,
    extraCount: 0,
    totalReferences: 2,
    maxReferences: 4,
  }
);

console.log("image reference policy tests passed");
