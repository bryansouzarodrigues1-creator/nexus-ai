import assert from "node:assert/strict";
import {
  scoreExactTextRequirements,
  fuseReferenceCompliance,
  evaluateImageQualityGate,
  applyImageQualityGate,
  planImageRetryStrategy,
  selectBetterVisualCandidate,
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


{
  const plan = planImageRetryStrategy(
    {
      qualityGateBlockers: ["identity", "composition"],
    },
    { editStrength: 0.3 },
    1
  );
  assert.equal(plan.retryClass, "preserve");
  assert.ok(plan.editStrength < 0.3);
}

{
  const plan = planImageRetryStrategy(
    {
      qualityGateBlockers: ["request_fulfillment"],
    },
    { editStrength: 0.22 },
    2
  );
  assert.equal(plan.retryClass, "fulfill");
  assert.ok(plan.editStrength > 0.22);
}

{
  const plan = planImageRetryStrategy(
    {
      qualityGateBlockers: ["exact_text"],
    },
    { editStrength: 0.4 },
    2
  );
  assert.equal(plan.retryClass, "text");
  assert.equal(plan.editStrength, 0.4);
}

{
  const plan = planImageRetryStrategy(
    {
      qualityGateBlockers: [
        "request_fulfillment",
        "reference_leakage",
      ],
    },
    { editStrength: 0.35 },
    1
  );
  assert.equal(plan.retryClass, "balanced");
  assert.ok(plan.editStrength < 0.35);
  assert.match(plan.promptHint, /supplementary references/i);
}


{
  // Candidate Arena: a passing candidate always beats a rejected one,
  // even when the rejected candidate has a superficially higher score.
  const rejected = {
    best: {
      candidateScore: 0.96,
      retryCount: 0,
      verification: {
        verified: true,
        pass: false,
        score: 0.96,
      },
    },
    imageQuality: "quality",
  };

  const passed = {
    best: {
      candidateScore: 0.82,
      retryCount: 1,
      verification: {
        verified: true,
        pass: true,
        score: 0.82,
      },
    },
    imageQuality: "fast",
  };

  assert.equal(
    selectBetterVisualCandidate(rejected, passed),
    passed
  );
}

{
  // Among rejected candidates, keep the one with the stronger global score.
  const quality = {
    best: {
      candidateScore: 0.71,
      retryCount: 2,
      verification: {
        verified: true,
        pass: false,
      },
    },
    imageQuality: "quality",
  };

  const fast = {
    best: {
      candidateScore: 0.66,
      retryCount: 0,
      verification: {
        verified: true,
        pass: false,
      },
    },
    imageQuality: "fast",
  };

  assert.equal(
    selectBetterVisualCandidate(quality, fast),
    quality
  );
}

{
  // Tie-breaker: fewer correction passes wins when quality evidence is equal.
  const a = {
    best: {
      candidateScore: 0.8,
      retryCount: 3,
      verification: {
        verified: true,
        pass: false,
      },
    },
  };

  const b = {
    best: {
      candidateScore: 0.8,
      retryCount: 1,
      verification: {
        verified: true,
        pass: false,
      },
    },
  };

  assert.equal(
    selectBetterVisualCandidate(a, b),
    b
  );
}
