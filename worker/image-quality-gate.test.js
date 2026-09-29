import assert from "node:assert/strict";
import {
  scoreExactTextRequirements,
  fuseReferenceCompliance,
  evaluateImageQualityGate,
  applyImageQualityGate,
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


{
  const gate = evaluateImageQualityGate(
    {
      verified: true,
      pass: true,
      score: 0.93,
      requestFulfillment: 0.94,
      identity: 0.95,
      composition: 0.91,
      backgroundPreservation: 0.9,
      stylePreservation: 0.9,
      artifactFree: 0.94,
      textAccuracy: 1,
      exactTextMatches: 1,
      exactTextTotal: 1,
    },
    {
      mode: "poster",
      preservationLevel: "medium",
      requiresTextAccuracy: true,
      requiresIdentityLock: false,
    }
  );

  assert.equal(gate.pass, true);
  assert.equal(gate.blockers.length, 0);
  assert.ok(gate.score > 0.85);
}

{
  const gate = evaluateImageQualityGate(
    {
      verified: true,
      pass: true,
      score: 0.94,
      requestFulfillment: 0.95,
      identity: 0.96,
      composition: 0.9,
      backgroundPreservation: 0.9,
      stylePreservation: 0.9,
      artifactFree: 0.95,
      textAccuracy: 0.97,
      exactTextMatches: 1,
      exactTextTotal: 2,
    },
    {
      mode: "poster",
      preservationLevel: "medium",
      requiresTextAccuracy: true,
      requiresIdentityLock: false,
    }
  );

  assert.equal(gate.pass, false);
  assert.ok(gate.blockerCodes.includes("exact_text"));
  assert.match(gate.retryInstruction, /character-for-character/i);
}

{
  const gate = evaluateImageQualityGate(
    {
      verified: true,
      pass: true,
      score: 0.9,
      requestFulfillment: 0.92,
      identity: 0.68,
      composition: 0.9,
      backgroundPreservation: 0.9,
      stylePreservation: 0.9,
      artifactFree: 0.94,
      textAccuracy: 1,
    },
    {
      mode: "strict_edit",
      preservationLevel: "maximum",
      requiresTextAccuracy: false,
      requiresIdentityLock: true,
    }
  );

  assert.equal(gate.pass, false);
  assert.ok(gate.blockerCodes.includes("identity"));
  assert.match(gate.retryInstruction, /identity/i);
}

{
  const gate = evaluateImageQualityGate(
    {
      verified: true,
      pass: true,
      score: 0.91,
      requestFulfillment: 0.92,
      identity: 0.93,
      composition: 0.9,
      backgroundPreservation: 0.9,
      stylePreservation: 0.9,
      artifactFree: 0.94,
      textAccuracy: 1,
      referenceVerified: true,
      referenceScore: 0.9,
      referenceLeakageRisk: 0.52,
    },
    {
      mode: "strict_edit",
      preservationLevel: "high",
      requiresTextAccuracy: false,
      requiresIdentityLock: true,
    }
  );

  assert.equal(gate.pass, false);
  assert.ok(gate.blockerCodes.includes("reference_leakage"));
}

{
  const applied = applyImageQualityGate(
    {
      verified: true,
      pass: true,
      score: 0.92,
      requestFulfillment: 0.7,
      identity: 0.93,
      composition: 0.9,
      backgroundPreservation: 0.9,
      stylePreservation: 0.9,
      artifactFree: 0.95,
      textAccuracy: 1,
      retryInstruction: "Model says improve the target.",
    },
    {
      mode: "strict_edit",
      preservationLevel: "maximum",
      requiresTextAccuracy: false,
      requiresIdentityLock: true,
    }
  );

  assert.equal(applied.pass, false);
  assert.ok(applied.qualityGateBlockers.includes("request_fulfillment"));
  assert.match(applied.retryInstruction, /requested change/i);
  assert.match(applied.retryInstruction, /Model says/i);
}

console.log("image-quality-gate tests passed");
