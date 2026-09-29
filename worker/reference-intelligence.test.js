import assert from "node:assert/strict";
import {
  createReferenceSkeleton,
  sanitizeReferencePlan,
  formatReferencePlan,
} from "./reference-intelligence.js";

{
  const skeleton = createReferenceSkeleton({
    manualDescriptions: ["camisa azul", "cabelo cacheado"],
    manualCount: 2,
    autoApprovedCount: 1,
    startIndex: 1,
  });

  assert.deepEqual(
    skeleton.map((item) => [item.imageIndex, item.source]),
    [
      [1, "manual"],
      [2, "manual"],
      [3, "approved_history"],
    ]
  );
  assert.equal(skeleton[2].role, "continuity_evidence");
}

{
  const skeleton = createReferenceSkeleton({
    manualDescriptions: ["referência de roupa"],
    manualCount: 1,
    autoApprovedCount: 1,
    startIndex: 2,
  });

  const plan = sanitizeReferencePlan(
    {
      references: [
        {
          imageIndex: 2,
          relevant: true,
          role: "clothing_reference",
          useFor: ["jacket", "fabric"],
          avoid: ["face"],
          confidence: 0.94,
        },
        {
          imageIndex: 99,
          role: "must_not_be_accepted",
          confidence: 1,
        },
      ],
      globalRules: ["keep image 0 identity"],
    },
    skeleton
  );

  assert.equal(plan.references.length, 2);
  assert.equal(plan.references[0].imageIndex, 2);
  assert.equal(plan.references[0].role, "clothing_reference");
  assert.equal(plan.references[1].source, "approved_history");
  assert.equal(
    plan.references.some((item) => item.imageIndex === 99),
    false
  );

  const text = formatReferencePlan(plan);
  assert(text.includes("Image 2"));
  assert(text.includes("clothing_reference"));
  assert(text.includes("approved_history"));
}

console.log("reference-intelligence tests passed");
