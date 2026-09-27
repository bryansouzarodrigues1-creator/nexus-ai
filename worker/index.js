import { InferenceClient } from "@huggingface/inference";

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const VERSION = "1.0.0";

const CF_GENERAL_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const CF_REASONING_MODEL = "@cf/openai/gpt-oss-120b";
const CF_CODE_MODEL = "@cf/zai-org/glm-4.7-flash";
const CF_IMAGE_FAST_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const CF_IMAGE_QUALITY_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

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
    },
    models: {
      chatGeneral: env.CF_GENERAL_MODEL || CF_GENERAL_MODEL,
      chatReasoning: env.CF_REASONING_MODEL || CF_REASONING_MODEL,
      chatCode: env.CF_CODE_MODEL || CF_CODE_MODEL,
      chatFallback: env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest",
      promptExpander: env.CF_PROMPT_MODEL || CF_GENERAL_MODEL,
      vision: env.CF_VISION_MODEL || CF_GENERAL_MODEL,
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

  if (!Array.isArray(raw)) return [];

  return raw.slice(0, 10).map((item, i) => {
    if (typeof item === "string") return { title: "Fonte " + (i + 1), url: item };
    return {
      title: item?.title || item?.name || item?.url || ("Fonte " + (i + 1)),
      url: item?.url || item?.href || "",
    };
  }).filter((x) => x.url);
}

function chooseChatRoute(message, mode, attachment) {
  const text = String(message || "").toLowerCase();

  if (attachment?.kind === "image") {
    return {
      key: "vision",
      model: CF_GENERAL_MODEL,
      reason: "visão",
      maxTokens: 2200,
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

  return lastAttempt || {
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

  if (/depleted.*credits|monthly included credits|quota|credit|payment|required|insufficient|402/i.test(text)) {
    return {
      status: 429,
      kind: "quota",
      message:
        "A cota do provedor de vídeo acabou. Chat e imagem podem continuar pelo Cloudflare Workers AI.",
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

  let result;
  if (sourceImage) {
    const form = new FormData();
    form.append("input_image_0", sourceImage, "reference.png");
    form.append("prompt", prompt);
    form.append("width", "1024");
    form.append("height", "1024");

    const serialized = new Response(form);
    result = await env.AI.run(model, {
      multipart: {
        body: serialized.body,
        contentType: serialized.headers.get("content-type"),
      },
    });
  } else {
    result = await env.AI.run(model, {
      prompt,
      width: 1024,
      height: 1024,
      guidance: 3.5,
    });
  }

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
  const sessionId = String(body.sessionId || "").slice(0, 128);

  if (!message) return json({ error: "Mensagem vazia." }, 400);
  if (!env.AI && !env.HF_TOKEN)
    return json({ error: "Nenhum provedor de IA está configurado." }, 503);

  const route = chooseChatRoute(message, mode, attachment);

  const system = [
    "Você é NEXUS AI, um assistente geral de alta qualidade.",
    "Use todo o histórico fornecido para manter continuidade real e entender referências curtas.",
    "Responda no idioma do usuário. Seja conciso em perguntas simples e aprofunde quando a tarefa exigir.",
    "Analise cuidadosamente arquivos e imagens anexados quando existirem.",
    "Não invente fatos, fontes, memórias ou ações.",
    "Quando usar pesquisa web, diferencie claramente informação encontrada de inferência.",
    "Se houver incerteza relevante, diga qual é a incerteza.",
    "Evite recusas genéricas e diferencie contextos informativos, analíticos, fictícios ou preventivos de pedidos operacionalmente perigosos.",
    "Quando alguma parte precisar ser limitada, limite somente essa parte e continue útil.",
    "Não moralize nem repita avisos desnecessários.",
  ].join(" ");

  let userText = message;
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

  const buildMessages = (text) => [
    { role: "system", content: system },
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
      cloudflareModel: env.CF_VISION_MODEL || CF_GENERAL_MODEL,
      hfModel: env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-3B-Instruct",
      maxTokens: 2400,
      temperature: 0.45,
      topP: 0.9,
      sessionId,
    });
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

  return json({
    answer,
    model: attempt.model,
    provider: attempt.provider,
    route: route.key,
    routeReason: route.reason,
    sources: nativeSources.length ? nativeSources : fallbackSources,
    usage: data?.usage || null,
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

  if (env.AI) {
    try {
      const generated = await runCloudflareImage({
        quality,
        prompt: sourceImage
          ? "Edit image 0. Preserve the exact same main subject, identity, colors and unchanged scene details. Apply only this requested change: " +
            promptForModel
          : promptForModel,
        sourceImage,
        quality,
        env,
      });

      return new Response(generated.bytes, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-store",
          "X-Nexus-Image-Mode": sourceImage ? "edit" : "new",
          "X-Nexus-Provider": "cloudflare",
          "X-Nexus-Model": generated.model,
          "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
          "X-Nexus-Prompt-Model": expansion.model || "",
        },
      });
    } catch {}
  }

  if (!env.HF_TOKEN) {
    return json(
      {
        error: "Não consegui gerar a imagem pelo Cloudflare e não há fallback configurado.",
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
        provider_error: info.message,
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/status" && request.method === "GET")
        return handleStatus(env);

      if (url.pathname === "/api/chat" && request.method === "POST")
        return handleChat(request, env);

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
