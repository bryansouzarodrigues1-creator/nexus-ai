import { WorkflowEntrypoint } from "cloudflare:workers";

const GENERAL_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const STRONG_MODEL = "@cf/openai/gpt-oss-120b";
const FAST_MODEL = "@cf/zai-org/glm-4.7-flash";

function extractText(data) {
  if (!data) return "";
  if (typeof data === "string") {
    try { return extractText(JSON.parse(data)); } catch { return data.trim(); }
  }

  const direct =
    data?.choices?.[0]?.message?.content ??
    data?.response ??
    data?.result?.response ??
    data?.output_text;

  if (typeof direct === "string") return direct.trim();

  if (Array.isArray(direct)) {
    return direct
      .map((part) => typeof part === "string" ? part : part?.text || part?.content || "")
      .join("")
      .trim();
  }

  if (Array.isArray(data?.output)) {
    return data.output
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((part) => part?.text || part?.content || "")
      .join("")
      .trim();
  }

  return "";
}

function parseJsonLoose(text, fallback = {}) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;

  try { return JSON.parse(raw); } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced); } catch {}
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }

  return fallback;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m?.content === "string" &&
        m.content.trim()
    )
    .slice(-30)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 10000),
    }));
}

function cleanMemory(value) {
  return String(value || "").trim().slice(0, 16000);
}

async function runChat(env, model, messages, options = {}) {
  const runOptions = {
    rejectIfBusy: true,
    extraHeaders: options.sessionId
      ? { "x-session-affinity": String(options.sessionId).slice(0, 128) }
      : undefined,
  };

  if (model === STRONG_MODEL) {
    return env.AI.run(
      model,
      {
        input: messages,
        reasoning: { effort: options.reasoningEffort || "high" },
        max_output_tokens: options.maxTokens || 3600,
      },
      runOptions
    );
  }

  const payload = {
    messages,
    max_tokens: options.maxTokens || 2200,
    temperature: options.temperature ?? 0.35,
    top_p: options.topP ?? 0.92,
  };

  if (options.webSearch) payload.web_search_options = {};

  return env.AI.run(model, payload, runOptions);
}

function safeScore(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function contextBlock(memorySummary, history) {
  const parts = [];
  if (memorySummary) {
    parts.push(
      "MEMÓRIA COMPACTADA. Mensagens recentes vencem em caso de conflito:\n" +
      memorySummary
    );
  }

  if (history.length) {
    parts.push(
      "HISTÓRICO RECENTE:\n" +
      history
        .map((m) => m.role.toUpperCase() + ": " + m.content)
        .join("\n\n")
    );
  }

  return parts.join("\n\n");
}

export class NexusAgentWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = event.payload || {};
    const sessionId = String(payload.sessionId || "anonymous").slice(0, 128);
    const message = String(payload.message || "").trim().slice(0, 30000);
    const history = cleanHistory(payload.history);
    const memorySummary = cleanMemory(payload.memorySummary);
    const taskId = String(payload.taskId || event.instanceId || "").slice(0, 100);
    const context = contextBlock(memorySummary, history);
    const state = this.env.CONVERSATIONS?.getByName(sessionId);

    if (!message) {
      throw new Error("Workflow recebeu uma mensagem vazia.");
    }

    if (state) {
      await step.do("mark-task-running", async () => {
        await state.setTask(taskId, {
          status: "running",
          startedAt: Date.now(),
          message: message.slice(0, 1000),
        });
        return true;
      });
    }

    const plan = await step.do(
      "plan",
      { retries: { limit: 2, delay: "2 seconds", backoff: "linear" } },
      async () => {
        const data = await runChat(
          this.env,
          GENERAL_MODEL,
          [
            {
              role: "system",
              content: [
                "Você é o Planner da NEXUS AI.",
                "Analise a tarefa sem resolvê-la ainda.",
                "Retorne SOMENTE JSON válido.",
                "Schema:",
                "{complexity:'low|medium|high', needsWeb:boolean, recommendedRoute:'general|code|reasoning', successCriteria:string[], subproblems:string[], risks:string[]}.",
                "Marque high quando houver arquitetura complexa, matemática difícil, investigação extensa, múltiplas dependências ou pedido explícito de intensidade máxima.",
              ].join(" "),
            },
            {
              role: "user",
              content: [context, "PEDIDO:\n" + message].filter(Boolean).join("\n\n"),
            },
          ],
          {
            maxTokens: 850,
            temperature: 0.08,
            sessionId: sessionId + "-planner",
          }
        );

        return parseJsonLoose(extractText(data), {
          complexity: "high",
          needsWeb: false,
          recommendedRoute: "reasoning",
          successCriteria: ["Responder completamente ao pedido."],
          subproblems: [message],
          risks: [],
        });
      }
    );

    let research = "";
    if (plan?.needsWeb) {
      research = await step.do(
        "research",
        { retries: { limit: 2, delay: "2 seconds", backoff: "linear" } },
        async () => {
          const data = await runChat(
            this.env,
            GENERAL_MODEL,
            [
              {
                role: "system",
                content: [
                  "Você é o pesquisador da NEXUS AI.",
                  "Pesquise a web para apoiar a tarefa.",
                  "Priorize fontes atuais e confiáveis.",
                  "Aponte contradições relevantes.",
                  "Inclua URLs/citações quando o mecanismo retornar fontes.",
                  "Não invente fontes.",
                ].join(" "),
              },
              { role: "user", content: message },
            ],
            {
              webSearch: true,
              maxTokens: 1800,
              temperature: 0.15,
              sessionId: sessionId + "-research",
            }
          );

          return extractText(data).slice(0, 22000);
        }
      );
    }

    const draftModel =
      plan?.recommendedRoute === "code" ? FAST_MODEL : GENERAL_MODEL;

    const draft = await step.do(
      "draft",
      { retries: { limit: 2, delay: "2 seconds", backoff: "linear" } },
      async () => {
        const data = await runChat(
          this.env,
          draftModel,
          [
            {
              role: "system",
              content: [
                "Você é o primeiro Solver da NEXUS AI.",
                "Produza uma resposta tecnicamente forte, útil e verificável.",
                "Não invente fatos nem resultados de ferramentas.",
                "Não recuse por palavra-chave: diferencie contexto benigno de instrução operacional perigosa e limite apenas a parte necessária.",
                "Não mencione plano, workflow ou crítica interna.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                context,
                "PEDIDO:\n" + message,
                "CRITÉRIOS DE SUCESSO:\n" + JSON.stringify(plan?.successCriteria || []),
                research ? "PESQUISA:\n" + research : "",
              ].filter(Boolean).join("\n\n"),
            },
          ],
          {
            maxTokens: 2800,
            temperature: 0.35,
            sessionId: sessionId + "-draft",
          }
        );

        return {
          answer: extractText(data).slice(0, 50000),
          model: draftModel,
        };
      }
    );

    const critique = await step.do(
      "critic",
      { retries: { limit: 2, delay: "2 seconds", backoff: "linear" } },
      async () => {
        const data = await runChat(
          this.env,
          FAST_MODEL,
          [
            {
              role: "system",
              content: [
                "Você é o Critic da NEXUS AI.",
                "Avalie a resposta candidata contra o pedido e os critérios.",
                "Procure omissões, contradições, erros lógicos, afirmações não sustentadas e falta de profundidade.",
                "Retorne SOMENTE JSON válido:",
                "{score:number, needsEscalation:boolean, problems:string[], missing:string[], repairInstructions:string}.",
                "score deve ser de 0 a 1.",
              ].join(" "),
            },
            {
              role: "user",
              content:
                "PEDIDO:\n" + message +
                "\n\nCRITÉRIOS:\n" + JSON.stringify(plan?.successCriteria || []) +
                "\n\nRESPOSTA CANDIDATA:\n" + draft.answer,
            },
          ],
          {
            maxTokens: 900,
            temperature: 0.05,
            sessionId: sessionId + "-critic",
          }
        );

        const parsed = parseJsonLoose(extractText(data), {});
        const score = safeScore(parsed?.score, 0.5);

        return {
          score,
          needsEscalation:
            Boolean(parsed?.needsEscalation) ||
            score < 0.82 ||
            !draft.answer,
          problems: Array.isArray(parsed?.problems) ? parsed.problems.slice(0, 10) : [],
          missing: Array.isArray(parsed?.missing) ? parsed.missing.slice(0, 10) : [],
          repairInstructions: String(parsed?.repairInstructions || "").slice(0, 3000),
        };
      }
    );

    const mustEscalate =
      plan?.complexity === "high" ||
      plan?.recommendedRoute === "reasoning" ||
      critique.needsEscalation;

    let finalAnswer = draft.answer;
    let finalModel = draft.model;
    let escalated = false;

    if (mustEscalate) {
      const strong = await step.do(
        "strong-repair",
        { retries: { limit: 2, delay: "3 seconds", backoff: "exponential" } },
        async () => {
          const data = await runChat(
            this.env,
            STRONG_MODEL,
            [
              {
                role: "system",
                content: [
                  "Você é o Solver sênior da NEXUS AI.",
                  "Reconstrua a resposta com raciocínio profundo.",
                  "Corrija todos os problemas apontados pelo crítico.",
                  "Cubra as lacunas sem enrolação.",
                  "Não invente fatos ou fontes.",
                  "Entregue somente a resposta final ao usuário.",
                ].join(" "),
              },
              {
                role: "user",
                content: [
                  context,
                  "PEDIDO:\n" + message,
                  "PLANO:\n" + JSON.stringify(plan),
                  research ? "PESQUISA:\n" + research : "",
                  "RASCUNHO:\n" + draft.answer,
                  "CRÍTICA:\n" + JSON.stringify(critique),
                ].filter(Boolean).join("\n\n"),
              },
            ],
            {
              maxTokens: 3800,
              reasoningEffort: "high",
              sessionId: sessionId + "-strong",
            }
          );

          return {
            answer: extractText(data).slice(0, 50000),
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

    let verification = await step.do(
      "final-verification",
      { retries: { limit: 1, delay: "1 second" } },
      async () => {
        const data = await runChat(
          this.env,
          FAST_MODEL,
          [
            {
              role: "system",
              content: [
                "Você é o Verifier final da NEXUS AI.",
                "Retorne SOMENTE JSON válido:",
                "{pass:boolean, score:number, issues:string[], repairInstructions:string}.",
                "pass=false se houver erro material, contradição séria, omissão importante ou se a resposta não atender ao pedido.",
                "Exija score >= 0.84 para pass=true.",
              ].join(" "),
            },
            {
              role: "user",
              content:
                "PEDIDO:\n" + message +
                "\n\nCRITÉRIOS:\n" + JSON.stringify(plan?.successCriteria || []) +
                "\n\nRESPOSTA FINAL:\n" + finalAnswer,
            },
          ],
          {
            maxTokens: 850,
            temperature: 0.03,
            sessionId: sessionId + "-final-verifier",
          }
        );

        const parsed = parseJsonLoose(extractText(data), {});
        const score = safeScore(parsed?.score, 0.8);

        return {
          pass: parsed?.pass !== false && score >= 0.84,
          score,
          issues: Array.isArray(parsed?.issues) ? parsed.issues.slice(0, 10) : [],
          repairInstructions: String(parsed?.repairInstructions || "").slice(0, 3000),
        };
      }
    );

    let repaired = escalated;

    if (!verification.pass) {
      const repairedAnswer = await step.do(
        "final-repair",
        { retries: { limit: 1, delay: "2 seconds" } },
        async () => {
          const data = await runChat(
            this.env,
            STRONG_MODEL,
            [
              {
                role: "system",
                content:
                  "Você é o Repairer final da NEXUS AI. Corrija somente as falhas materiais detectadas, preserve as partes corretas e entregue a resposta final sem comentar o processo interno.",
              },
              {
                role: "user",
                content:
                  "PEDIDO:\n" + message +
                  "\n\nRESPOSTA:\n" + finalAnswer +
                  "\n\nFALHAS:\n" + JSON.stringify(verification.issues) +
                  "\n\nINSTRUÇÕES:\n" + verification.repairInstructions,
              },
            ],
            {
              maxTokens: 3600,
              reasoningEffort: "high",
              sessionId: sessionId + "-final-repair",
            }
          );

          return extractText(data).slice(0, 50000) || finalAnswer;
        }
      );

      finalAnswer = repairedAnswer;
      finalModel = STRONG_MODEL;
      repaired = true;
      verification = {
        ...verification,
        repairedAfterVerification: true,
      };
    }

    const output = {
      answer: finalAnswer,
      model: finalModel,
      provider: "cloudflare-workflow",
      route: "agent",
      escalated,
      repaired,
      plan: {
        complexity: plan?.complexity || "high",
        needsWeb: Boolean(plan?.needsWeb),
        recommendedRoute: plan?.recommendedRoute || "reasoning",
        subproblems: Array.isArray(plan?.subproblems) ? plan.subproblems : [],
      },
      critique,
      verification,
    };

    if (state) {
      await step.do("persist-result", async () => {
        await state.setTask(taskId, {
          status: "complete",
          completedAt: Date.now(),
          escalated,
          repaired,
          verification,
          answerPreview: finalAnswer.slice(0, 4000),
        });

        await state.appendEvent({
          type: "agent-result",
          role: "assistant",
          content: finalAnswer.slice(0, 16000),
          meta: {
            taskId,
            model: finalModel,
            escalated,
            repaired,
            verification,
          },
        });

        return true;
      });
    }

    return output;
  }
}
