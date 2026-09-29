import assert from "node:assert/strict";
import {
  shouldContinueImageContext,
  wantsFreshImage,
  selectImageChainHistory,
  selectApprovedChainReferenceKeys,
} from "./image-context.js";

assert.equal(wantsFreshImage("faz outra imagem do zero"), true);
assert.equal(wantsFreshImage("deixe essa imagem mais realista"), false);

assert.equal(
  shouldContinueImageContext("troque só a cor da camisa", true),
  true
);
assert.equal(
  shouldContinueImageContext("deixe o cabelo cacheado", true),
  true
);
assert.equal(
  shouldContinueImageContext("mais realista", true),
  true
);
assert.equal(
  shouldContinueImageContext("gere uma imagem de um cavalo na praia", true),
  false
);
assert.equal(
  shouldContinueImageContext("crie uma nova foto de uma cidade", true),
  false
);
assert.equal(
  shouldContinueImageContext("use essa imagem e remova o fundo", true),
  true
);
assert.equal(
  shouldContinueImageContext("qualquer coisa", false),
  false
);

console.log("image-context tests passed");


const mixedHistory = [
  {
    role: "user",
    content: "crie um carro vermelho",
    mode: "image",
    imageChainId: "chain-a",
  },
  {
    role: "assistant",
    content: "Imagem gerada.",
    imageTask: "create",
    imageChainId: "chain-a",
  },
  {
    role: "user",
    content: "crie uma praia tropical",
    mode: "image",
    imageChainId: "chain-b",
  },
  {
    role: "assistant",
    content: "Imagem gerada.",
    imageTask: "create",
    imageChainId: "chain-b",
  },
];

assert.deepEqual(
  selectImageChainHistory(mixedHistory, "chain-b"),
  [
    { role: "user", content: "crie uma praia tropical" },
    { role: "assistant", content: "Imagem gerada." },
  ]
);

assert.deepEqual(
  selectImageChainHistory(mixedHistory, "chain-new"),
  []
);

assert.equal(
  selectImageChainHistory(
    [
      {
        role: "user",
        content: "troque a camisa",
        mode: "image",
      },
      {
        role: "assistant",
        content: "Edição concluída.",
        media: { type: "image" },
      },
    ],
    "",
    { legacyContinuation: true }
  ).length,
  2
);


{
  // approved same-chain references: explicit human approval only.
  const messages = [
    {
      role: "assistant",
      imageChainId: "chain-a",
      media: { type: "image", key: "root" },
      feedback: "positive",
      visualScore: 0.92,
      identityScore: 0.97,
      fulfillmentScore: 0.9,
    },
    {
      role: "assistant",
      imageChainId: "chain-a",
      media: { type: "image", key: "bad" },
      feedback: "negative",
      visualScore: 0.99,
      identityScore: 0.99,
      fulfillmentScore: 0.99,
    },
    {
      role: "assistant",
      imageChainId: "chain-b",
      media: { type: "image", key: "other-chain" },
      feedback: "positive",
      visualScore: 1,
      identityScore: 1,
      fulfillmentScore: 1,
    },
    {
      role: "assistant",
      imageChainId: "chain-a",
      media: { type: "image", key: "approved-best" },
      feedback: "positive",
      visualScore: 0.96,
      identityScore: 0.99,
      fulfillmentScore: 0.95,
    },
    {
      role: "assistant",
      imageChainId: "chain-a",
      media: { type: "image", key: "current" },
      feedback: "positive",
      visualScore: 1,
      identityScore: 1,
      fulfillmentScore: 1,
    },
  ];

  assert.deepEqual(
    selectApprovedChainReferenceKeys(
      messages,
      "chain-a",
      {
        excludeKeys: ["root", "current"],
        limit: 2,
      }
    ),
    ["approved-best"]
  );

  assert.deepEqual(
    selectApprovedChainReferenceKeys(
      messages,
      "chain-a",
      {
        excludeKeys: [],
        limit: 2,
      }
    ),
    ["current", "approved-best"]
  );

  assert.deepEqual(
    selectApprovedChainReferenceKeys(
      messages,
      "missing",
      { limit: 2 }
    ),
    []
  );
}
