import assert from "node:assert/strict";
import {
  classifyAdaptiveFailure,
  rankAdaptiveCandidates,
} from "./adaptive-router.js";

function candidate(model, baseScore, costTier = 0) {
  return {
    model,
    provider: "cloudflare",
    baseScore,
    costTier,
  };
}

{
  const decision = rankAdaptiveCandidates(
    [
      candidate("general", 0.78, 0),
      candidate("alternate", 0.70, 0),
    ],
    [],
    { minimumEvidenceToOverride: 6 }
  );

  assert.equal(decision.selected.model, "general");
  assert.equal(decision.adaptive, false);
}

{
  const stats = [
    {
      model: "alternate",
      provider: "cloudflare",
      outcomeCount: 24,
      success: 24,
      operationalFailures: 0,
      positive: 15,
      negative: 1,
      scoreCount: 12,
      avgScore: 0.94,
      avgLatencyMs: 1700,
    },
    {
      model: "general",
      provider: "cloudflare",
      outcomeCount: 24,
      success: 23,
      operationalFailures: 1,
      positive: 2,
      negative: 10,
      scoreCount: 10,
      avgScore: 0.58,
      avgLatencyMs: 2200,
    },
  ];

  const decision = rankAdaptiveCandidates(
    [
      candidate("general", 0.78, 0),
      candidate("alternate", 0.70, 0),
    ],
    stats,
    { minimumEvidenceToOverride: 6 }
  );

  assert.equal(decision.selected.model, "alternate");
  assert.equal(decision.adaptive, true);
}

{
  const stats = [
    {
      model: "alternate",
      provider: "cloudflare",
      outcomeCount: 1,
      success: 1,
      operationalFailures: 0,
      positive: 1,
      negative: 0,
      scoreCount: 1,
      avgScore: 1,
      avgLatencyMs: 800,
    },
  ];

  const decision = rankAdaptiveCandidates(
    [
      candidate("general", 0.78, 0),
      candidate("alternate", 0.70, 0),
    ],
    stats,
    { minimumEvidenceToOverride: 6 }
  );

  assert.equal(decision.selected.model, "general");
  assert.equal(decision.adaptive, false);
}

{
  const stats = [
    {
      model: "alternate",
      provider: "cloudflare",
      outcomeCount: 1,
      success: 1,
      operationalFailures: 0,
      positive: 1,
      negative: 0,
      scoreCount: 1,
      avgScore: 1,
      avgLatencyMs: 500,
    },
  ];

  const decision = rankAdaptiveCandidates(
    [
      candidate("general", 0.74, 0),
      candidate("alternate", 0.73, 0),
    ],
    stats,
    {
      minimumEvidenceToOverride: 6,
      explorationWeight: 0,
    }
  );

  assert.equal(decision.selected.model, "general");
  assert.equal(decision.adaptive, false);
  assert.equal(
    decision.reason,
    "insufficient-evidence-to-override"
  );
}

{
  const stats = [
    {
      model: "quality",
      provider: "cloudflare",
      outcomeCount: 30,
      success: 30,
      operationalFailures: 0,
      positive: 8,
      negative: 0,
      scoreCount: 20,
      avgScore: 0.91,
      avgLatencyMs: 9000,
    },
    {
      model: "fast",
      provider: "cloudflare",
      outcomeCount: 30,
      success: 30,
      operationalFailures: 0,
      positive: 7,
      negative: 1,
      scoreCount: 20,
      avgScore: 0.88,
      avgLatencyMs: 2500,
    },
  ];

  const decision = rankAdaptiveCandidates(
    [
      candidate("fast", 0.77, 0),
      candidate("quality", 0.74, 1),
    ],
    stats,
    {
      economyWeight: 0.05,
      latencyTargetMs: 5000,
      minimumEvidenceToOverride: 6,
    }
  );

  assert.equal(decision.selected.model, "fast");
}

{
  assert.deepEqual(
    classifyAdaptiveFailure(
      new Error("You have depleted your monthly included credits")
    ),
    { kind: "quota", operational: true }
  );

  assert.deepEqual(
    classifyAdaptiveFailure(
      new Error("429 rate limit exceeded")
    ),
    { kind: "rate-limit", operational: true }
  );

  assert.deepEqual(
    classifyAdaptiveFailure(
      new Error("model task not supported")
    ),
    { kind: "compatibility", operational: true }
  );

  assert.deepEqual(
    classifyAdaptiveFailure(
      new Error("answer quality was poor")
    ),
    { kind: "unknown", operational: false }
  );
}

console.log("adaptive-router tests passed");
