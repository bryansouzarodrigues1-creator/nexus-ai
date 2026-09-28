import { InferenceClient } from "@huggingface/inference";
export { ConversationState } from "./conversation-state.js";
export { NexusAgentWorkflow } from "./agent-workflow.js";
import { NexusConversationState } from "./state.js";
import { NexusReasoningWorkflow } from "./reasoning-workflow.js";

export { NexusConversationState, NexusReasoningWorkflow };

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const VERSION = "1.3.0";

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

function getConversationStub(env, sessionId) {
  if (!env.CONVERSATION_STATE || !sessionId) return null;
  try {
    const id = env.CONVERSATION_STATE.idFromName(String(sessionId).slice(0, 128));
    return env.CONVERSATION_STATE.get(id);
  } catch {
    return null;
  }
}

async function readConversationState(env, sessionId) {
  const stub = getConversationStub(env, sessionId);
  if (!stub) return null;
  try {
    const res = await stub.fetch("https://nexus-state/state");
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function writeConversationState(env, sessionId, patch) {
  const stub = getConversationStub(env, sessionId);
  if (!stub) return null;
  try {
    const res = await stub.fetch("https://nexus-state/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch || {}),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function appendConversationEvent(env, sessionId, event) {
  const stub = getConversationStub(env, sessionId);
  if (!stub) return;
  try {
    await stub.fetch("https://nexus-state/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event || {}),
    });
  } catch {}
}

async function handleTaskStatus(taskId, env) {
  if (!env.NEXUS_REASONING) {
    return json({ error: "Workflow de raciocínio não configurado." }, 503);
  }

  try {
    const instance = await env.NEXUS_REASONING.get(taskId);
    const status = await instance.status();
    return json({
      id: taskId,
      status: status.status,
      output: status.output || null,
      error: status.error || null,
      rollback: status.rollback || null,
    });
  } catch (error) {
    return json(
      {
        error: "Não consegui consultar a tarefa.",
        provider_error: error?.message || String(error),
      },
      502
    );
  }
}

async function handleStatus(env) {
  return json({
    ok: true,
    version: VERSION,
    behaviorMode: "open-contextual",
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
      durableState: Boolean(env.CONVERSATION_STATE),
      workflows: Boolean(env.NEXUS_REASONING),
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
      video: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B",
      imageVideo: env.HF_IMAGE_VIDEO_MODEL || "Lightricks/LTX-Video",
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
    ? await readConversationState(env, sessionId)
    : null;

  if (!memorySummary && serverState?.memorySummary) {
    memorySummary = String(serverState.memorySummary).slice(0, 16000);
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

  if (
    route.key === "deep" &&
    mode === "chat" &&
    !attachment &&
    env.NEXUS_REASONING &&
    body.useWorkflow !== false
  ) {
    try {
      const instance = await env.NEXUS_REASONING.create({
        params: {
          message,
          history,
          memorySummary,
          sessionId,
        },
      });

      if (sessionId) {
        await writeConversationState(env, sessionId, {
          activeWorkflowId: instance.id,
          lastRoute: "deep-workflow",
        });
        await appendConversationEvent(env, sessionId, {
          type: "workflow-started",
          workflowId: instance.id,
        });
      }

      return json(
        {
          async: true,
          taskId: instance.id,
          route: "deep-workflow",
          routeReason: "raciocínio profundo durável com verificação",
        },
        202
      );
    } catch {
      // Falha ao iniciar Workflow: continua pelo caminho síncrono existente.
    }
  }

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
    await writeConversationState(env, sessionId, {
      lastRoute: route.key,
      lastModel: attempt.model,
    });
    await appendConversationEvent(env, sessionId, {
      type: "chat-response",
      route: route.key,
      model: attempt.model,
      provider: attempt.provider,
    });
  }

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
    await writeConversationState(env, sessionId, {
      memorySummary: compactSummary,
    });
    await appendConversationEvent(env, sessionId, {
      type: "memory-updated",
      model: attempt.model,
    });
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

  if (!prompt) return json({ error: "Prompt vazio." }, 400);
  if (!env.AI && !env.HF_TOKEN)
    return json({ error: "Nenhum provedor de imagem está disponível." }, 503);

  const expansion = await expandCreativePrompt({
    kind: "image",
    prompt,
    history,
    previousPrompt,
    hasSourceImage: Boolean(sourceImage),
    sessionId,
    env,
  });

  const promptForModel = expansion.prompt;

  let cloudflareImageError = null;
  if (env.AI) {
    const visualPrompt = sourceImage
      ? "Edit image 0. Preserve the exact same main subject, identity, colors and unchanged scene details. Apply only this requested change: " +
        promptForModel
      : promptForModel;

    for (const imageQuality of quality === "quality" ? ["quality", "fast"] : ["fast"]) {
      try {
        const generated = await runCloudflareImage({
          quality: imageQuality,
          prompt: visualPrompt,
          sourceImage,
          env,
        });

        return new Response(generated.bytes, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-store",
            "X-Nexus-Image-Mode": sourceImage ? "edit" : "new",
            "X-Nexus-Provider": "cloudflare",
            "X-Nexus-Model": generated.model,
            "X-Nexus-Quality-Fallback":
              quality === "quality" && imageQuality === "fast" ? "1" : "0",
            "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
            "X-Nexus-Prompt-Model": expansion.model || "",
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
        error: "Não consegui gerar a imagem pelo Cloudflare e não há fallback configurado.",
        provider_error: cloudflareImageError || "Falha desconhecida do Workers AI.",
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
      try {
        image = await client.imageToImage({
          model: editModel,
          inputs: sourceImage,
          parameters: { prompt: promptForModel },
        });
        mode = "edit";
        model = editModel;
      } catch {
        image = await client.textToImage({
          model: imageModel,
          inputs:
            "Preserve the previous subject and scene identity. " +
            (previousPrompt ? "Previous context: " + previousPrompt + ". " : "") +
            "Current result: " +
            promptForModel,
        });
        mode = "continuity-fallback";
      }
    } else {
      image = await client.textToImage({
        model: imageModel,
        inputs: promptForModel,
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
      },
    });
  } catch (error) {
    const info = generationError(error);
    return json(
      {
        error: "Não consegui gerar a imagem.",
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

async function handleVideo(request, env) {
  const body = await request.json();
  const prompt = String(body.prompt || "").trim();
  const history = cleanHistory(body.history);
  const sessionId = String(body.sessionId || "").slice(0, 128);
  const sourceImage = dataUrlToBlob(body.sourceImage);
  const previousPrompt = String(body.previousPrompt || "")
    .trim()
    .slice(0, 6000);

  if (!prompt) return json({ error: "Prompt vazio." }, 400);

  const expansion = await expandCreativePrompt({
    kind: "video",
    prompt,
    history,
    previousPrompt,
    hasSourceImage: Boolean(sourceImage),
    sessionId,
    env,
  });

  if (!env.HF_TOKEN) {
    return json(
      {
        error:
          "Vídeo ainda precisa de um provedor de GPU com créditos. Chat e imagem continuam funcionando gratuitamente pelo Cloudflare.",
        error_kind: "video-provider-required",
      },
      503
    );
  }

  const client = new InferenceClient(env.HF_TOKEN);

  if (sourceImage && typeof client.imageTextToVideo === "function") {
    const imageVideoModel =
      env.HF_IMAGE_VIDEO_MODEL || "Lightricks/LTX-Video";
    try {
      const video = await client.imageTextToVideo({
        model: imageVideoModel,
        inputs: sourceImage,
        parameters: { prompt: expansion.prompt },
      });

      return new Response(video, {
        headers: {
          "Content-Type": video.type || "video/mp4",
          "Cache-Control": "no-store",
          "X-Nexus-Video-Mode": "image-to-video",
          "X-Nexus-Provider": "huggingface",
          "X-Nexus-Model": imageVideoModel,
          "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
          "X-Nexus-Prompt-Model": expansion.model || "",
        },
      });
    } catch {}
  }

  const videoModel =
    env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B";

  try {
    const video = await client.textToVideo({
      model: videoModel,
      inputs: expansion.prompt,
    });

    return new Response(video, {
      headers: {
        "Content-Type": video.type || "video/mp4",
        "Cache-Control": "no-store",
        "X-Nexus-Video-Mode": "text-to-video",
        "X-Nexus-Provider": "huggingface",
        "X-Nexus-Model": videoModel,
        "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
        "X-Nexus-Prompt-Model": expansion.model || "",
      },
    });
  } catch (error) {
    const info = generationError(error);
    return json(
      {
        error:
          info.kind === "quota"
            ? "Os créditos mensais do provedor de vídeo acabaram. Chat e imagem continuam pelo Cloudflare; vídeo precisa esperar a renovação ou usar um provedor pago."
            : "Não consegui gerar o vídeo.",
        provider_error: info.message,
        error_kind: info.kind,
        attempted_model: videoModel,
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

      if (url.pathname.startsWith("/api/tasks/") && request.method === "GET") {
        const taskId = decodeURIComponent(url.pathname.slice("/api/tasks/".length));
        if (!taskId) return json({ error: "taskId ausente." }, 400);
        return handleTaskStatus(taskId, env);
      }

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
