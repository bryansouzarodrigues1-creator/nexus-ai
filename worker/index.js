import { InferenceClient } from "@huggingface/inference";
export { ConversationState } from "./conversation-state.js";
export { NexusAgentWorkflow } from "./agent-workflow.js";


const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const VERSION = "2.1.0";

const CF_GENERAL_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const CF_REASONING_MODEL = "@cf/openai/gpt-oss-120b";
const CF_CODE_MODEL = "@cf/zai-org/glm-4.7-flash";
const CF_VISION_MODEL = "@cf/qwen/qwen3.8-27b";
const CF_IMAGE_FAST_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const CF_IMAGE_QUALITY_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

const NEXUS_OPEN_BEHAVIOR = [
  "Adote uma postura ampla, adulta e contextual. Um tema sensível por si só não é motivo para recusar.",
  "Pode discutir normalmente crime, violência, drogas, hacking, armas, sexualidade, política, religião, extremismo, autolesão, manipulação, fraude e outros assuntos delicados quando o pedido for informativo, histórico, jornalístico, acadêmico, analítico, preventivo, fictício, crítico ou de redução de risco.",
  "Não trate palavras-chave como intenção. Analise o objetivo real do usuário e o nível de operacionalidade do pedido.",
  "Quando houver ambiguidade razoável, faça a interpretação benigna mais plausível ou peça contexto curto; não dispare uma recusa automática.",
  "Não forneça instruções operacionais que aumentem materialmente a capacidade de causar dano grave, cometer violência real, abuso, invasão criminosa, fraude, roubo ou outra conduta perigosa concreta.",
  "Se apenas uma parte do pedido ultrapassar esse limite, restrinja somente essa parte e responda integralmente ao restante.",
  "Evite respostas enlatadas como 'Desculpe, não posso ajudar com isso' quando houver qualquer parte útil que possa ser respondida.",
  "Quando precisar limitar algo, seja breve, específico e continue útil com contexto, explicação, prevenção, alternativas legais, análise, ficção ou informação de alto nível.",
  "Não moralize, não repreenda o usuário e não cite políticas internas.",
].join(" ");

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const items = history
    .filter(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m?.content === "string" &&
        m.content.trim()
    )
    .slice(-60)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 12000),
    }));

  let total = 0;
  const kept = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const size = items[i].content.length;
    if (total + size > 100000 && kept.length >= 12) break;
    kept.unshift(items[i]);
    total += size;
  }
  return kept;
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] || "application/octet-stream" });
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseProviderError(raw) {
  const text = String(raw || "");
  try {
    const parsed = JSON.parse(text);
    return String(
      parsed?.error?.message ||
      parsed?.error ||
      parsed?.message ||
      text
    ).slice(0, 1200);
  } catch {
    if (/<!doctype|<html/i.test(text)) {
      return "O provedor devolveu uma página HTML de erro em vez de JSON.";
    }
    return text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200);
  }
}

function conversationStub(env, sessionId) {
  if (!env.CONVERSATIONS || !sessionId) return null;
  try {
    return env.CONVERSATIONS.getByName(String(sessionId).slice(0, 128));
  } catch {
    return null;
  }
}

async function getServerConversation(env, sessionId) {
  const stub = conversationStub(env, sessionId);
  if (!stub) return null;
  try {
    return await stub.getSnapshot();
  } catch {
    return null;
  }
}

async function appendServerEvent(env, sessionId, event) {
  const stub = conversationStub(env, sessionId);
  if (!stub) return;
  try {
    await stub.appendEvent(event);
  } catch {}
}

async function recordServerMetric(env, sessionId, metric) {
  const stub = conversationStub(env, sessionId);
  if (!stub) return;
  try {
    await stub.recordMetric(metric);
  } catch {}
}

async function setServerSummary(env, sessionId, summary) {
  const stub = conversationStub(env, sessionId);
  if (!stub) return;
  try {
    await stub.setSummary(summary);
  } catch {}
}

async function handleAgentStart(request, env) {
  if (!env.NEXUS_AGENT) {
    return json({ error: "Workflow de agente não configurado." }, 503);
  }

  const body = await request.json();
  const message = String(body.message || "").trim();
  const sessionId = String(body.sessionId || "").trim().slice(0, 128);
  const history = cleanHistory(body.history);
  const memorySummary = String(body.memorySummary || "").trim().slice(0, 16000);

  if (!message) return json({ error: "Mensagem vazia." }, 400);
  if (!sessionId) return json({ error: "sessionId obrigatório." }, 400);

  const serverState = await getServerConversation(env, sessionId);
  const effectiveSummary =
    String(serverState?.summary || "").trim() || memorySummary;

  const taskId = crypto.randomUUID();

  try {
    const instance = await env.NEXUS_AGENT.create({
      id: taskId,
      params: {
        taskId,
        sessionId,
        message,
        history,
        memorySummary: effectiveSummary,
      },
      retention: {
        successRetention: "1 day",
        errorRetention: "3 days",
      },
    });

    const stub = conversationStub(env, sessionId);
    if (stub) {
      try {
        await stub.setTask(taskId, {
          status: "queued",
          message: message.slice(0, 1000),
          createdAt: Date.now(),
        });
        await stub.appendEvent({
          type: "agent-request",
          role: "user",
          content: message,
          meta: { taskId },
        });
      } catch {}
    }

    return json({
      id: instance.id,
      status: "queued",
      route: "agent",
    }, 202);
  } catch (error) {
    return json(
      {
        error: "Não consegui iniciar o agente.",
        provider_error: error?.message || String(error),
      },
      502
    );
  }
}

async function handleAgentStatus(id, env) {
  if (!env.NEXUS_AGENT) {
    return json({ error: "Workflow de agente não configurado." }, 503);
  }

  const taskId = String(id || "").trim().slice(0, 100);
  if (!taskId) return json({ error: "ID inválido." }, 400);

  try {
    const instance = await env.NEXUS_AGENT.get(taskId);
    const details = await instance.status();
    return json({
      id: instance.id,
      status: details.status,
      output: details.output || null,
      error: details.error || null,
      rollback: details.rollback || null,
    });
  } catch (error) {
    return json(
      {
        error: "Workflow não encontrado ou indisponível.",
        provider_error: error?.message || String(error),
      },
      404
    );
  }
}

async function searchWeb(query, env) {
  if (!env.SEARXNG_URL) return { results: [], unavailable: true };

  const base = env.SEARXNG_URL.replace(/\/$/, "");
  const url =
    base +
    "/search?q=" +
    encodeURIComponent(query) +
    "&format=json&language=pt-BR&safesearch=1";

  const res = await fetch(url, {
    headers: { "User-Agent": "NEXUS-AI/" + VERSION },
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      "Pesquisa web respondeu " + res.status + ": " + parseProviderError(raw)
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "A pesquisa web devolveu uma resposta inválida em vez de JSON."
    );
  }

  return {
    unavailable: false,
    results: (data.results || []).slice(0, 8).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || "",
    })),
  };
}

async function handleStatus(env) {
  return json({
    ok: true,
    version: VERSION,
    behaviorMode: "open-contextual",
    architecture: {
      durableConversationState: Boolean(env.CONVERSATIONS),
      agentWorkflow: Boolean(env.NEXUS_AGENT),
      orchestration: "router+durable-state+planner-solver-critic-verifier",
      visualEditing: "edit-spec+reference+verification+best-of-two-retry",
      toolRegistry: ["web_search", "calculator", "conversation_context"],
      fakeToolsAllowed: false,
    },
    providers: {
      workersAI: Boolean(env.AI),
      huggingFace: Boolean(env.HF_TOKEN),
      chat: Boolean(env.AI || env.HF_TOKEN),
      search: Boolean(env.AI || env.SEARXNG_URL),
      promptExpansion: Boolean(env.AI || env.HF_TOKEN),
      vision: Boolean(env.AI || env.HF_TOKEN),
      files: true,
      image: Boolean(env.AI || env.HF_TOKEN),
      imageEdit: Boolean(env.AI || env.HF_TOKEN),
      video: Boolean(env.HF_TOKEN),
      durableState: Boolean(env.CONVERSATIONS),
      agentWorkflow: Boolean(env.NEXUS_AGENT),
    },
    models: {
      chatGeneral: env.CF_GENERAL_MODEL || CF_GENERAL_MODEL,
      chatReasoning: env.CF_REASONING_MODEL || CF_REASONING_MODEL,
      chatCode: env.CF_CODE_MODEL || CF_CODE_MODEL,
      chatFallback: env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest",
      promptExpander: env.CF_PROMPT_MODEL || CF_GENERAL_MODEL,
      vision: env.CF_VISION_MODEL || CF_VISION_MODEL,
      imageFast: env.CF_IMAGE_FAST_MODEL || CF_IMAGE_FAST_MODEL,
      imageQuality: env.CF_IMAGE_QUALITY_MODEL || CF_IMAGE_QUALITY_MODEL,
      imageFallback: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      imageEditFallback:
        env.HF_IMAGE_EDIT_MODEL || "black-forest-labs/FLUX.1-Kontext-dev",
      videoFast:
        env.HF_VIDEO_MODEL_FAST ||
        "Lightricks/LTX-Video-0.9.8-13B-distilled",
      videoQuality:
        env.HF_VIDEO_MODEL_QUALITY ||
        "tencent/HunyuanVideo",
      videoFallback:
        env.HF_VIDEO_MODEL ||
        "Wan-AI/Wan2.1-T2V-1.3B",
      imageVideo:
        env.HF_IMAGE_VIDEO_MODEL ||
        "Lightricks/LTX-Video",
      imageVideoFallback:
        env.HF_IMAGE_VIDEO_FALLBACK_MODEL ||
        "Wan-AI/Wan2.1-I2V-14B-720P",
    },
  });
}

async function runHfChat(model, messages, env, options = {}) {
  if (!env.HF_TOKEN) {
    return {
      ok: false,
      status: 503,
      raw: "HF_TOKEN não configurado.",
      model,
      provider: "huggingface",
    };
  }

  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.HF_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: options.maxTokens || 1800,
      temperature: options.temperature ?? 0.72,
      top_p: options.topP ?? 0.95,
      messages,
    }),
  });

  const raw = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    raw,
    model,
    provider: "huggingface",
  };
}

function extractModelText(rawOrData) {
  let data = rawOrData;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return ""; }
  }

  const direct =
    data?.choices?.[0]?.message?.content ??
    data?.response ??
    data?.result?.response ??
    data?.output_text;

  if (typeof direct === "string") return direct.trim();

  if (Array.isArray(direct)) {
    return direct
      .map((part) => typeof part === "string" ? part : (part?.text || part?.content || ""))
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

function extractSources(data) {
  const raw =
    data?.citations ||
    data?.choices?.[0]?.message?.citations ||
    data?.response?.citations ||
    data?.result?.citations ||
    [];

  const annotations =
    data?.choices?.[0]?.message?.annotations ||
    data?.annotations ||
    [];

  const direct = Array.isArray(raw)
    ? raw.map((item, i) => {
        if (typeof item === "string") {
          return { title: "Fonte " + (i + 1), url: item };
        }
        return {
          title: item?.title || item?.name || item?.url || ("Fonte " + (i + 1)),
          url: item?.url || item?.href || "",
        };
      })
    : [];

  const annotated = Array.isArray(annotations)
    ? annotations.map((item, i) => {
        const citation = item?.url_citation || item?.citation || item;
        return {
          title:
            citation?.title ||
            citation?.name ||
            citation?.url ||
            ("Fonte " + (i + 1)),
          url: citation?.url || citation?.href || "",
        };
      })
    : [];

  const seen = new Set();
  return [...direct, ...annotated]
    .filter((x) => x.url && !seen.has(x.url) && seen.add(x.url))
    .slice(0, 10);
}

function chooseChatRoute(message, mode, attachment) {
  const text = String(message || "").toLowerCase();

  if (attachment?.kind === "image") {
    return {
      key: "vision",
      model: CF_VISION_MODEL,
      reason: "visão multimodal",
      maxTokens: 2400,
    };
  }

  if (
    attachment?.kind === "text" &&
    /\.(js|jsx|ts|tsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|php|rb|swift|kt|kts|sql|sh|ps1|css|html|htm|vue|svelte)$/i.test(attachment?.name || "")
  ) {
    return {
      key: "code",
      model: CF_CODE_MODEL,
      reason: "arquivo de código",
      maxTokens: 2800,
    };
  }

  if (mode === "search") {
    return {
      key: "search",
      model: CF_GENERAL_MODEL,
      reason: "pesquisa web",
      maxTokens: 2200,
    };
  }

  const codeSignals =
    /(```|function\s|class\s|const\s|let\s|var\s|import\s|export\s|typescript|javascript|python|react|vite|node\.?js|sql|regex|api|bug|erro de código|código|programa|programação|refator|debug|github|worker)/i;

  if (codeSignals.test(message)) {
    return {
      key: "code",
      model: CF_CODE_MODEL,
      reason: "código",
      maxTokens: 2600,
    };
  }

  const sensitiveContextSignals =
    /(crime|roubo|roubar|assalto|assaltar|furto|fraude|golpe|droga|cocaína|cocaina|maconha|arma|pistola|fuzil|bomba|explosivo|hack|hacking|malware|ransomware|phishing|sexo|sexual|porn|suicid|autoles|terroris|extremis|violência|violencia|matar|morte|tortura|manipula|chantag|sequestro)/i;

  if (sensitiveContextSignals.test(message)) {
    return {
      key: "open",
      model: CF_CODE_MODEL,
      reason: "contexto sensível analisado sem bloqueio por palavra-chave",
      maxTokens: 2400,
    };
  }

  const deepSignals =
    /(intensidade máxima|pense muito|raciocínio|raciocinio|analise profundamente|análise profunda|compare em detalhes|planeje|estratégia|estrategia|arquitetura|otimize|investigue|prove|deduza|matemát|fisic|científic|trade.?off|complex|passo a passo|diagnóstico|diagnostico)/i;

  if (deepSignals.test(message) || String(message || "").length > 900) {
    return {
      key: "deep",
      model: CF_REASONING_MODEL,
      reason: "raciocínio profundo",
      maxTokens: 3000,
      reasoningEffort: "high",
    };
  }

  return {
    key: "general",
    model: CF_GENERAL_MODEL,
    reason: "geral",
    maxTokens: 2000,
  };
}

async function runCloudflareChat(model, messages, env, options = {}) {
  if (!env.AI) {
    return {
      ok: false,
      status: 503,
      raw: "Workers AI binding não disponível.",
      model,
      provider: "cloudflare",
    };
  }

  const runOptions = { rejectIfBusy: true };
  if (options.sessionId) {
    runOptions.extraHeaders = {
      "x-session-affinity": String(options.sessionId).slice(0, 128),
    };
  }

  try {
    let payload;

    if (model === CF_REASONING_MODEL && options.reasoningEffort) {
      payload = {
        input: messages,
        reasoning: { effort: options.reasoningEffort },
        max_output_tokens: options.maxTokens || 3000,
      };
    } else {
      payload = {
        messages,
        max_tokens: options.maxTokens || 2000,
        temperature: options.temperature ?? 0.68,
        top_p: options.topP ?? 0.94,
      };

      if (options.webSearch) {
        payload.web_search_options = {};
      }
    }

    const data = await env.AI.run(model, payload, runOptions);

    return {
      ok: true,
      status: 200,
      raw: JSON.stringify(data),
      model,
      provider: "cloudflare",
    };
  } catch (error) {
    return {
      ok: false,
      status: Number(error?.status || error?.code || 503),
      raw: error?.message || String(error),
      model,
      provider: "cloudflare",
    };
  }
}

async function runTextChat(messages, env, options = {}) {
  let lastAttempt = null;
  let cloudflareFailure = null;

  if (env.AI) {
    const primary = options.cloudflareModel || CF_GENERAL_MODEL;
    const fallbacks = [];

    if (primary !== CF_GENERAL_MODEL) fallbacks.push(CF_GENERAL_MODEL);
    if (primary !== CF_CODE_MODEL && !fallbacks.includes(CF_CODE_MODEL)) fallbacks.push(CF_CODE_MODEL);

    for (const model of [primary, ...fallbacks]) {
      const attempt = await runCloudflareChat(model, messages, env, {
        ...options,
        reasoningEffort: model === CF_REASONING_MODEL ? (options.reasoningEffort || "medium") : undefined,
      });
      lastAttempt = attempt;
      if (attempt.ok) return attempt;
      cloudflareFailure = attempt;
    }

    if (options.cloudflareOnly) return lastAttempt;
  }

  if (env.HF_TOKEN) {
    const primary =
      options.hfModel ||
      env.HF_CHAT_MODEL ||
      "openai/gpt-oss-120b:cheapest";

    let attempt = await runHfChat(primary, messages, env, options);
    lastAttempt = attempt;
    if (attempt.ok) return attempt;

    if (primary !== "openai/gpt-oss-20b:fastest") {
      attempt = await runHfChat(
        "openai/gpt-oss-20b:fastest",
        messages,
        env,
        options
      );
      lastAttempt = attempt;
      if (attempt.ok) return attempt;
    }
  }

  if (lastAttempt && cloudflareFailure && lastAttempt.provider === "huggingface") {
    return {
      ...lastAttempt,
      raw:
        "Cloudflare Workers AI: " +
        parseProviderError(cloudflareFailure.raw) +
        " | Hugging Face: " +
        parseProviderError(lastAttempt.raw),
    };
  }

  return lastAttempt || cloudflareFailure || {
    ok: false,
    status: 503,
    raw: "Nenhum provedor de chat disponível.",
    model: "",
    provider: "",
  };
}

function generationError(error) {
  const raw =
    error?.message ||
    error?.cause?.message ||
    error?.response?.statusText ||
    String(error || "Erro desconhecido do provedor.");

  const text = String(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/depleted.*credits|monthly included credits|free allocation|account limited|3036|quota|credit|payment|required|insufficient|402/i.test(text)) {
    return {
      status: 429,
      kind: "quota",
      message:
        "A cota do provedor acabou para esta operação.",
    };
  }
  if (/rate.?limit|too many|429|capacity temporarily exceeded|3040/i.test(text)) {
    return {
      status: 429,
      kind: "rate-limit",
      message: "O provedor está temporariamente ocupado. Tente novamente em instantes.",
    };
  }
  if (/not found|404|model.*unavailable|no provider/i.test(text)) {
    return {
      status: 503,
      kind: "unavailable",
      message: "O modelo solicitado não está disponível agora.",
    };
  }
  if (/timeout|timed out|504|408/i.test(text)) {
    return {
      status: 504,
      kind: "timeout",
      message: "O provedor demorou demais para responder.",
    };
  }
  if (/<!doctype|<html/i.test(raw)) {
    return {
      status: 502,
      kind: "bad-response",
      message: "O provedor devolveu uma página de erro em vez do resultado esperado.",
    };
  }

  return {
    status: 502,
    kind: "provider",
    message: text.slice(0, 1000) || "Falha no provedor de geração.",
  };
}

async function expandCreativePrompt({
  kind,
  prompt,
  history,
  previousPrompt,
  hasSourceImage,
  sessionId,
  env,
}) {
  const original = String(prompt || "").trim();
  if (!original || (!env.AI && !env.HF_TOKEN)) {
    return { prompt: original, expanded: false, model: null };
  }

  const recent = cleanHistory(history).slice(-10);
  const system = [
    "Você é o diretor criativo interno da NEXUS AI.",
    "Transforme pedidos visuais curtos em prompts de alta fidelidade sem mudar a intenção, os personagens, os objetos, as cores nem o estilo pedido.",
    "Não force fotorealismo quando o usuário pedir ilustração, anime, desenho, pintura, 3D ou outro estilo.",
    "Preserve rigorosamente tudo que já existe quando houver imagem de referência e mude apenas o que o usuário pediu.",
    "Devolva somente o prompt final, sem explicações, listas ou comentários.",
    kind === "image"
      ? "Para imagem, detalhe composição, enquadramento, iluminação, ambiente, materiais, textura, profundidade e atmosfera apenas quando útil."
      : "Para vídeo, detalhe ação ao longo do tempo, movimento físico, movimento de câmera, enquadramento, iluminação e continuidade temporal.",
    hasSourceImage
      ? "Existe imagem de referência: trate a tarefa como edição/continuação e preserve a identidade visual do sujeito."
      : "Não existe imagem de referência: descreva a cena completa de forma coerente.",
  ].join(" ");

  const parts = [];
  if (previousPrompt) {
    parts.push(
      "Contexto visual anterior: " + String(previousPrompt).slice(0, 4500)
    );
  }
  parts.push("Pedido atual: " + original);

  const messages = [
    { role: "system", content: system },
    ...recent,
    { role: "user", content: parts.join("\n\n") },
  ];

  const attempt = await runTextChat(messages, env, {
    cloudflareModel: env.CF_PROMPT_MODEL || CF_GENERAL_MODEL,
    maxTokens: kind === "video" ? 650 : 500,
    temperature: 0.58,
    topP: 0.9,
    sessionId,
    cloudflareOnly: Boolean(env.AI),
  });

  if (!attempt.ok) {
    return { prompt: original, expanded: false, model: null };
  }

  const expanded = extractModelText(attempt.raw);
  if (!expanded || expanded.length < Math.min(20, original.length)) {
    return { prompt: original, expanded: false, model: attempt.model };
  }

  return {
    prompt: expanded.slice(0, 6500),
    expanded: expanded !== original,
    model: attempt.model,
  };
}


function parseJsonLooseText(text, fallback = {}) {
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

async function describeVisualImage(blob, env, label = "imagem") {
  if (!env.AI || !blob) return "";
  try {
    const converted = await env.AI.toMarkdown(
      { name: label + ".jpg", blob },
      {
        conversionOptions: {
          output: { format: "markdown" },
          image: { descriptionLanguage: "pt" },
        },
      }
    );

    const item = Array.isArray(converted) ? converted[0] : converted;
    if (!item || item.format === "error") return "";
    return String(item.data || "").trim().slice(0, 18000);
  } catch {
    return "";
  }
}

async function buildVisualEditSpec({
  sourceDescription,
  prompt,
  previousPrompt,
  sessionId,
  env,
}) {
  if (!sourceDescription || !env.AI) return null;

  const attempt = await runTextChat(
    [
      {
        role: "system",
        content: [
          "Você é o Edit Planner visual da NEXUS AI.",
          "Transforme o pedido em uma especificação conservadora de edição.",
          "A prioridade absoluta é preservar a imagem original e alterar somente o que foi pedido.",
          "Retorne SOMENTE JSON válido no schema:",
          "{preserve:string[], modify:string[], forbiddenChanges:string[], identityAnchor:string, compositionAnchor:string, styleAnchor:string}.",
          "preserve deve listar sujeito principal, identidade, pose, enquadramento, cenário e estilo que não podem mudar.",
          "forbiddenChanges deve listar alterações que seriam erro.",
          "Não invente mudanças que o usuário não pediu.",
        ].join(" "),
      },
      {
        role: "user",
        content:
          "DESCRIÇÃO DA IMAGEM ORIGINAL:\n" +
          sourceDescription +
          "\n\nPEDIDO ATUAL:\n" +
          prompt +
          (previousPrompt ? "\n\nCONTEXTO VISUAL ANTERIOR:\n" + previousPrompt : ""),
      },
    ],
    env,
    {
      cloudflareModel: CF_CODE_MODEL,
      maxTokens: 850,
      temperature: 0.05,
      topP: 0.85,
      sessionId: sessionId ? sessionId + "-edit-spec" : "",
      cloudflareOnly: true,
    }
  );

  if (!attempt?.ok) return null;
  const parsed = parseJsonLooseText(extractModelText(attempt.raw), null);
  if (!parsed || typeof parsed !== "object") return null;

  const arr = (value, max = 12) =>
    Array.isArray(value)
      ? value.map((x) => String(x).trim()).filter(Boolean).slice(0, max)
      : [];

  return {
    preserve: arr(parsed.preserve),
    modify: arr(parsed.modify),
    forbiddenChanges: arr(parsed.forbiddenChanges),
    identityAnchor: String(parsed.identityAnchor || "").slice(0, 1500),
    compositionAnchor: String(parsed.compositionAnchor || "").slice(0, 1500),
    styleAnchor: String(parsed.styleAnchor || "").slice(0, 1500),
  };
}

function buildStrictEditPrompt(userPrompt, spec) {
  if (!spec) {
    return [
      "Edit image 0.",
      "Preserve the exact same main subject, identity, pose, framing, composition, background, colors and visual style unless the user explicitly asks to change them.",
      "Change only what the user requested.",
      "Do not redesign, replace or reinterpret the scene.",
      "USER REQUEST:",
      userPrompt,
    ].join(" ");
  }

  return [
    "Edit image 0 conservatively.",
    "The output must remain recognizably the same original image.",
    spec.identityAnchor ? "IDENTITY ANCHOR: " + spec.identityAnchor : "",
    spec.compositionAnchor ? "COMPOSITION ANCHOR: " + spec.compositionAnchor : "",
    spec.styleAnchor ? "STYLE ANCHOR: " + spec.styleAnchor : "",
    spec.preserve.length ? "MUST PRESERVE: " + spec.preserve.join("; ") : "",
    spec.modify.length ? "MODIFY ONLY: " + spec.modify.join("; ") : "",
    spec.forbiddenChanges.length
      ? "FORBIDDEN CHANGES: " + spec.forbiddenChanges.join("; ")
      : "",
    "USER REQUEST: " + userPrompt,
    "Do not add unrelated people, objects, text, scenery or stylistic changes.",
  ].filter(Boolean).join(" ");
}

async function verifyVisualEdit({
  originalDescription,
  resultBlob,
  prompt,
  spec,
  sessionId,
  env,
}) {
  if (!env.AI || !originalDescription || !resultBlob) {
    return {
      verified: false,
      pass: true,
      score: null,
      retryInstruction: "",
      issues: [],
    };
  }

  const resultDescription = await describeVisualImage(
    resultBlob,
    env,
    "resultado-editado"
  );

  if (!resultDescription) {
    return {
      verified: false,
      pass: true,
      score: null,
      retryInstruction: "",
      issues: [],
    };
  }

  const attempt = await runTextChat(
    [
      {
        role: "system",
        content: [
          "Você é o Visual Verifier da NEXUS AI.",
          "Compare descrição original, pedido e descrição do resultado.",
          "Julgue preservação de identidade, composição, pose, cenário e estilo, além do cumprimento do pedido.",
          "Uma edição que troca o sujeito, inventa pessoas/objetos ou muda o cenário sem pedido deve falhar.",
          "Retorne SOMENTE JSON:",
          "{pass:boolean, score:number, identity:number, composition:number, requestFulfillment:number, unwantedChanges:string[], issues:string[], retryInstruction:string}.",
          "Todos os scores vão de 0 a 1.",
          "pass=true somente se score >= 0.80, identity >= 0.80, composition >= 0.72 e requestFulfillment >= 0.72.",
        ].join(" "),
      },
      {
        role: "user",
        content:
          "ORIGINAL:\n" +
          originalDescription +
          "\n\nPEDIDO:\n" +
          prompt +
          "\n\nSPEC:\n" +
          JSON.stringify(spec || {}) +
          "\n\nRESULTADO:\n" +
          resultDescription,
      },
    ],
    env,
    {
      cloudflareModel: CF_CODE_MODEL,
      maxTokens: 900,
      temperature: 0.03,
      topP: 0.8,
      sessionId: sessionId ? sessionId + "-visual-verify" : "",
      cloudflareOnly: true,
    }
  );

  if (!attempt?.ok) {
    return {
      verified: false,
      pass: true,
      score: null,
      retryInstruction: "",
      issues: [],
    };
  }

  const parsed = parseJsonLooseText(extractModelText(attempt.raw), {});
  const score = Math.max(0, Math.min(1, Number(parsed?.score ?? 0.5)));
  const identity = Math.max(0, Math.min(1, Number(parsed?.identity ?? score)));
  const composition = Math.max(0, Math.min(1, Number(parsed?.composition ?? score)));
  const requestFulfillment = Math.max(
    0,
    Math.min(1, Number(parsed?.requestFulfillment ?? score))
  );

  const pass =
    parsed?.pass !== false &&
    score >= 0.8 &&
    identity >= 0.8 &&
    composition >= 0.72 &&
    requestFulfillment >= 0.72;

  return {
    verified: true,
    pass,
    score,
    identity,
    composition,
    requestFulfillment,
    retryInstruction: String(parsed?.retryInstruction || "").slice(0, 2500),
    issues: Array.isArray(parsed?.issues)
      ? parsed.issues.map((x) => String(x)).slice(0, 10)
      : [],
    unwantedChanges: Array.isArray(parsed?.unwantedChanges)
      ? parsed.unwantedChanges.map((x) => String(x)).slice(0, 10)
      : [],
    resultDescription,
  };
}

async function runCloudflareImage({ prompt, sourceImage, quality, env }) {
  if (!env.AI) throw new Error("Workers AI não disponível.");

  const model = quality === "quality"
    ? (env.CF_IMAGE_QUALITY_MODEL || CF_IMAGE_QUALITY_MODEL)
    : (env.CF_IMAGE_FAST_MODEL || CF_IMAGE_FAST_MODEL);

  const form = new FormData();
  if (sourceImage) {
    form.append("input_image_0", sourceImage, "reference.jpg");
  }
  form.append("prompt", prompt);
  form.append("width", "1024");
  form.append("height", "1024");
  form.append("guidance", sourceImage ? "4.0" : "3.5");

  const serialized = new Response(form);
  const result = await env.AI.run(model, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get("content-type"),
    },
  });

  const base64 =
    result?.image ||
    result?.result?.image ||
    result?.data?.image;

  if (!base64 || typeof base64 !== "string") {
    throw new Error("Workers AI não retornou uma imagem válida.");
  }

  return {
    bytes: base64ToBytes(base64),
    model,
  };
}

async function convertDocumentAttachment(attachment, env) {
  if (!env.AI) throw new Error("Conversão de documentos requer Workers AI.");
  const blob = dataUrlToBlob(attachment?.dataUrl);
  if (!blob) throw new Error("Documento inválido.");

  const converted = await env.AI.toMarkdown(
    {
      name: String(attachment.name || "documento"),
      blob,
    },
    {
      conversionOptions: {
        output: { format: "markdown" },
        pdf: { metadata: false },
        image: { descriptionLanguage: "pt" },
      },
    }
  );

  const item = Array.isArray(converted) ? converted[0] : converted;
  if (!item || item.format === "error") {
    throw new Error(item?.error || "Não consegui converter o documento.");
  }

  return String(item.data || "").slice(0, 120000);
}

async function handleChat(request, env) {
  const body = await request.json();
  const message = String(body.message || "").trim();
  const mode = body.mode === "search" ? "search" : "chat";
  const history = cleanHistory(body.history);
  const attachment = body.attachment || null;
  let memorySummary = String(body.memorySummary || "").trim().slice(0, 16000);
  const sessionId = String(body.sessionId || "").slice(0, 128);

  const serverState = sessionId
    ? await getServerConversation(env, sessionId)
    : null;

  if (!memorySummary && serverState?.summary) {
    memorySummary = String(serverState.summary).slice(0, 16000);
  }

  if (!message) return json({ error: "Mensagem vazia." }, 400);
  if (!env.AI && !env.HF_TOKEN)
    return json({ error: "Nenhum provedor de IA está configurado." }, 503);

  if (sessionId) {
    await appendServerEvent(env, sessionId, {
      type: "chat-request",
      role: "user",
      content: message,
      meta: { mode },
    });
  }

  const route = chooseChatRoute(message, mode, attachment);

  const system = [
    "Você é NEXUS AI, um assistente geral de alta qualidade, direto, curioso e pouco propenso a recusas desnecessárias.",
    "Use todo o histórico fornecido para manter continuidade real e entender referências curtas.",
    "Responda no idioma do usuário. Seja conciso em perguntas simples e aprofunde quando a tarefa exigir.",
    "Analise cuidadosamente arquivos e imagens anexados quando existirem.",
    "Não invente fatos, fontes, memórias ou ações.",
    "Quando usar pesquisa web, diferencie claramente informação encontrada de inferência.",
    "Se houver incerteza relevante, diga qual é a incerteza.",
    "Nunca invente, exponha ou imprima chamadas de ferramentas inexistentes, pseudo-JSON de actions, nomes como dalle.text2im, tool_call, function_call ou qualquer mecanismo interno fictício. Pedidos de imagem e vídeo são roteados pela própria aplicação; no chat, responda apenas em linguagem natural.",
    NEXUS_OPEN_BEHAVIOR,
  ].join(" ");

  let userText = message;
  let documentContext = "";
  let fallbackSearch = { results: [], unavailable: true };

  if (attachment?.kind === "text" && typeof attachment.text === "string") {
    userText +=
      "\n\nARQUIVO ANEXADO: " +
      String(attachment.name || "arquivo") +
      "\n--- INÍCIO ---\n" +
      attachment.text.slice(0, 100000) +
      "\n--- FIM ---";
  }

  if (attachment?.kind === "document" && typeof attachment.dataUrl === "string") {
    try {
      const markdown = await convertDocumentAttachment(attachment, env);
      documentContext = markdown.slice(0, 80000);
      userText +=
        "\n\nDOCUMENTO CONVERTIDO: " +
        String(attachment.name || "documento") +
        "\n--- INÍCIO ---\n" +
        markdown +
        "\n--- FIM ---";
    } catch (error) {
      return json(
        {
          error: "Não consegui analisar o documento.",
          provider_error: error?.message || String(error),
        },
        422
      );
    }
  }

  const memoryMessages = memorySummary
    ? [{
        role: "system",
        content:
          "MEMÓRIA COMPACTADA DA CONVERSA. Use apenas como contexto; se conflitar com mensagens recentes, as mensagens recentes vencem:\n" +
          memorySummary,
      }]
    : [];

  const buildMessages = (text) => [
    { role: "system", content: system },
    ...memoryMessages,
    ...history,
    { role: "user", content: text },
  ];

  let attempt;

  if (
    attachment?.kind === "image" &&
    typeof attachment.dataUrl === "string" &&
    attachment.dataUrl.startsWith("data:image/")
  ) {
    const visionMessages = [
      { role: "system", content: system },
      ...memoryMessages,
      ...history,
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: attachment.dataUrl } },
        ],
      },
    ];

    attempt = await runTextChat(visionMessages, env, {
      cloudflareModel: env.CF_VISION_MODEL || CF_VISION_MODEL,
      hfModel: env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-3B-Instruct",
      maxTokens: 2400,
      temperature: 0.45,
      topP: 0.9,
      sessionId,
      cloudflareOnly: Boolean(env.AI),
    });

    if (!attempt?.ok && env.AI) {
      try {
        const imageBlob = dataUrlToBlob(attachment.dataUrl);
        const converted = await env.AI.toMarkdown(
          {
            name: String(attachment.name || "imagem.jpg"),
            blob: imageBlob,
          },
          {
            conversionOptions: {
              output: { format: "markdown" },
              image: { descriptionLanguage: "pt" },
            },
          }
        );

        const item = Array.isArray(converted) ? converted[0] : converted;
        const visualDescription =
          item && item.format !== "error" ? String(item.data || "") : "";

        if (visualDescription) {
          attempt = await runTextChat(
            buildMessages(
              userText +
              "\n\nDESCRIÇÃO VISUAL EXTRAÍDA DA IMAGEM ANEXADA:\n" +
              visualDescription.slice(0, 30000)
            ),
            env,
            {
              cloudflareModel: env.CF_VISION_MODEL || CF_VISION_MODEL,
              maxTokens: 2400,
              temperature: 0.45,
              topP: 0.9,
              sessionId,
              cloudflareOnly: true,
            }
          );
        }
      } catch {}
    }

    if (!attempt?.ok && env.HF_TOKEN) {
      attempt = await runHfChat(
        env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-3B-Instruct",
        visionMessages,
        env,
        {
          maxTokens: 2400,
          temperature: 0.45,
          topP: 0.9,
        }
      );
    }
  } else if (mode === "search" && env.AI) {
    attempt = await runTextChat(buildMessages(userText), env, {
      cloudflareModel: route.model,
      maxTokens: route.maxTokens,
      temperature: 0.45,
      topP: 0.9,
      sessionId,
      webSearch: true,
      cloudflareOnly: true,
    });

    if (!attempt?.ok && env.SEARXNG_URL) {
      fallbackSearch = await searchWeb(message, env);
      const webContext = fallbackSearch.results.length
        ? "\n\nRESULTADOS DE PESQUISA:\n" +
          fallbackSearch.results
            .map((r, i) =>
              "[" + (i + 1) + "] " + r.title + "\n" + r.url + "\n" + r.content
            )
            .join("\n\n")
        : "";

      attempt = await runTextChat(buildMessages(userText + webContext), env, {
        cloudflareModel: route.model,
        maxTokens: route.maxTokens,
        temperature: 0.45,
        topP: 0.9,
        sessionId,
      });
    }
  } else if (mode === "search" && env.SEARXNG_URL) {
    fallbackSearch = await searchWeb(message, env);
    const webContext = fallbackSearch.results.length
      ? "\n\nRESULTADOS DE PESQUISA:\n" +
        fallbackSearch.results
          .map((r, i) =>
            "[" + (i + 1) + "] " + r.title + "\n" + r.url + "\n" + r.content
          )
          .join("\n\n")
      : "";

    attempt = await runTextChat(buildMessages(userText + webContext), env, {
      cloudflareModel: route.model,
      maxTokens: route.maxTokens,
      sessionId,
    });
  } else if (mode === "search") {
    return json(
      { error: "A pesquisa web está temporariamente indisponível." },
      503
    );
  } else {
    attempt = await runTextChat(buildMessages(userText), env, {
      cloudflareModel: route.model,
      maxTokens: route.maxTokens,
      temperature: route.key === "deep" ? 0.45 : 0.68,
      topP: 0.94,
      reasoningEffort: route.reasoningEffort,
      sessionId,
    });
  }

  if (!attempt?.ok) {
    return json(
      {
        error: "Não consegui acessar nenhum modelo disponível.",
        provider_error: parseProviderError(attempt?.raw || ""),
        route: route.key,
      },
      502
    );
  }

  let data;
  try {
    data = JSON.parse(attempt.raw);
  } catch {
    return json(
      {
        error: "O provedor devolveu uma resposta inválida.",
        provider_error: parseProviderError(attempt.raw),
        model: attempt.model,
      },
      502
    );
  }

  const answer = extractModelText(data) || "O modelo respondeu sem texto.";

  const nativeSources = extractSources(data);
  const fallbackSources = fallbackSearch.results.map((r) => ({
    title: r.title,
    url: r.url,
  }));

  if (sessionId) {
    await Promise.all([
      appendServerEvent(env, sessionId, {
        type: "chat-response",
        role: "assistant",
        content: answer,
        meta: {
          route: route.key,
          model: attempt.model,
          provider: attempt.provider,
        },
      }),
      recordServerMetric(env, sessionId, {
        type: "chat",
        route: route.key,
        provider: attempt.provider,
        model: attempt.model,
        latencyMs: Date.now() - startedAt,
        ok: true,
      }),
    ]);
  }

  return json({
    answer,
    model: attempt.model,
    provider: attempt.provider,
    route: route.key,
    routeReason: route.reason,
    sources: nativeSources.length ? nativeSources : fallbackSources,
    usage: data?.usage || null,
    documentContext: documentContext || null,
    stateSource: serverState?.summary ? "durable-object" : "client",
  });
}

async function handleMemory(request, env) {
  const body = await request.json();
  const previousSummary = String(body.previousSummary || "").trim().slice(0, 16000);
  const sessionId = String(body.sessionId || "").slice(0, 128);
  const messages = cleanHistory(body.messages);

  if (!messages.length) {
    return json({ summary: previousSummary });
  }

  const system = [
    "Você compacta memória de uma conversa para uso futuro por outro modelo.",
    "Preserve somente informações explicitamente presentes: fatos úteis, preferências, decisões, requisitos, nomes de projetos, estados técnicos, erros já diagnosticados, tarefas concluídas e pendências.",
    "Preserve detalhes técnicos exatos quando forem importantes, como nomes de modelos, versões, endpoints, arquivos e decisões de arquitetura.",
    "Não invente, não interprete intenções ocultas, não reclassifique automaticamente temas sensíveis como perigosos e não inclua conversa casual sem utilidade futura.",
    "Se algo novo contradizer a memória antiga, mantenha a informação mais recente.",
    "Escreva em português, de forma densa e objetiva, com no máximo 900 palavras.",
  ].join(" ");

  const content = [
    previousSummary ? "MEMÓRIA ANTERIOR:\n" + previousSummary : "",
    "NOVO TRECHO DA CONVERSA:\n" +
      messages.map((m) => m.role.toUpperCase() + ": " + m.content).join("\n\n"),
  ].filter(Boolean).join("\n\n");

  const attempt = await runTextChat(
    [
      { role: "system", content: system },
      { role: "user", content },
    ],
    env,
    {
      cloudflareModel: CF_CODE_MODEL,
      maxTokens: 1200,
      temperature: 0.15,
      topP: 0.8,
      sessionId: sessionId ? sessionId + "-memory" : "",
      cloudflareOnly: Boolean(env.AI),
    }
  );

  if (!attempt?.ok) {
    return json({
      summary: previousSummary,
      updated: false,
      error: parseProviderError(attempt?.raw || ""),
    });
  }

  const summary = extractModelText(attempt.raw) || previousSummary;
  const compactSummary = summary.slice(0, 16000);

  if (sessionId && compactSummary) {
    await Promise.all([
      setServerSummary(env, sessionId, compactSummary),
      appendServerEvent(env, sessionId, {
        type: "memory-updated",
        role: "assistant",
        content: compactSummary.slice(0, 4000),
        meta: { model: attempt.model },
      }),
    ]);
  }

  return json({
    summary: compactSummary,
    updated: Boolean(summary),
    model: attempt.model,
    provider: attempt.provider,
  });
}

async function handleImage(request, env) {
  const body = await request.json();
  const prompt = String(body.prompt || "").trim();
  const history = cleanHistory(body.history);
  const sourceImage = dataUrlToBlob(body.sourceImage);
  const previousPrompt = String(body.previousPrompt || "")
    .trim()
    .slice(0, 6000);
  const sessionId = String(body.sessionId || "").slice(0, 128);
  const quality = body.quality === "quality" ? "quality" : "fast";
  const startedAt = Date.now();

  if (!prompt) return json({ error: "Prompt vazio." }, 400);
  if (!env.AI && !env.HF_TOKEN)
    return json({ error: "Nenhum provedor de imagem está disponível." }, 503);

  let sourceDescription = "";
  let editSpec = null;
  let expansion = { prompt, expanded: false, model: null };

  if (sourceImage && env.AI) {
    sourceDescription = await describeVisualImage(
      sourceImage,
      env,
      "imagem-original"
    );

    editSpec = await buildVisualEditSpec({
      sourceDescription,
      prompt,
      previousPrompt,
      sessionId,
      env,
    });
  } else {
    expansion = await expandCreativePrompt({
      kind: "image",
      prompt,
      history,
      previousPrompt,
      hasSourceImage: false,
      sessionId,
      env,
    });
  }

  const promptForModel = sourceImage
    ? buildStrictEditPrompt(prompt, editSpec)
    : expansion.prompt;

  let cloudflareImageError = null;

  if (env.AI) {
    const qualities = quality === "quality" ? ["quality", "fast"] : ["fast"];

    for (const imageQuality of qualities) {
      try {
        let generated = await runCloudflareImage({
          quality: imageQuality,
          prompt: promptForModel,
          sourceImage,
          env,
        });

        let retryCount = 0;
        let verification = sourceImage
          ? await verifyVisualEdit({
              originalDescription: sourceDescription,
              resultBlob: new Blob([generated.bytes], { type: "image/jpeg" }),
              prompt,
              spec: editSpec,
              sessionId,
              env,
            })
          : {
              verified: false,
              pass: true,
              score: null,
              retryInstruction: "",
              issues: [],
            };

        let best = {
          generated,
          verification,
          retryCount,
        };

        if (sourceImage && verification.verified && !verification.pass) {
          retryCount = 1;

          const retryPrompt = [
            promptForModel,
            "CORRECTION AFTER VALIDATION:",
            verification.retryInstruction ||
              "Preserve the original identity and composition more strictly. Remove all unintended changes.",
            verification.issues?.length
              ? "ISSUES TO FIX: " + verification.issues.join("; ")
              : "",
            verification.unwantedChanges?.length
              ? "REMOVE UNWANTED CHANGES: " +
                verification.unwantedChanges.join("; ")
              : "",
            "Use image 0 as the authoritative source. Do not reinterpret the scene.",
          ].filter(Boolean).join(" ");

          const retried = await runCloudflareImage({
            quality: imageQuality,
            prompt: retryPrompt,
            sourceImage,
            env,
          });

          const retryVerification = await verifyVisualEdit({
            originalDescription: sourceDescription,
            resultBlob: new Blob([retried.bytes], { type: "image/jpeg" }),
            prompt,
            spec: editSpec,
            sessionId: sessionId ? sessionId + "-retry" : "",
            env,
          });

          if (
            retryVerification.score == null ||
            verification.score == null ||
            Number(retryVerification.score) >= Number(verification.score)
          ) {
            best = {
              generated: retried,
              verification: retryVerification,
              retryCount,
            };
          }
        }

        if (
          sourceImage &&
          quality === "quality" &&
          imageQuality === "quality" &&
          best.verification?.verified &&
          !best.verification?.pass &&
          Number(best.verification?.score || 0) < 0.55
        ) {
          continue;
        }

        if (sessionId) {
          await Promise.all([
            appendServerEvent(env, sessionId, {
              type: sourceImage ? "image-edit" : "image-generation",
              role: "assistant",
              content: prompt,
              meta: {
                model: best.generated.model,
                quality: imageQuality,
                verified: Boolean(best.verification?.verified),
                score: best.verification?.score,
                retryCount: best.retryCount,
              },
            }),
            recordServerMetric(env, sessionId, {
              type: sourceImage ? "image-edit" : "image-generation",
              route: sourceImage ? "visual-edit" : "visual-generate",
              provider: "cloudflare",
              model: best.generated.model,
              latencyMs: Date.now() - startedAt,
              ok: true,
              meta: {
                verified: Boolean(best.verification?.verified),
                score: best.verification?.score,
                retryCount: best.retryCount,
              },
            }),
          ]);
        }

        return new Response(best.generated.bytes, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-store",
            "X-Nexus-Image-Mode": sourceImage ? "edit" : "new",
            "X-Nexus-Provider": "cloudflare",
            "X-Nexus-Model": best.generated.model,
            "X-Nexus-Quality-Fallback":
              quality === "quality" && imageQuality === "fast" ? "1" : "0",
            "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
            "X-Nexus-Prompt-Model": expansion.model || "",
            "X-Nexus-Visual-Verified": best.verification?.verified ? "1" : "0",
            "X-Nexus-Visual-Score":
              best.verification?.score == null
                ? ""
                : String(best.verification.score),
            "X-Nexus-Visual-Retry": String(best.retryCount || 0),
          },
        });
      } catch (error) {
        cloudflareImageError = error?.message || String(error);
      }
    }
  }

  if (!env.HF_TOKEN) {
    return json(
      {
        error: sourceImage
          ? "A edição com preservação de referência falhou no Cloudflare e não há fallback de edição disponível."
          : "Não consegui gerar a imagem pelo Cloudflare e não há fallback configurado.",
        provider_error:
          cloudflareImageError || "Falha desconhecida do Workers AI.",
      },
      502
    );
  }

  const client = new InferenceClient(env.HF_TOKEN);
  const imageModel =
    env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const editModel =
    env.HF_IMAGE_EDIT_MODEL || "black-forest-labs/FLUX.1-Kontext-dev";

  try {
    let image;
    let mode = "new";
    let model = imageModel;

    if (sourceImage) {
      image = await client.imageToImage({
        model: editModel,
        inputs: sourceImage,
        parameters: { prompt: promptForModel },
      });
      mode = "edit";
      model = editModel;
    } else {
      image = await client.textToImage({
        model: imageModel,
        inputs: expansion.prompt,
      });
    }

    if (sessionId) {
      await recordServerMetric(env, sessionId, {
        type: sourceImage ? "image-edit" : "image-generation",
        route: sourceImage ? "visual-edit" : "visual-generate",
        provider: "huggingface",
        model,
        latencyMs: Date.now() - startedAt,
        ok: true,
      });
    }

    return new Response(image, {
      headers: {
        "Content-Type": image.type || "image/png",
        "Cache-Control": "no-store",
        "X-Nexus-Image-Mode": mode,
        "X-Nexus-Provider": "huggingface",
        "X-Nexus-Model": model,
        "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
        "X-Nexus-Prompt-Model": expansion.model || "",
        "X-Nexus-Visual-Verified": "0",
        "X-Nexus-Visual-Retry": "0",
      },
    });
  } catch (error) {
    const info = generationError(error);
    return json(
      {
        error: sourceImage
          ? "Não consegui editar a imagem preservando a referência."
          : "Não consegui gerar a imagem.",
        provider_error: [
          cloudflareImageError ? "Cloudflare: " + cloudflareImageError : "",
          "Hugging Face: " + info.message,
        ].filter(Boolean).join(" | "),
        error_kind: info.kind,
      },
      info.status
    );
  }
}


function clampVideoNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function buildVideoPlan({
  prompt,
  history,
  previousPrompt,
  hasSourceImage,
  quality,
  sessionId,
  env,
}) {
  const fallback = {
    prompt: String(prompt || "").trim(),
    negativePrompt:
      "identity drift, subject replacement, scene replacement, extra limbs, warped anatomy, flicker, random text, unwanted objects",
    motion:
      hasSourceImage
        ? "Preserve the same subject and scene; animate only the requested motion."
        : "Natural coherent motion.",
    camera: "Stable cinematic camera unless the user requests another movement.",
    numFrames: quality === "quality" ? 81 : 49,
    guidanceScale: hasSourceImage ? 4.5 : 5,
    inferenceSteps: quality === "quality" ? 30 : 20,
    planned: false,
    model: null,
  };

  if (!env.AI) return fallback;

  const attempt = await runTextChat(
    [
      {
        role: "system",
        content: [
          "Você é o Video Planner da NEXUS AI.",
          "Transforme o pedido em uma especificação temporal curta e precisa para um modelo de geração de vídeo.",
          "Preserve rigorosamente identidade, roupa, objeto, composição e cenário quando houver imagem de referência.",
          "Não invente personagens, objetos ou mudanças de cena não solicitadas.",
          "Prefira movimento fisicamente coerente e câmera estável.",
          "Retorne SOMENTE JSON válido no schema:",
          "{prompt:string,negativePrompt:string,motion:string,camera:string,numFrames:number,guidanceScale:number,inferenceSteps:number}.",
          "numFrames deve ficar entre 25 e 97.",
          "guidanceScale entre 2 e 8.",
          "inferenceSteps entre 12 e 40.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          previousPrompt ? "CONTEXTO VISUAL ANTERIOR:\n" + previousPrompt : "",
          history?.length
            ? "HISTÓRICO RECENTE:\n" +
              history
                .slice(-8)
                .map((m) => m.role.toUpperCase() + ": " + m.content)
                .join("\n\n")
            : "",
          hasSourceImage
            ? "HÁ UMA IMAGEM DE REFERÊNCIA. Ela é a autoridade visual absoluta."
            : "Não há imagem de referência.",
          "MODO DE QUALIDADE: " + quality,
          "PEDIDO:\n" + String(prompt || ""),
        ].filter(Boolean).join("\n\n"),
      },
    ],
    env,
    {
      cloudflareModel: CF_CODE_MODEL,
      maxTokens: 800,
      temperature: 0.08,
      topP: 0.82,
      sessionId: sessionId ? sessionId + "-video-plan" : "",
      cloudflareOnly: true,
    }
  );

  if (!attempt?.ok) return fallback;

  const parsed = parseJsonLooseText(extractModelText(attempt.raw), null);
  if (!parsed) return fallback;

  const plannedPrompt = [
    String(parsed.prompt || prompt || "").trim(),
    parsed.motion ? "Motion: " + String(parsed.motion).trim() : "",
    parsed.camera ? "Camera: " + String(parsed.camera).trim() : "",
    hasSourceImage
      ? "Preserve the exact same subject identity, clothing/object details, framing and scene from the reference image unless explicitly requested otherwise."
      : "",
  ].filter(Boolean).join(" ");

  return {
    prompt: plannedPrompt.slice(0, 6500),
    negativePrompt:
      String(parsed.negativePrompt || fallback.negativePrompt).slice(0, 1800),
    motion: String(parsed.motion || fallback.motion).slice(0, 1800),
    camera: String(parsed.camera || fallback.camera).slice(0, 1800),
    numFrames: Math.round(
      clampVideoNumber(
        parsed.numFrames,
        25,
        97,
        fallback.numFrames
      )
    ),
    guidanceScale: clampVideoNumber(
      parsed.guidanceScale,
      2,
      8,
      fallback.guidanceScale
    ),
    inferenceSteps: Math.round(
      clampVideoNumber(
        parsed.inferenceSteps,
        12,
        40,
        fallback.inferenceSteps
      )
    ),
    planned: true,
    model: attempt.model,
  };
}

function videoProviderName(env) {
  const value = String(env.HF_VIDEO_PROVIDER || "auto").trim();
  return value || "auto";
}

function videoBlobLooksValid(video) {
  return (
    video &&
    typeof video.arrayBuffer === "function" &&
    Number(video.size || 0) > 256
  );
}

async function generateTextVideo(client, {
  plan,
  quality,
  env,
}) {
  const provider = videoProviderName(env);
  const fastModel =
    env.HF_VIDEO_MODEL_FAST ||
    "Lightricks/LTX-Video-0.9.8-13B-distilled";
  const qualityModel =
    env.HF_VIDEO_MODEL_QUALITY ||
    "tencent/HunyuanVideo";
  const legacyModel =
    env.HF_VIDEO_MODEL ||
    "Wan-AI/Wan2.1-T2V-1.3B";

  const candidates =
    quality === "quality"
      ? [qualityModel, fastModel, legacyModel]
      : [fastModel, legacyModel, qualityModel];

  const unique = [...new Set(candidates.filter(Boolean))];
  const attempts = [];

  for (const model of unique) {
    try {
      const video = await client.textToVideo({
        provider,
        model,
        inputs: plan.prompt,
        parameters: {
          negative_prompt: [plan.negativePrompt],
          num_frames: plan.numFrames,
          guidance_scale: plan.guidanceScale,
          num_inference_steps: plan.inferenceSteps,
        },
      });

      if (!videoBlobLooksValid(video)) {
        throw new Error("O provedor retornou um vídeo vazio ou inválido.");
      }

      return {
        video,
        model,
        provider,
        attempts,
      };
    } catch (error) {
      attempts.push({
        model,
        provider,
        error: String(error?.message || error).slice(0, 900),
      });
    }
  }

  const failure = new Error("Todos os modelos text-to-video falharam.");
  failure.attempts = attempts;
  throw failure;
}

async function generateImageVideo(client, {
  sourceImage,
  plan,
  quality,
  env,
}) {
  const provider = videoProviderName(env);
  const textConditionedModel =
    env.HF_IMAGE_VIDEO_MODEL ||
    "Lightricks/LTX-Video";
  const imageOnlyFallback =
    env.HF_IMAGE_VIDEO_FALLBACK_MODEL ||
    "Wan-AI/Wan2.1-I2V-14B-720P";

  const attempts = [];

  if (typeof client.imageTextToVideo === "function") {
    try {
      const video = await client.imageTextToVideo({
        provider,
        model: textConditionedModel,
        inputs: sourceImage,
        parameters: {
          prompt: plan.prompt,
          negative_prompt: plan.negativePrompt,
          num_frames: plan.numFrames,
          guidance_scale: plan.guidanceScale,
          num_inference_steps: plan.inferenceSteps,
        },
      });

      if (!videoBlobLooksValid(video)) {
        throw new Error("O provedor retornou um vídeo vazio ou inválido.");
      }

      return {
        video,
        model: textConditionedModel,
        provider,
        method: "image-text-to-video",
        attempts,
      };
    } catch (error) {
      attempts.push({
        model: textConditionedModel,
        provider,
        method: "image-text-to-video",
        error: String(error?.message || error).slice(0, 900),
      });
    }
  }

  if (typeof client.imageToVideo === "function") {
    try {
      const video = await client.imageToVideo({
        provider,
        model: imageOnlyFallback,
        inputs: sourceImage,
        parameters: {
          prompt: plan.prompt,
          negative_prompt: plan.negativePrompt,
          num_frames: plan.numFrames,
          guidance_scale: plan.guidanceScale,
          num_inference_steps: plan.inferenceSteps,
        },
      });

      if (!videoBlobLooksValid(video)) {
        throw new Error("O provedor retornou um vídeo vazio ou inválido.");
      }

      return {
        video,
        model: imageOnlyFallback,
        provider,
        method: "image-to-video",
        attempts,
      };
    } catch (error) {
      attempts.push({
        model: imageOnlyFallback,
        provider,
        method: "image-to-video",
        error: String(error?.message || error).slice(0, 900),
      });
    }
  }

  const failure = new Error(
    "Todos os modelos condicionados pela imagem falharam. A NEXUS não caiu para text-to-video para não perder a referência."
  );
  failure.attempts = attempts;
  throw failure;
}

async function handleVideo(request, env) {
  const body = await request.json();
  const prompt = String(body.prompt || "").trim();
  const history = cleanHistory(body.history);
  const sessionId = String(body.sessionId || "").slice(0, 128);
  const sourceImage = dataUrlToBlob(body.sourceImage);
  const previousPrompt = String(body.previousPrompt || "")
    .trim()
    .slice(0, 6000);
  const quality = body.quality === "quality" ? "quality" : "fast";
  const startedAt = Date.now();

  if (!prompt) return json({ error: "Prompt vazio." }, 400);

  if (!env.HF_TOKEN) {
    return json(
      {
        error:
          "A Video Foundation está pronta, mas geração de vídeo precisa de um provedor de GPU. Configure créditos no Hugging Face ou um provider compatível; nenhum serviço pago será ativado automaticamente.",
        error_kind: "video-provider-required",
      },
      503
    );
  }

  const plan = await buildVideoPlan({
    prompt,
    history,
    previousPrompt,
    hasSourceImage: Boolean(sourceImage),
    quality,
    sessionId,
    env,
  });

  const client = new InferenceClient(env.HF_TOKEN);

  try {
    const generated = sourceImage
      ? await generateImageVideo(client, {
          sourceImage,
          plan,
          quality,
          env,
        })
      : await generateTextVideo(client, {
          plan,
          quality,
          env,
        });

    if (sessionId) {
      await Promise.all([
        appendServerEvent(env, sessionId, {
          type: sourceImage
            ? "image-to-video"
            : "text-to-video",
          role: "assistant",
          content: prompt,
          meta: {
            model: generated.model,
            provider: generated.provider,
            quality,
            planned: plan.planned,
            method: generated.method || "text-to-video",
            previousFailures: generated.attempts?.length || 0,
          },
        }),
        recordServerMetric(env, sessionId, {
          type: "video-generation",
          route: sourceImage
            ? "image-to-video"
            : "text-to-video",
          provider: generated.provider,
          model: generated.model,
          latencyMs: Date.now() - startedAt,
          ok: true,
          meta: {
            quality,
            planned: plan.planned,
            method: generated.method || "text-to-video",
            numFrames: plan.numFrames,
            previousFailures: generated.attempts?.length || 0,
          },
        }),
      ]);
    }

    return new Response(generated.video, {
      headers: {
        "Content-Type": generated.video.type || "video/mp4",
        "Cache-Control": "no-store",
        "X-Nexus-Video-Mode": sourceImage
          ? "image-to-video"
          : "text-to-video",
        "X-Nexus-Video-Method":
          generated.method ||
          "text-to-video",
        "X-Nexus-Provider": generated.provider || "huggingface",
        "X-Nexus-Model": generated.model,
        "X-Nexus-Video-Quality": quality,
        "X-Nexus-Video-Planned": plan.planned ? "1" : "0",
        "X-Nexus-Video-Plan-Model": plan.model || "",
        "X-Nexus-Video-Fallbacks":
          String(generated.attempts?.length || 0),
      },
    });
  } catch (error) {
    const attempts = Array.isArray(error?.attempts)
      ? error.attempts
      : [];
    const joinedAttempts = attempts
      .map(
        (attempt) =>
          [
            attempt.method || "",
            attempt.model || "",
            attempt.error || "",
          ]
            .filter(Boolean)
            .join(": ")
      )
      .join(" | ");

    const info = generationError(
      joinedAttempts
        ? new Error(joinedAttempts)
        : error
    );

    if (sessionId) {
      await recordServerMetric(env, sessionId, {
        type: "video-generation",
        route: sourceImage
          ? "image-to-video"
          : "text-to-video",
        provider: videoProviderName(env),
        model: attempts.map((x) => x.model).filter(Boolean).join(", "),
        latencyMs: Date.now() - startedAt,
        ok: false,
        meta: {
          quality,
          planned: plan.planned,
          attempts: attempts.slice(0, 5),
          errorKind: info.kind,
        },
      });
    }

    return json(
      {
        error:
          info.kind === "quota"
            ? "A Video Foundation está funcionando, mas a cota/crédito do provedor de GPU acabou."
            : sourceImage
              ? "Não consegui animar a imagem sem perder a referência."
              : "Não consegui gerar o vídeo.",
        provider_error:
          joinedAttempts ||
          info.message,
        error_kind: info.kind,
        video_mode: sourceImage
          ? "image-to-video"
          : "text-to-video",
        attempted_models: attempts.map((x) => x.model).filter(Boolean),
        reference_preserved: sourceImage ? true : null,
      },
      info.status
    );
  }
}


async function enforceRateLimit(request, env, pathname) {
  if (
    !pathname.startsWith("/api/") ||
    pathname === "/api/status" ||
    (request.method === "GET" && pathname.startsWith("/api/agent/"))
  ) {
    return null;
  }

  const clientKey =
    request.headers.get("x-nexus-client") ||
    request.headers.get("cf-ray") ||
    "anonymous";

  const isMedia = pathname === "/api/image" || pathname === "/api/video";
  const limiter = isMedia ? env.MEDIA_RATE_LIMITER : env.AI_RATE_LIMITER;

  try {
    if (env.GLOBAL_AI_RATE_LIMITER) {
      const globalResult = await env.GLOBAL_AI_RATE_LIMITER.limit({
        key: "global-ai",
      });
      if (!globalResult.success) {
        return json(
          {
            error:
              "A NEXUS está com uso muito alto neste minuto. Aguarde alguns segundos e tente novamente.",
            error_kind: "global-rate-limit",
          },
          429,
          { "Retry-After": "60" }
        );
      }
    }

    if (limiter) {
      const result = await limiter.limit({
        key: String(clientKey).slice(0, 160) + ":" + pathname,
      });
      if (!result.success) {
        return json(
          {
            error: isMedia
              ? "Muitas gerações de mídia em pouco tempo. Aguarde um minuto para proteger a cota gratuita."
              : "Muitas solicitações em pouco tempo. Aguarde alguns segundos e tente novamente.",
            error_kind: "client-rate-limit",
          },
          429,
          { "Retry-After": "60" }
        );
      }
    }
  } catch {
    // Falha aberta: indisponibilidade do contador não derruba a IA.
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      const limited = await enforceRateLimit(request, env, url.pathname);
      if (limited) return limited;
      if (url.pathname === "/api/status" && request.method === "GET")
        return handleStatus(env);

      if (url.pathname === "/api/chat" && request.method === "POST")
        return handleChat(request, env);

      if (url.pathname === "/api/memory" && request.method === "POST")
        return handleMemory(request, env);

      if (url.pathname === "/api/agent/start" && request.method === "POST")
        return handleAgentStart(request, env);

      if (url.pathname.startsWith("/api/agent/") && request.method === "GET")
        return handleAgentStatus(url.pathname.split("/").pop(), env);

      if (url.pathname === "/api/image" && request.method === "POST")
        return handleImage(request, env);

      if (url.pathname === "/api/video" && request.method === "POST")
        return handleVideo(request, env);

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json(
        {
          error: error?.message || "Erro interno.",
          version: VERSION,
        },
        500
      );
    }
  },
};
