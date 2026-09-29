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

export function scoreImageCaseRelevance(item, {
  mode = "",
  query = "",
  targets = [],
  now = Date.now(),
} = {}) {
  const requestedMode = String(mode || "");
  const sameMode = !requestedMode || String(item?.mode || "") === requestedMode;
  if (!sameMode) return -1;

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

  const ageMs = Math.max(0, Number(now) - Number(item?.at || 0));
  const ageDays = ageMs / 86400000;
  const recency = 1 / (1 + ageDays / 45);

  const retries = Math.max(0, Number(item?.retries || 0));
  const retryPenalty = Math.min(0.12, retries * 0.025);

  const quality =
    score * 0.32 +
    fulfillment * 0.28 +
    identity * 0.18 +
    artifactFree * 0.12 +
    pass * 0.07 +
    verified * 0.03;

  return (
    semanticProxy * 0.52 +
    quality * 0.36 +
    recency * 0.12 -
    retryPenalty
  );
}

export function rankImageCases(cases, options = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const limit = Math.max(1, Math.min(50, Number(options.limit || 20)));
  const scored = list
    .map((item) => ({
      item,
      relevance: scoreImageCaseRelevance(item, options),
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
