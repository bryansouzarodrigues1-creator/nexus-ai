// Deliberate manual call only. Not invoked by CI, deploy or production.
import { queryNexusCore } from "./core-client.mjs";

if (!process.argv.includes("--live")) {
  console.error("Use: NEXUS_CORE_BASE_URL=... NEXUS_CORE_API_KEY=... node nexus-core/smoke.mjs --live");
  process.exitCode = 2;
} else {
  const config = {
    baseUrl: process.env.NEXUS_CORE_BASE_URL || "http://127.0.0.1:18080",
    apiKey: process.env.NEXUS_CORE_API_KEY,
  };
  const started = Date.now();
  try {
    const result = await queryNexusCore(config, [
      { role: "system", content: "Você é NEXUS Core, em modo de teste. Responda de forma concisa em português." },
      { role: "user", content: "Quanto é 2 + 2? Responda em uma frase." },
    ], { timeoutMs: 90000, maxTokens: 120 });
    console.log(JSON.stringify({
      ok: true,
      model: result.model,
      latencyMs: Date.now() - started,
      answer: result.answer,
      finishReason: result.finishReason,
    }, null, 2));
  } catch (error) {
    console.error("Teste não concluído: " + (error.code || "UNEXPECTED") + " - " + error.message);
    process.exitCode = 1;
  }
}
