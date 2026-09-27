import { InferenceClient } from "@huggingface/inference";

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const VERSION = "0.8.0";

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
    .slice(-32)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 7000),
    }));

  let total = 0;
  const kept = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const size = items[i].content.length;
    if (total + size > 48000 && kept.length >= 8) break;
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
      chat: Boolean(env.HF_TOKEN),
      search: Boolean(env.SEARXNG_URL),
      promptExpansion: Boolean(env.HF_TOKEN),
      vision: Boolean(env.HF_TOKEN),
      files: true,
      image: Boolean(env.HF_TOKEN),
      imageEdit: Boolean(env.HF_TOKEN),
      video: Boolean(env.HF_TOKEN),
    },
    models: {
      chat: env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest",
      chatFallback: "openai/gpt-oss-20b:fastest",
      promptExpander:
        env.HF_PROMPT_MODEL ||
        env.HF_CHAT_MODEL ||
        "openai/gpt-oss-120b:cheapest",
      vision: env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-3B-Instruct",
      caption:
        env.HF_IMAGE_CAPTION_MODEL || "Salesforce/blip-image-captioning-large",
      image: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      imageEdit:
        env.HF_IMAGE_EDIT_MODEL || "black-forest-labs/FLUX.1-Kontext-dev",
      video: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B",
      imageVideo: env.HF_IMAGE_VIDEO_MODEL || "Lightricks/LTX-Video",
    },
  });
}

async function runChat(model, messages, env, options = {}) {
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

  return { res, raw: await res.text(), model };
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

async function runTextChat(messages, env) {
  const primaryModel =
    env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest";
  const fallbackModel = "openai/gpt-oss-20b:fastest";

  let attempt = await runChat(primaryModel, messages, env);

  if (
    !attempt.res.ok &&
    primaryModel !== fallbackModel &&
    [400, 402, 404, 408, 429, 500, 502, 503, 504].includes(attempt.res.status)
  ) {
    attempt = await runChat(fallbackModel, messages, env);
  }

  return attempt;
}

function extractChatText(raw) {
  try {
    const data = JSON.parse(raw);
    return String(data?.choices?.[0]?.message?.content || "").trim();
  } catch {
    return "";
  }
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

  if (/quota|credit|payment|required|insufficient|402/i.test(text)) {
    return { status: 429, message: "Cota/créditos do provedor indisponíveis no momento." };
  }
  if (/rate.?limit|too many|429/i.test(text)) {
    return { status: 429, message: "O provedor está limitando requisições. Tente novamente em instantes." };
  }
  if (/not found|404|model.*unavailable|no provider/i.test(text)) {
    return { status: 503, message: "O modelo solicitado não está disponível por um provedor compatível agora." };
  }
  if (/timeout|timed out|504|408/i.test(text)) {
    return { status: 504, message: "O provedor demorou demais para responder." };
  }
  if (/<!doctype|<html/i.test(raw)) {
    return { status: 502, message: "O provedor devolveu uma página de erro em vez do resultado esperado." };
  }

  return {
    status: 502,
    message: text.slice(0, 1000) || "Falha no provedor de geração.",
  };
}

async function expandCreativePrompt({
  kind,
  prompt,
  history,
  previousPrompt,
  hasSourceImage,
  env,
}) {
  const original = String(prompt || "").trim();
  if (!original || !env.HF_TOKEN) {
    return { prompt: original, expanded: false, model: null };
  }

  const recent = cleanHistory(history).slice(-12);
  const model =
    env.HF_PROMPT_MODEL ||
    env.HF_CHAT_MODEL ||
    "openai/gpt-oss-120b:cheapest";

  const system = [
    "Você é o diretor criativo interno da NEXUS AI.",
    "Transforme pedidos visuais curtos em prompts de alta fidelidade sem alterar a intenção, o assunto, a quantidade de elementos nem o estilo pedido pelo usuário.",
    "Não force fotorealismo quando o usuário pedir ilustração, anime, desenho, pintura, 3D ou outro estilo.",
    "Preserve nomes, cores, roupas, objetos, cenário, identidade visual e restrições mencionadas.",
    "Evite texto decorativo, explicações, aspas, listas e comentários: devolva somente o prompt final.",
    kind === "image"
      ? "Para imagem, detalhe composição, enquadramento, ambiente, materiais, textura, iluminação, profundidade, atmosfera e câmera/lente somente quando fizer sentido."
      : "Para vídeo, detalhe sujeito, ação ao longo do tempo, movimento físico, movimento de câmera, enquadramento, ambiente, iluminação, atmosfera e continuidade temporal. Evite ações contraditórias.",
    hasSourceImage
      ? "Existe uma imagem de referência. Trate o pedido como edição/continuação: preserve tudo que o usuário não pediu para mudar e descreva claramente apenas as mudanças e a continuidade necessária."
      : "Não existe imagem de referência. Construa a cena completa de forma coerente.",
    "Se o pedido já estiver detalhado, refine-o sem inflar desnecessariamente.",
  ].join(" ");

  const contextParts = [];
  if (previousPrompt) {
    contextParts.push("Contexto visual anterior: " + String(previousPrompt).slice(0, 5000));
  }
  contextParts.push("Pedido atual do usuário: " + original);

  const messages = [
    { role: "system", content: system },
    ...recent,
    { role: "user", content: contextParts.join("\n\n") },
  ];

  let attempt = await runChat(model, messages, env, {
    maxTokens: kind === "video" ? 750 : 600,
    temperature: 0.62,
    topP: 0.92,
  });

  if (!attempt.res.ok && model !== "openai/gpt-oss-20b:fastest") {
    attempt = await runChat("openai/gpt-oss-20b:fastest", messages, env, {
      maxTokens: kind === "video" ? 750 : 600,
      temperature: 0.62,
      topP: 0.92,
    });
  }

  if (!attempt.res.ok) {
    return { prompt: original, expanded: false, model: null };
  }

  const expanded = extractChatText(attempt.raw);
  if (!expanded || expanded.length < Math.min(24, original.length)) {
    return { prompt: original, expanded: false, model: attempt.model };
  }

  return {
    prompt: expanded.slice(0, 7000),
    expanded: expanded !== original,
    model: attempt.model,
  };
}

async function handleChat(request, env) {
  const body = await request.json();
  const message = String(body.message || "").trim();
  const mode = body.mode === "search" ? "search" : "chat";
  const history = cleanHistory(body.history);
  const attachment = body.attachment || null;

  if (!message) return json({ error: "Mensagem vazia." }, 400);
  if (!env.HF_TOKEN)
    return json({ error: "HF_TOKEN ainda não foi configurado." }, 503);

  let search = { results: [], unavailable: false };
  if (mode === "search") {
    search = await searchWeb(message, env);
    if (search.unavailable) {
      return json(
        {
          error:
            "A pesquisa web ainda não está configurada. Falta SEARXNG_URL no Cloudflare.",
        },
        503
      );
    }
  }

  const webContext = search.results.length
    ? "\n\nCONTEXTO DA WEB (use somente quando relevante e não invente além dele):\n" +
      search.results
        .map(
          (r, i) =>
            "[" +
            (i + 1) +
            "] " +
            r.title +
            "\n" +
            r.url +
            "\n" +
            r.content
        )
        .join("\n\n")
    : "";

  const system = [
    "Você é NEXUS AI, um assistente geral de alta qualidade.",
    "Use o histórico para manter continuidade real e resolver referências curtas como 'por quê?', 'continua', 'isso' e pronomes.",
    "Responda no idioma do usuário, seja direto quando a pergunta for simples e aprofunde quando a tarefa exigir.",
    "Analise cuidadosamente arquivos e imagens anexados quando existirem.",
    "Não invente fatos, fontes, memórias nem ações.",
    "Se houver incerteza relevante, diga qual é a incerteza em vez de fingir certeza.",
    "Evite recusas genéricas: diferencie pedidos informativos, educativos, analíticos, fictícios ou preventivos de pedidos realmente operacionais de alto risco.",
    "Quando alguma parte precisar ser limitada, limite somente essa parte e continue útil com contexto ou alternativas seguras.",
    "Não moralize e não repita avisos desnecessários.",
  ].join(" ");

  let userText = message + webContext;

  if (attachment?.kind === "text" && typeof attachment.text === "string") {
    const fileText = attachment.text.slice(0, 60000);
    userText +=
      "\n\nARQUIVO ANEXADO: " +
      String(attachment.name || "arquivo") +
      "\n--- INÍCIO DO ARQUIVO ---\n" +
      fileText +
      "\n--- FIM DO ARQUIVO ---";
  }

  let attempt;

  if (
    attachment?.kind === "image" &&
    typeof attachment.dataUrl === "string" &&
    attachment.dataUrl.startsWith("data:image/")
  ) {
    const visionModel =
      env.HF_VISION_MODEL || "Qwen/Qwen2.5-VL-3B-Instruct";

    const visionMessages = [
      { role: "system", content: system },
      ...history,
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: { url: attachment.dataUrl },
          },
        ],
      },
    ];

    attempt = await runChat(visionModel, visionMessages, env, {
      maxTokens: 1800,
      temperature: 0.55,
      topP: 0.9,
    });

    if (!attempt.res.ok) {
      const imageBlob = dataUrlToBlob(attachment.dataUrl);
      if (imageBlob) {
        try {
          const client = new InferenceClient(env.HF_TOKEN);
          const captionModel =
            env.HF_IMAGE_CAPTION_MODEL ||
            "Salesforce/blip-image-captioning-large";
          const caption = await client.imageToText({
            model: captionModel,
            data: imageBlob,
          });
          const captionText =
            caption?.generated_text ||
            caption?.text ||
            JSON.stringify(caption).slice(0, 4000);

          const fallbackMessages = [
            { role: "system", content: system },
            ...history,
            {
              role: "user",
              content:
                userText +
                "\n\nDescrição automática obtida da imagem anexada: " +
                captionText,
            },
          ];
          attempt = await runTextChat(fallbackMessages, env);
        } catch {}
      }
    }
  } else {
    const messages = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: userText },
    ];
    attempt = await runTextChat(messages, env);
  }

  if (!attempt?.res?.ok) {
    return json(
      {
        error:
          "Falha no modelo: " +
          parseProviderError(attempt?.raw || "provedor indisponível"),
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
        error: "O provedor de chat devolveu uma resposta inválida.",
        provider_error: parseProviderError(attempt.raw),
        model: attempt.model,
      },
      502
    );
  }

  const answer =
    data?.choices?.[0]?.message?.content || "O modelo respondeu sem texto.";

  return json({
    answer,
    model: attempt.model,
    sources: search.results.map((r) => ({
      title: r.title,
      url: r.url,
    })),
    usage: data?.usage || null,
  });
}

async function handleImage(request, env) {
  if (!env.HF_TOKEN)
    return json({ error: "HF_TOKEN não configurado." }, 503);

  const body = await request.json();
  const prompt = String(body.prompt || "").trim();
  const history = cleanHistory(body.history);
  const sourceImage = dataUrlToBlob(body.sourceImage);
  const previousPrompt = String(body.previousPrompt || "")
    .trim()
    .slice(0, 6000);

  if (!prompt) return json({ error: "Prompt vazio." }, 400);

  const expansion = await expandCreativePrompt({
    kind: "image",
    prompt,
    history,
    previousPrompt,
    hasSourceImage: Boolean(sourceImage),
    env,
  });

  const promptForModel = expansion.prompt;
  const client = new InferenceClient(env.HF_TOKEN);
  const imageModel =
    env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const editModel =
    env.HF_IMAGE_EDIT_MODEL || "black-forest-labs/FLUX.1-Kontext-dev";

  if (sourceImage) {
    try {
      const edited = await client.imageToImage({
        model: editModel,
        inputs: sourceImage,
        parameters: {
          prompt: promptForModel,
        },
      });

      return new Response(edited, {
        headers: {
          "Content-Type": edited.type || "image/png",
          "Cache-Control": "no-store",
          "X-Nexus-Image-Mode": "edit",
          "X-Nexus-Model": editModel,
          "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
          "X-Nexus-Prompt-Model": expansion.model || "",
        },
      });
    } catch (editError) {
      try {
        const continuityPrompt = [
          "Create a visually consistent continuation of the previous scene.",
          previousPrompt ? "Previous visual context: " + previousPrompt : "",
          "Preserve the same main subject and all unchanged visual details.",
          "Current requested result: " + promptForModel,
        ].filter(Boolean).join(" ");

        const regenerated = await client.textToImage({
          model: imageModel,
          inputs: continuityPrompt,
        });

        return new Response(regenerated, {
          headers: {
            "Content-Type": regenerated.type || "image/png",
            "Cache-Control": "no-store",
            "X-Nexus-Image-Mode": "continuity-fallback",
            "X-Nexus-Model": imageModel,
            "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
            "X-Nexus-Prompt-Model": expansion.model || "",
            "X-Nexus-Edit-Fallback": "1",
          },
        });
      } catch (fallbackError) {
        const info = generationError(fallbackError);
        return json(
          {
            error: "Não consegui gerar a imagem.",
            provider_error: info.message,
            attempted_model: imageModel,
            edit_model: editModel,
            prompt_expanded: expansion.expanded,
          },
          info.status
        );
      }
    }
  }

  try {
    const image = await client.textToImage({
      model: imageModel,
      inputs: promptForModel,
    });

    return new Response(image, {
      headers: {
        "Content-Type": image.type || "image/png",
        "Cache-Control": "no-store",
        "X-Nexus-Image-Mode": "new",
        "X-Nexus-Model": imageModel,
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
        attempted_model: imageModel,
        prompt_expanded: expansion.expanded,
      },
      info.status
    );
  }
}

async function handleVideo(request, env) {
  if (!env.HF_TOKEN)
    return json({ error: "HF_TOKEN não configurado." }, 503);

  const body = await request.json();
  const prompt = String(body.prompt || "").trim();
  const history = cleanHistory(body.history);
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
    env,
  });

  const promptForModel = expansion.prompt;
  const client = new InferenceClient(env.HF_TOKEN);

  if (sourceImage && typeof client.imageTextToVideo === "function") {
    const imageVideoModel =
      env.HF_IMAGE_VIDEO_MODEL || "Lightricks/LTX-Video";

    try {
      const video = await client.imageTextToVideo({
        model: imageVideoModel,
        inputs: sourceImage,
        parameters: { prompt: promptForModel },
      });

      return new Response(video, {
        headers: {
          "Content-Type": video.type || "video/mp4",
          "Cache-Control": "no-store",
          "X-Nexus-Video-Mode": "image-to-video",
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
      inputs: promptForModel,
    });

    return new Response(video, {
      headers: {
        "Content-Type": video.type || "video/mp4",
        "Cache-Control": "no-store",
        "X-Nexus-Video-Mode": "text-to-video",
        "X-Nexus-Model": videoModel,
        "X-Nexus-Prompt-Expanded": expansion.expanded ? "1" : "0",
        "X-Nexus-Prompt-Model": expansion.model || "",
      },
    });
  } catch (error) {
    const info = generationError(error);
    return json(
      {
        error: "Não consegui gerar o vídeo.",
        provider_error: info.message,
        attempted_model: videoModel,
        prompt_expanded: expansion.expanded,
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
