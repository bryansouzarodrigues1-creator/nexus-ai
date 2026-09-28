import { WorkflowEntrypoint } from "cloudflare:workers";

const GENERAL_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const REASONING_MODEL = "@cf/openai/gpt-oss-120b";
const VERIFY_MODEL = "@cf/zai-org/glm-4.7-flash";

function extractText(data) {
  if (!data) return "";
  if (typeof data === "string") {
    try {
      return extractText(JSON.parse(data));
    } catch {
      return data.trim();
    }
  }

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

function parseJsonLoose(text, fallback = {}) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/i)?.[1];
  if (fenced) {
    try {
      return JSON.parse(fenced);
    } catch {}
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {}
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
    .slice(-24)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 10000),
    }));
}

function compactMemory(summary) {
  return String(summary || "").trim().slice(0, 16000);
}

async function runMessages(env, model, messages, options = {}) {
  const payload = {
    messages,
    max_tokens: options.maxTokens || 1800,
    temperature: options.temperature ?? 0.3,
    top_p: options.topP ?? 0.9,
  };

  if (options.webSearch) payload.web_search_options = {};
  if (options.responseFormat) payload.response_format = options.responseFormat;

  return env.AI.run(model, payload, {
    rejectIfBusy: true,
    extraHeaders: options.sessionId
      ? { "x-session-affinity": String(options.sessionId).slice(0, 128) }
      : undefined,
  });
}

async function runReasoning(env, messages, sessionId, effort = "high") {
  return env.AI.run(
    REASONING_MODEL,
    {
      input: messages,
      reasoning: { effort },
      max_output_tokens: 3600,
    },
    {
      rejectIfBusy: true,
      extraHeaders: sessionId
        ? { "x-session-affinity": String(sessionId).slice(0, 128) }
        : undefined,
    }
  );
}

export class NexusAgentWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = event.payload || {};
    const sessionId = String(payload.sessionId || "anonymous").slice(0, 128);
    const message = String(payload.message || "").trim().slice(0, 30000);
    const history = cleanHistory(payload.history);
    const memorySummary = compactMemory(payload.memorySummary);
    const taskId = String(payload.taskId || event.instanceId || "").slice(0, 100);

    const state = this.env.CONVERSATIONS?.getByName(sessionId);

    if (state) {
      await step.do("mark task running", async () => {
        await state.setTask(taskId, {
          status: "running",
          message: message.slice(0, 1000),
          startedAt: Date.now(),
        });
        return true;
      });
    }

    const plan = await step.do("plan", async () => {
      const result = await runMessages(
        this.env,
        GENERAL_MODEL,
        [
          {
            role: "system",
            content: [
              "Você é o Planner da NEXUS AI.",
              "Analise a tarefa e devolva SOMENTE JSON válido.",
              "Schema: {complexity:'low|medium|high', needsWeb:boolean, needsVerification:boolean, subproblems:string[], successCriteria:string[], risks:string[]}.",
              "Não resolva a tarefa ainda.",
            ].join(" "),
          },
          {
            role: "user",
            content:
              (memorySummary
                ? "MEMÓRIA ÚTIL:\n" + memorySummary + "\n\n"
                : "") +
              "PEDIDO:\n" +
              message,
          },
        ],
        {
          maxTokens: 800,
          temperature: 0.1,
          sessionId: sessionId + "-planner",
        }
      );

      const text = extractText(result);
      return parseJsonLoose(text, {
        complexity: "high",
        needsWeb: false,
        needsVerification: true,
        subproblems: [message],
        successCriteria: ["Responder completamente ao pedido."],
        risks: [],
      });
    });

    let research = "";
    if (plan?.needsWeb) {
      research = await step.do("research", async () => {
        const result = await runMessages(
          this.env,
          GENERAL_MODEL,
          [
            {
              role: "system",
              content:
                "Pesquise a web para apoiar a tarefa. Priorize fatos atuais, fontes confiáveis e contradições relevantes. Seja denso e inclua URLs/citações quando disponíveis.",
            },
            { role: "user", content: message },
          ],
          {
            webSearch: true,
            maxTokens: 1800,
            temperature: 0.2,
            sessionId: sessionId + "-research",
          }
        );
        return extractText(result).slice(0, 20000);
      });
    }

    const draft = await step.do("solve", async () => {
      const context = [
        {
          role: "system",
          content: [
            "Você é o Solver principal da NEXUS AI.",
            "Resolva a tarefa com máxima qualidade.",
            "Use o plano e os critérios como guia, mas não os mencione.",
            "Não invente resultados de ferramentas nem fatos.",
            "Se houver pesquisa, use-a como evidência e diferencie fato de inferência.",
            "Responda no idioma do usuário.",
          ].join(" "),
        },
        ...(memorySummary
          ? [
              {
                role: "system",
                content:
                  "MEMÓRIA COMPACTADA. Mensagens recentes vencem em caso de conflito:\n" +
                  memorySummary,
              },
            ]
          : []),
        ...history,
        {
          role: "user",
          content:
            "PEDIDO:\n" +
            message +
            "\n\nPLANO INTERNO:\n" +
            JSON.stringify(plan) +
            (research ? "\n\nPESQUISA:\n" + research : ""),
        },
      ];

      const result = await runReasoning(
        this.env,
        context,
        sessionId + "-solver",
        plan?.complexity === "low" ? "medium" : "high"
      );
      return extractText(result).slice(0, 50000);
    });

    const verification = await step.do("verify", async () => {
      const result = await runMessages(
        this.env,
        VERIFY_MODEL,
        [
          {
            role: "system",
            content: [
              "Você é o Verifier da NEXUS AI.",
              "Avalie a resposta contra o pedido e os critérios.",
              "Procure omissões, contradições, alucinações aparentes, erros lógicos e afirmações não sustentadas.",
              "Devolva SOMENTE JSON válido:",
              "{pass:boolean, score:number, issues:string[], repairInstructions:string}.",
              "score deve ser 0 a 1. pass=true apenas se score >= 0.82 e não houver falha material.",
            ].join(" "),
          },
          {
            role: "user",
            content:
              "PEDIDO:\n" +
              message +
              "\n\nCRITÉRIOS:\n" +
              JSON.stringify(plan?.successCriteria || []) +
              "\n\nRESPOSTA CANDIDATA:\n" +
              draft,
          },
        ],
        {
          maxTokens: 900,
          temperature: 0.05,
          sessionId: sessionId + "-verifier",
        }
      );

      return parseJsonLoose(extractText(result), {
        pass: true,
        score: 0.82,
        issues: [],
        repairInstructions: "",
      });
    });

    let finalAnswer = draft;
    let repaired = false;

    if (verification?.pass === false || Number(verification?.score || 0) < 0.82) {
      finalAnswer = await step.do("repair", async () => {
        const result = await runReasoning(
          this.env,
          [
            {
              role: "system",
              content:
                "Você é o Repairer da NEXUS AI. Reescreva a resposta corrigindo os problemas apontados pelo verificador. Preserve as partes corretas e não mencione este processo interno.",
            },
            {
              role: "user",
              content:
                "PEDIDO ORIGINAL:\n" +
                message +
                "\n\nRESPOSTA ANTERIOR:\n" +
                draft +
                "\n\nPROBLEMAS DETECTADOS:\n" +
                JSON.stringify(verification?.issues || []) +
                "\n\nINSTRUÇÕES DE REPARO:\n" +
                String(verification?.repairInstructions || ""),
            },
          ],
          sessionId + "-repair",
          "high"
        );

        return extractText(result).slice(0, 50000) || draft;
      });
      repaired = true;
    }

    const output = {
      answer: finalAnswer,
      plan: {
        complexity: plan?.complexity || "high",
        needsWeb: Boolean(plan?.needsWeb),
        subproblems: Array.isArray(plan?.subproblems) ? plan.subproblems : [],
      },
      verification: {
        pass: verification?.pass !== false,
        score: Number(verification?.score || 0),
        issues: Array.isArray(verification?.issues) ? verification.issues : [],
      },
      repaired,
      route: "agent",
      model: REASONING_MODEL,
      provider: "cloudflare",
    };

    if (state) {
      await step.do("persist result", async () => {
        await state.setTask(taskId, {
          status: "complete",
          completedAt: Date.now(),
          verification: output.verification,
          repaired,
          answerPreview: finalAnswer.slice(0, 4000),
        });
        await state.appendEvent({
          type: "agent-result",
          role: "assistant",
          content: finalAnswer.slice(0, 16000),
          meta: {
            taskId,
            verification: output.verification,
            repaired,
          },
        });
        return true;
      });
    }

    return output;
  }
}
