import { WorkflowEntrypoint } from "cloudflare:workers";

const GENERAL_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const FAST_MODEL = "@cf/zai-org/glm-4.7-flash";
const STRONG_MODEL = "@cf/openai/gpt-oss-120b";

function extractText(data) {
  const direct =
    data?.choices?.[0]?.message?.content ??
    data?.response ??
    data?.result?.response ??
    data?.output_text;

  if (typeof direct === "string") return direct.trim();

  if (Array.isArray(direct)) {
    return direct
      .map((part) =>
        typeof part === "string" ? part : part?.text || part?.content || ""
      )
      .join("")
      .trim();
  }

  if (Array.isArray(data?.output)) {
    return data.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .map((part) => part?.text || part?.content || "")
      .join("")
      .trim();
  }

  return "";
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const object = raw.match(/\{[\s\S]*\}/);
  if (object) {
    try {
      return JSON.parse(object[0]);
    } catch {}
  }

  return null;
}

async function runChat(ai, model, messages, options = {}) {
  if (model === STRONG_MODEL) {
    return ai.run(model, {
      input: messages,
      reasoning: { effort: options.reasoningEffort || "high" },
      max_output_tokens: options.maxTokens || 3200,
    });
  }

  return ai.run(model, {
    messages,
    max_tokens: options.maxTokens || 2200,
    temperature: options.temperature ?? 0.5,
    top_p: options.topP ?? 0.92,
  });
}

function buildContext(payload) {
  const parts = [];
  if (payload.memorySummary) {
    parts.push("MEMÓRIA COMPACTADA:\n" + String(payload.memorySummary).slice(0, 16000));
  }
  if (Array.isArray(payload.history) && payload.history.length) {
    parts.push(
      "HISTÓRICO RECENTE:\n" +
        payload.history
          .slice(-30)
          .map((m) => String(m.role || "user").toUpperCase() + ": " + String(m.content || "").slice(0, 8000))
          .join("\n\n")
    );
  }
  return parts.join("\n\n");
}

export class NexusReasoningWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = event.payload || {};
    const question = String(payload.message || "").trim();
    const context = buildContext(payload);

    const draft = await step.do(
      "draft",
      { retries: { limit: 2, delay: "2 seconds", backoff: "linear" } },
      async () => {
        const data = await runChat(this.env.AI, GENERAL_MODEL, [
          {
            role: "system",
            content:
              "Você é o primeiro solucionador do NEXUS. Produza uma resposta tecnicamente forte, direta e verificável. Não invente fatos. Considere o contexto fornecido.",
          },
          {
            role: "user",
            content: [context, "PERGUNTA:\n" + question].filter(Boolean).join("\n\n"),
          },
        ]);
        return {
          answer: extractText(data),
          model: GENERAL_MODEL,
        };
      }
    );

    const critique = await step.do(
      "critic",
      { retries: { limit: 2, delay: "2 seconds", backoff: "linear" } },
      async () => {
        const data = await runChat(this.env.AI, FAST_MODEL, [
          {
            role: "system",
            content:
              "Você é o verificador do NEXUS. Avalie a resposta candidata. Retorne SOMENTE JSON válido com: score de 0 a 1, needsEscalation boolean, problems array, missing array. Exija precisão, cobertura do pedido, ausência de contradições e honestidade sobre incerteza.",
          },
          {
            role: "user",
            content:
              "PERGUNTA:\n" +
              question +
              "\n\nRESPOSTA CANDIDATA:\n" +
              draft.answer,
          },
        ], { maxTokens: 800, temperature: 0.1 });

        const raw = extractText(data);
        const parsed = parseJsonLoose(raw) || {};
        const score = Math.max(0, Math.min(1, Number(parsed.score ?? 0.5)));

        return {
          score,
          needsEscalation:
            Boolean(parsed.needsEscalation) ||
            score < 0.78 ||
            !draft.answer,
          problems: Array.isArray(parsed.problems) ? parsed.problems.slice(0, 8) : [],
          missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 8) : [],
          model: FAST_MODEL,
        };
      }
    );

    let finalAnswer = draft.answer;
    let finalModel = draft.model;
    let escalated = false;

    if (critique.needsEscalation) {
      const strong = await step.do(
        "strong-repair",
        { retries: { limit: 2, delay: "3 seconds", backoff: "exponential" } },
        async () => {
          const data = await runChat(
            this.env.AI,
            STRONG_MODEL,
            [
              {
                role: "system",
                content:
                  "Você é o solucionador sênior do NEXUS. Reconstrua a resposta usando o contexto, a pergunta, a resposta candidata e a crítica. Corrija falhas factuais/lógicas, cubra lacunas e entregue apenas a resposta final ao usuário.",
              },
              {
                role: "user",
                content: [
                  context,
                  "PERGUNTA:\n" + question,
                  "RESPOSTA CANDIDATA:\n" + draft.answer,
                  "CRÍTICA:\n" + JSON.stringify(critique),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
            { maxTokens: 3400, reasoningEffort: "high" }
          );

          return {
            answer: extractText(data),
            model: STRONG_MODEL,
          };
        }
      );

      if (strong.answer) {
        finalAnswer = strong.answer;
        finalModel = strong.model;
        escalated = true;
      }
    }

    const verification = await step.do(
      "final-verification",
      { retries: { limit: 1, delay: "1 second" } },
      async () => {
        const data = await runChat(this.env.AI, FAST_MODEL, [
          {
            role: "system",
            content:
              "Você é o verificador final do NEXUS. Responda SOMENTE JSON: {\"pass\":boolean,\"score\":number,\"notes\":string}. Marque pass=false apenas se houver erro material, contradição séria ou se a resposta não atender ao pedido.",
          },
          {
            role: "user",
            content:
              "PERGUNTA:\n" +
              question +
              "\n\nRESPOSTA FINAL:\n" +
              finalAnswer,
          },
        ], { maxTokens: 500, temperature: 0.05 });

        const parsed = parseJsonLoose(extractText(data)) || {};
        return {
          pass: parsed.pass !== false,
          score: Math.max(0, Math.min(1, Number(parsed.score ?? 0.8))),
          notes: String(parsed.notes || "").slice(0, 1000),
          model: FAST_MODEL,
        };
      }
    );

    return {
      answer: finalAnswer,
      model: finalModel,
      provider: "cloudflare-workflow",
      escalated,
      draftModel: draft.model,
      critic: critique,
      verification,
    };
  }
}
