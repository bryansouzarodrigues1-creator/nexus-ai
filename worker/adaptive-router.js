function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bayesianRate(successes, failures, priorSuccess = 2, priorFailure = 2) {
  const s = Math.max(0, safeNumber(successes));
  const f = Math.max(0, safeNumber(failures));
  return (s + priorSuccess) / (s + f + priorSuccess + priorFailure);
}

function smoothedScore(avgScore, scoreCount, priorScore = 0.74, priorWeight = 4) {
  const count = Math.max(0, safeNumber(scoreCount));
  if (!count) return priorScore;
  return (
    clamp01(avgScore) * count +
    clamp01(priorScore) * priorWeight
  ) / (count + priorWeight);
}

function latencyUtility(avgLatencyMs, targetMs) {
  const latency = Math.max(0, safeNumber(avgLatencyMs));
  const target = Math.max(250, safeNumber(targetMs, 4500));
  if (!latency) return 0.72;
  return clamp01(1 / (1 + latency / (target * 2)));
}

function evidenceConfidence(samples, scale = 8) {
  const n = Math.max(0, safeNumber(samples));
  return clamp01(1 - Math.exp(-n / Math.max(1, scale)));
}

function findModelStat(modelStats, candidate) {
  const items = Array.isArray(modelStats) ? modelStats : [];
  const model = String(candidate?.model || "");
  const provider = String(candidate?.provider || "");

  return (
    items.find(
      (item) =>
        String(item?.model || "") === model &&
        (!provider || String(item?.provider || "") === provider)
    ) ||
    items.find((item) => String(item?.model || "") === model) ||
    null
  );
}

export function classifyAdaptiveFailure(error) {
  const text = String(
    error?.message ||
    error?.raw ||
    error ||
    ""
  ).toLowerCase();

  if (
    /depleted|included credits|insufficient.*credit|credit.*exhaust|quota|billing|payment required|pre.?paid|balance.*low|no credits|\b402\b/.test(text)
  ) {
    return { kind: "quota", operational: true };
  }

  if (/\b429\b|rate.?limit|too many requests|throttl|capacity temporarily exceeded/.test(text)) {
    return { kind: "rate-limit", operational: true };
  }

  if (/\b401\b|\b403\b|unauthor|forbidden|invalid.*key|api key|token.*invalid/.test(text)) {
    return { kind: "auth", operational: true };
  }

  if (
    /not supported|unsupported|path .* not found|model.*not.*available|task.*not.*support|no provider|\b404\b/.test(text)
  ) {
    return { kind: "compatibility", operational: true };
  }

  if (/timeout|timed out|\b408\b|\b504\b/.test(text)) {
    return { kind: "timeout", operational: true };
  }

  if (/temporar|service unavailable|bad gateway|gateway timeout|\b500\b|\b502\b|\b503\b/.test(text)) {
    return { kind: "transient", operational: true };
  }

  if (/invalid response|bad response|html de erro|página de erro/.test(text)) {
    return { kind: "bad-response", operational: true };
  }

  return { kind: "unknown", operational: false };
}

export function scoreAdaptiveCandidate(candidate, modelStats, options = {}) {
  const stat = findModelStat(modelStats, candidate) || {};
  const positive = Math.max(0, safeNumber(stat.positive));
  const negative = Math.max(0, safeNumber(stat.negative));
  const explicitSamples = positive + negative;
  const success = Math.max(0, safeNumber(stat.success));
  const operationalFailures = Math.max(
    0,
    safeNumber(stat.operationalFailures)
  );
  const outcomeCount = Math.max(
    0,
    safeNumber(stat.outcomeCount, stat.count || 0)
  );
  const scoreCount = Math.max(0, safeNumber(stat.scoreCount));
  const evidence =
    outcomeCount +
    explicitSamples * 1.8 +
    scoreCount * 1.25;

  const reliability = bayesianRate(
    success,
    operationalFailures,
    5,
    1
  );
  const approval = bayesianRate(
    positive,
    negative,
    2,
    2
  );
  const quality = smoothedScore(
    stat.avgScore,
    scoreCount,
    options.priorQuality ?? 0.74,
    4
  );
  const latency = latencyUtility(
    stat.avgLatencyMs,
    options.latencyTargetMs || 4500
  );

  const historical =
    reliability * 0.25 +
    approval * 0.35 +
    quality * 0.30 +
    latency * 0.10;

  const confidence = evidenceConfidence(evidence, 8);
  const baseScore = clamp01(candidate?.baseScore ?? 0.72);
  const blended =
    baseScore * (1 - confidence) +
    historical * confidence;

  const costTier = Math.max(
    0,
    Math.min(3, safeNumber(candidate?.costTier))
  );
  const economyWeight = Math.max(
    0,
    safeNumber(options.economyWeight, 0.035)
  );
  const costPenalty = costTier * economyWeight;

  const totalEvidence = Math.max(
    0,
    safeNumber(options.totalEvidence, evidence)
  );
  const explorationWeight = Math.max(
    0,
    safeNumber(options.explorationWeight, 0.018)
  );
  const explorationBonus =
    candidate?.allowExploration === false
      ? 0
      : Math.min(
          0.032,
          Math.sqrt(
            Math.log(totalEvidence + 2) /
            Math.max(2, evidence + 2)
          ) * explorationWeight
        );

  const finalScore = clamp01(
    blended -
    costPenalty +
    explorationBonus
  );

  return {
    model: String(candidate?.model || ""),
    provider: String(candidate?.provider || ""),
    label: String(candidate?.label || candidate?.model || ""),
    baseScore,
    finalScore,
    confidence,
    evidence,
    reliability,
    approval,
    quality,
    latency,
    costTier,
    costPenalty,
    explorationBonus,
    stats: {
      outcomeCount,
      success,
      operationalFailures,
      qualityFailures: Math.max(0, safeNumber(stat.qualityFailures)),
      positive,
      negative,
      scoreCount,
      avgScore: clamp01(stat.avgScore),
      avgLatencyMs: Math.max(0, safeNumber(stat.avgLatencyMs)),
      lastFailureKind: String(stat.lastFailureKind || ""),
    },
  };
}

export function rankAdaptiveCandidates(candidates, modelStats, options = {}) {
  const safeCandidates = Array.isArray(candidates)
    ? candidates.filter((candidate) => candidate?.model)
    : [];

  if (!safeCandidates.length) {
    return {
      selected: null,
      ranked: [],
      adaptive: false,
      reason: "no-candidates",
    };
  }

  const totalEvidence = (Array.isArray(modelStats) ? modelStats : [])
    .reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          safeNumber(item?.outcomeCount, item?.count || 0)
        ) +
        (Math.max(0, safeNumber(item?.positive)) +
          Math.max(0, safeNumber(item?.negative))) *
          1.8 +
        Math.max(0, safeNumber(item?.scoreCount)) * 1.25,
      0
    );

  const ranked = safeCandidates
    .map((candidate, index) => ({
      ...candidate,
      index,
      score: scoreAdaptiveCandidate(
        candidate,
        modelStats,
        {
          ...options,
          totalEvidence,
        }
      ),
    }))
    .sort(
      (a, b) =>
        b.score.finalScore - a.score.finalScore ||
        a.index - b.index
    );

  const selected = ranked[0];
  const original = safeCandidates[0];
  const originalScore = ranked.find(
    (item) =>
      item.model === original.model &&
      String(item.provider || "") === String(original.provider || "")
  );

  const minimumEvidenceToOverride = Math.max(
    3,
    safeNumber(options.minimumEvidenceToOverride, 6)
  );

  const canOverride =
    selected.model === original.model ||
    selected.score.evidence >= minimumEvidenceToOverride ||
    (originalScore?.score?.evidence || 0) >= minimumEvidenceToOverride;

  const finalSelected = canOverride
    ? selected
    : originalScore || selected;

  const adaptive =
    finalSelected.model !== original.model ||
    String(finalSelected.provider || "") !== String(original.provider || "");

  return {
    selected: finalSelected,
    ranked,
    adaptive,
    reason: adaptive
      ? "historical-evidence-overrode-base"
      : canOverride
        ? "base-or-history-agree"
        : "insufficient-evidence-to-override",
  };
}

export function compactAdaptiveDecision(decision) {
  if (!decision?.selected) return null;

  return {
    adaptive: Boolean(decision.adaptive),
    reason: String(decision.reason || ""),
    selected: {
      model: decision.selected.model,
      provider: decision.selected.provider || "",
      score: Number(
        decision.selected.score?.finalScore?.toFixed?.(4) ||
        decision.selected.score?.finalScore ||
        0
      ),
      confidence: Number(
        decision.selected.score?.confidence?.toFixed?.(4) ||
        decision.selected.score?.confidence ||
        0
      ),
      evidence: Number(decision.selected.score?.evidence || 0),
    },
    alternatives: (decision.ranked || [])
      .slice(0, 4)
      .map((item) => ({
        model: item.model,
        provider: item.provider || "",
        score: Number(
          item.score?.finalScore?.toFixed?.(4) ||
          item.score?.finalScore ||
          0
        ),
        confidence: Number(
          item.score?.confidence?.toFixed?.(4) ||
          item.score?.confidence ||
          0
        ),
        evidence: Number(item.score?.evidence || 0),
      })),
  };
}
