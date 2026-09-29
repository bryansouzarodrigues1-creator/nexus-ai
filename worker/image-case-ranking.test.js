import assert from "node:assert/strict";
import {
  rankImageCases,
  scoreImageCaseRelevance,
  tokenizeImageIntent,
} from "./image-case-ranking.js";

{
  const tokens = tokenizeImageIntent(
    "Troque apenas a camisa vermelha por azul sem mudar o rosto"
  );
  assert(tokens.includes("camisa"));
  assert(tokens.includes("vermelha"));
  assert(tokens.includes("azul"));
  assert(tokens.includes("rosto"));
  assert(!tokens.includes("apenas"));
}

{
  const cases = [
    {
      at: Date.now() - 1000,
      mode: "strict_edit",
      intentSummary: "trocar camisa preta por azul",
      targets: ["camisa"],
      verified: true,
      pass: true,
      score: 0.91,
      identity: 0.95,
      requestFulfillment: 0.92,
      artifactFree: 0.94,
      retries: 0,
    },
    {
      at: Date.now(),
      mode: "strict_edit",
      intentSummary: "remover sandália do chão",
      targets: ["sandália"],
      verified: true,
      pass: true,
      score: 0.99,
      identity: 0.99,
      requestFulfillment: 0.99,
      artifactFree: 0.99,
      retries: 0,
    },
  ];

  const ranked = rankImageCases(cases, {
    mode: "strict_edit",
    query: "mude somente a cor da camisa para azul",
    targets: ["camisa"],
    limit: 2,
  });

  assert.equal(ranked[0].item.targets[0], "camisa");
}

{
  const goodRelevant = {
    at: Date.now(),
    mode: "identity_lock",
    intentSummary: "preservar o mesmo rosto e mudar o cabelo",
    targets: ["cabelo"],
    verified: true,
    pass: true,
    score: 0.9,
    identity: 0.98,
    requestFulfillment: 0.9,
    artifactFree: 0.9,
    retries: 1,
  };

  const unrelated = {
    at: Date.now(),
    mode: "poster",
    intentSummary: "poster de promoção de restaurante",
    targets: ["texto"],
    verified: true,
    pass: true,
    score: 1,
    identity: 1,
    requestFulfillment: 1,
    artifactFree: 1,
    retries: 0,
  };

  const a = scoreImageCaseRelevance(goodRelevant, {
    mode: "identity_lock",
    query: "deixe o cabelo cacheado sem mudar o rosto",
    targets: ["cabelo"],
  });

  const b = scoreImageCaseRelevance(unrelated, {
    mode: "identity_lock",
    query: "deixe o cabelo cacheado sem mudar o rosto",
    targets: ["cabelo"],
  });

  assert(a > 0);
  assert.equal(b, -1);
}

{
  const cases = Array.from({ length: 30 }, (_, i) => ({
    at: Date.now() - i * 1000,
    mode: "enhance",
    intentSummary:
      i === 12
        ? "melhorar nitidez preservando textura da pele"
        : "melhorar uma fotografia qualquer",
    targets: i === 12 ? ["nitidez", "pele"] : ["qualidade"],
    verified: true,
    pass: true,
    score: i === 12 ? 0.9 : 0.95,
    identity: 0.95,
    requestFulfillment: 0.9,
    artifactFree: 0.9,
    retries: 0,
  }));

  const ranked = rankImageCases(cases, {
    mode: "enhance",
    query: "melhore a nitidez sem deixar a pele artificial",
    targets: ["nitidez", "pele"],
    limit: 6,
  });

  assert.equal(ranked.length, 6);
  assert(
    ranked.slice(0, 3).some((entry) =>
      entry.item.targets.includes("pele")
    )
  );
}

console.log("image-case-ranking tests passed");


{
  // explicit user feedback outranks verifier-only equivalence
  const base = {
    at: Date.now(),
    mode: "strict_edit",
    intentSummary: "trocar a cor da camisa sem mudar o rosto",
    targets: ["camisa", "rosto"],
    verified: true,
    pass: true,
    score: 0.9,
    identity: 0.95,
    requestFulfillment: 0.9,
    artifactFree: 0.93,
    retries: 0,
  };

  const ranked = rankImageCases(
    [
      { ...base, id: "negative", userSignal: "negative" },
      { ...base, id: "positive", userSignal: "positive" },
    ],
    {
      mode: "strict_edit",
      query: "mude a camisa mas preserve o rosto",
      targets: ["camisa", "rosto"],
      limit: 2,
    }
  );

  assert.equal(ranked[0].item.id, "positive");
  assert(
    ranked.find((entry) => entry.item.id === "negative")
      .semanticSimilarity > 0
  );
}
