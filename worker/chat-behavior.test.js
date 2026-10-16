import assert from "node:assert/strict";
import { NEXUS_CONTEXTUAL_BEHAVIOR, getNexusContextualBehavior } from "./chat-behavior.js";

const prompt=getNexusContextualBehavior();
assert(Array.isArray(NEXUS_CONTEXTUAL_BEHAVIOR));
assert(NEXUS_CONTEXTUAL_BEHAVIOR.length>=8);
assert(prompt.length>500&&prompt.length<6000);
assert.match(prompt,/boa-fé/);
assert.match(prompt,/palavra isolada/);
assert.match(prompt,/ficcí|fictíci|fictício/i);
assert.match(prompt,/não presuma má intenção/i);
assert.match(prompt,/pedidos ambíguos/i);
assert.match(prompt,/histórico\/memória/);
assert.match(prompt,/não forneça aquela parte/i);
assert.match(prompt,/não recite um catálogo genérico/i);
assert(!prompt.includes("Você deve sempre recusar"));
console.log("contextual NEXUS chat behavior tests passed");
