function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function comparable(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function levenshtein(a, b) {
  const aa = comparable(a);
  const bb = comparable(b);

  if (aa === bb) return 0;
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;

  let previous = Array.from({ length: bb.length + 1 }, (_, i) => i);
  let current = new Array(bb.length + 1);

  for (let i = 1; i <= aa.length; i++) {
    current[0] = i;
    for (let j = 1; j <= bb.length; j++) {
      const substitution = previous[j - 1] + (aa[i - 1] === bb[j - 1] ? 0 : 1);
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        substitution
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[bb.length];
}

function similarity(a, b) {
  const aa = comparable(a);
  const bb = comparable(b);
  const maxLength = Math.max(aa.length, bb.length);
  if (!maxLength) return 1;
  return clamp01(1 - levenshtein(aa, bb) / maxLength);
}

function bestObservedSimilarity(expected, observed) {
  const target = comparable(expected);
  if (!target) return 1;

  const items = (Array.isArray(observed) ? observed : [])
    .map(comparable)
    .filter(Boolean)
    .slice(0, 24);

  const joined = comparable(items.join(" | "));
  const candidates = [...items, joined].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(target)) return 1;
  }

  let best = 0;
  const targetLength = target.length;

  for (const candidate of candidates) {
    best = Math.max(best, similarity(target, candidate));

    if (candidate.length <= targetLength + 8) continue;

    const minWindow = Math.max(1, targetLength - 3);
    const maxWindow = Math.min(candidate.length, targetLength + 3);

    for (let windowLength = minWindow; windowLength <= maxWindow; windowLength++) {
      const step = Math.max(1, Math.floor(windowLength / 8));
      for (let start = 0; start + windowLength <= candidate.length; start += step) {
        best = Math.max(
          best,
          similarity(target, candidate.slice(start, start + windowLength))
        );
        if (best >= 0.999) return 1;
      }
    }
  }

  return clamp01(best);
}

export function scoreExactTextRequirements(expected, observed) {
  const expectedTexts = (Array.isArray(expected) ? expected : [])
    .map(comparable)
    .filter(Boolean)
    .slice(0, 12);

  const observedTexts = (Array.isArray(observed) ? observed : [])
    .map(comparable)
    .filter(Boolean)
    .slice(0, 24);

  if (!expectedTexts.length) {
    return {
      applicable: false,
      score: 1,
      exactMatches: 0,
      total: 0,
      missing: [],
      perText: [],
    };
  }

  const perText = expectedTexts.map((text) => {
    const score = bestObservedSimilarity(text, observedTexts);
    return {
      text,
      score,
      exact: score >= 0.999,
    };
  });

  const score =
    perText.reduce((sum, item) => sum + item.score, 0) /
    Math.max(1, perText.length);

  return {
    applicable: true,
    score: clamp01(score),
    exactMatches: perText.filter((item) => item.exact).length,
    total: perText.length,
    missing: perText
      .filter((item) => item.score < 0.92)
      .map((item) => item.text),
    perText,
  };
}

export function fuseReferenceCompliance(baseVerification, referenceCompliance) {
  const base = baseVerification && typeof baseVerification === "object"
    ? { ...baseVerification }
    : {};

  if (
    !referenceCompliance ||
    referenceCompliance.applicable !== true ||
    referenceCompliance.verified !== true
  ) {
    return base;
  }

  const baseScore = clamp01(base.score ?? 0.5);
  const referenceScore = clamp01(referenceCompliance.score ?? 0.5);
  const leakageRisk = clamp01(referenceCompliance.leakageRisk ?? 0);

  const fusedScore = Math.min(
    baseScore,
    baseScore * 0.72 + referenceScore * 0.28
  );

  const referencePass =
    referenceScore >= 0.74 &&
    leakageRisk <= 0.28;

  return {
    ...base,
    pass: Boolean(base.pass) && referencePass,
    score: fusedScore,
    referenceVerified: true,
    referenceScore,
    referenceLeakageRisk: leakageRisk,
    referencePass,
    issues: [
      ...(Array.isArray(base.issues) ? base.issues : []),
      ...(Array.isArray(referenceCompliance.issues)
        ? referenceCompliance.issues
        : []),
    ].slice(0, 20),
    unwantedChanges: [
      ...(Array.isArray(base.unwantedChanges) ? base.unwantedChanges : []),
      ...(Array.isArray(referenceCompliance.leakedAttributes)
        ? referenceCompliance.leakedAttributes
        : []),
    ].slice(0, 20),
    retryInstruction: [
      String(base.retryInstruction || "").trim(),
      String(referenceCompliance.retryInstruction || "").trim(),
    ].filter(Boolean).join(" ").slice(0, 3600),
  };
}
