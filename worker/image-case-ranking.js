const STOPWORDS = new Set([
  "a","o","as","os","um","uma","uns","umas","de","da","do","das","dos","e","ou",
  "em","no","na","nos","nas","para","por","com","sem","que","isso","isto","essa",
  "esse","esta","este","meu","minha","seu","sua","mais","menos","muito","muita",
  "mudar","mude","trocar","troque","fazer","faça","faca","criar","crie","gere",
  "imagem","foto","picture","image","the","and","with","without","for","from","this",
  "that","make","create","generate","edit","change"
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenizeImageIntent(value) {
  return [...new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  )].slice(0, 80);
}

function jaccard(a, b) {
  const aa = new Set(a);
  const bb = new Set(b);
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection += 1;
  return intersection / (aa.size + bb.size - intersection);
}

function overlapRecall(query, candidate) {
  if (!query.length || !candidate.length) return 0;
  const set = new Set(candidate);
  let hit = 0;
  for (const token of query) if (set.has(token)) hit += 1;
  return hit / query.length;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function describeImageCaseRelevance(item, {
  mode = "",
  query = "",
  targets = [],
  now = Date.now(),
} = {}) {
  const requestedMode = String(mode || "");
  const sameMode = !requestedMode || String(item?.mode || "") === requestedMode;
  if (!sameMode) {
    return {
      relevance: -1,
      semanticSimilarity: 0,
      quality: 0,
      recency: 0,
      retryPenalty: 0,
    };
  }

  const queryTokens = tokenizeImageIntent(
    [query, ...(Array.isArray(targets) ? targets : [])].join(" ")
  );
  const caseTokens = tokenizeImageIntent(
    [
      item?.intentSummary || "",
      ...(Array.isArray(item?.successCriteria) ? item.successCriteria : []),
      ...(Array.isArray(item?.targets) ? item.targets : []),
      ...(Array.isArray(item?.issues) ? item.issues : []),
      ...(Array.isArray(item?.unwantedChanges) ? item.unwantedChanges : []),
    ].join(" ")
  );

  const lexical = jaccard(queryTokens, caseTokens);
  const recall = overlapRecall(queryTokens, caseTokens);
  const semanticProxy = lexical * 0.55 + recall * 0.45;

  const verified = item?.verified ? 1 : 0;
  const pass = item?.pass ? 1 : 0;
  const score = Number.isFinite(Number(item?.score))
    ? clamp01(item.score)
    : 0.5;
  const identity = Number.isFinite(Number(item?.identity))
    ? clamp01(item.identity)
    : 0.5;
  const fulfillment = Number.isFinite(Number(item?.requestFulfillment))
    ? clamp01(item.requestFulfillment)
    : 0.5;
  const artifactFree = Number.isFinite(Number(item?.artifactFree))
    ? clamp01(item.artifactFree)
    : 0.5;
  const deterministicTextAccuracy =
    Number.isFinite(Number(item?.deterministicTextAccuracy))
      ? clamp01(item.deterministicTextAccuracy)
      : Number.isFinite(Number(item?.textAccuracy))
        ? clamp01(item.textAccuracy)
        : 0.5;
  const referenceScore =
    Number.isFinite(Number(item?.referenceScore))
      ? clamp01(item.referenceScore)
      : 0.5;
  const referenceLeakageRisk =
    Number.isFinite(Number(item?.referenceLeakageRisk))
      ? clamp01(item.referenceLeakageRisk)
      : 0;
  const qualityGateScore =
    Number.isFinite(Number(item?.qualityGateScore))
      ? clamp01(item.qualityGateScore)
      : null;
  const qualityGatePass =
    typeof item?.qualityGatePass === "boolean"
      ? item.qualityGatePass
      : null;
  const qualityGateBlockers =
    Array.isArray(item?.qualityGateBlockers)
      ? item.qualityGateBlockers.length
      : 0;

  const ageMs = Math.max(0, Number(now) - Number(item?.at || 0));
  const ageDays = ageMs / 86400000;
  const recency = 1 / (1 + ageDays / 45);

  const retries = Math.max(0, Number(item?.retries || 0));
  const retryPenalty = Math.min(0.12, retries * 0.025);

  const verifierQuality = Math.max(
    0,
    score * 0.26 +
      fulfillment * 0.23 +
      identity * 0.15 +
      artifactFree * 0.1 +
      deterministicTextAccuracy * 0.07 +
      referenceScore * 0.07 +
      (qualityGateScore == null ? score : qualityGateScore) * 0.09 +
      pass * 0.06 +
      verified * 0.02 +
      (qualityGatePass === true ? 0.03 : 0) -
      referenceLeakageRisk * 0.08 -
      Math.min(0.1, qualityGateBlockers * 0.012)
  );

  const userSignal = String(item?.userSignal || "neutral");
  const userApproval =
    userSignal === "positive"
      ? 1
      : userSignal === "negative"
        ? 0
        : 0.5;

  // Human feedback has more authority than the verifier, but does not erase
  // the verifier signal entirely. Negative cases can still be retrieved as
  // warnings because semanticSimilarity is kept separately.
  const quality =
    verifierQuality * 0.74 +
    userApproval * 0.26;

  return {
    relevance:
      semanticProxy * 0.52 +
      quality * 0.36 +
      recency * 0.12 -
      retryPenalty,
    semanticSimilarity: semanticProxy,
    quality,
    userApproval,
    recency,
    retryPenalty,
  };
}

export function scoreImageCaseRelevance(item, options = {}) {
  return describeImageCaseRelevance(item, options).relevance;
}

export function rankImageCases(cases, options = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const limit = Math.max(1, Math.min(50, Number(options.limit || 20)));
  const scored = list
    .map((item) => ({
      item,
      ...describeImageCaseRelevance(item, options),
    }))
    .filter((entry) => entry.relevance >= 0)
    .sort(
      (a, b) =>
        b.relevance - a.relevance ||
        Number(b.item?.at || 0) - Number(a.item?.at || 0)
    );

  const queryTokens = tokenizeImageIntent(
    [options.query || "", ...(Array.isArray(options.targets) ? options.targets : [])]
      .join(" ")
  );

  if (queryTokens.length) {
    const semanticallyRelated = scored.filter((entry) => {
      const caseTokens = tokenizeImageIntent(
        [
          entry.item?.intentSummary || "",
          ...(Array.isArray(entry.item?.targets) ? entry.item.targets : []),
          ...(Array.isArray(entry.item?.successCriteria) ? entry.item.successCriteria : []),
        ].join(" ")
      );
      return overlapRecall(queryTokens, caseTokens) > 0;
    });

    if (semanticallyRelated.length >= Math.min(4, limit)) {
      return semanticallyRelated.slice(0, limit);
    }
  }

  return scored.slice(0, limit);
}
