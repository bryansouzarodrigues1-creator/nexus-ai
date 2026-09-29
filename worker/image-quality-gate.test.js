import assert from "node:assert/strict";
import {
  scoreExactTextRequirements,
  fuseReferenceCompliance,
} from "./image-quality-gate.js";

{
  const result = scoreExactTextRequirements(
    ["Mielle Pescados", "R$ 39,90"],
    ["Mielle Pescados", "Oferta: R$ 39,90"]
  );
  assert.equal(result.applicable, true);
  assert.equal(result.exactMatches, 2);
  assert.equal(result.score, 1);
}

{
  const result = scoreExactTextRequirements(
    ["QUALIDADE MÁXIMA"],
    ["QUALIDADE MAXIMA"]
  );
  assert.ok(result.score < 1);
  assert.ok(result.score > 0.8);
  assert.deepEqual(result.missing, []);
}

{
  const result = scoreExactTextRequirements(
    ["PROMOÇÃO"],
    ["PROMOCAO"]
  );
  assert.ok(result.score < 0.92);
  assert.deepEqual(result.missing, ["PROMOÇÃO"]);
}

{
  const fused = fuseReferenceCompliance(
    {
      pass: true,
      score: 0.91,
      issues: [],
      unwantedChanges: [],
      retryInstruction: "",
    },
    {
      applicable: true,
      verified: true,
      score: 0.55,
      leakageRisk: 0.1,
      issues: ["A roupa não corresponde à referência."],
      leakedAttributes: [],
      retryInstruction: "Copie apenas a roupa da referência.",
    }
  );

  assert.equal(fused.pass, false);
  assert.equal(fused.referenceVerified, true);
  assert.equal(fused.referencePass, false);
  assert.ok(fused.score < 0.91);
  assert.match(fused.retryInstruction, /roupa/);
}

{
  const fused = fuseReferenceCompliance(
    {
      pass: true,
      score: 0.88,
      issues: [],
      unwantedChanges: [],
    },
    {
      applicable: true,
      verified: true,
      score: 0.9,
      leakageRisk: 0.12,
      issues: [],
      leakedAttributes: [],
    }
  );

  assert.equal(fused.pass, true);
  assert.equal(fused.referencePass, true);
  assert.ok(fused.score <= 0.88);
}

console.log("image-quality-gate tests passed");
