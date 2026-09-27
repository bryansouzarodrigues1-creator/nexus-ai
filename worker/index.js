import { InferenceClient } from "@huggingface/inference";

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const VERSION = "0.6.0";

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

  if (!res.ok) throw new Error("Pesquisa web respondeu " + res.status);

  const data = await res.json();
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
      image: Boolean(env.HF_TOKEN),
      imageEdit: Boolean(env.HF_TOKEN),
      video: Boolean(env.HF_TOKEN),
    },
    models: {
      chat: env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest",
      chatFallback: "openai/gpt-oss-20b:fastest",
      image: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      imageEdit:
        env.HF_IMAGE_EDIT_MODEL || "black-forest-labs/FLUX.1-Kontext-dev",
      video: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B",
      imageVideo: env.HF_IMAGE_VIDEO_MODEL || "Lightricks/LTX-Video",
    },
  });
}

async function runChat(model, messages, env) {
  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.HF_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 1800,
      temperature: 0.72,
      top_p: 0.95,
      messages,
    }),
  });

  return { res, raw: await res.text(), model };
}

async function handleChat(request, env) {
  const body = await request.json();
  const message = String(body.message || "").trim();
  const mode = body.mode === "search" ? "search" : "chat";
  const history = cleanHistory(body.history);

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
    "Não invente fatos, fontes, memórias nem ações.",
    "Se houver incerteza relevante, diga qual é a incerteza em vez de fingir certeza.",
    "Evite recusas genéricas: diferencie pedidos informativos, educativos, analíticos, fictícios ou preventivos de pedidos realmente operacionais de alto risco.",
    "Quando alguma parte precisar ser limitada, limite somente essa parte e continue útil com contexto ou alternativas seguras.",
    "Não moralize e não repita avisos desnecessários.",
  ].join(" ");

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: message + webContext },
  ];

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

  if (!attempt.res.ok) {
    let detail = attempt.raw;
    try {
      const parsed = JSON.parse(attempt.raw);
      detail = parsed?.error?.message || parsed?.error || attempt.raw;
    } catch {}
    return json({ error: "Falha no modelo: " + String(detail).slice(0, 1200) }, 502);
  }

  const data = JSON.parse(attempt.raw);
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
  const sourceImage = dataUrlToBlob(body.sourceImage);
  const previousPrompt = String(body.previousPrompt || "").trim().slice(0, 6000);

  if (!prompt) return json({ error: "Prompt vazio." }, 400);

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
          prompt:
            "Edit the supplied image while preserving the identity, appearance, composition and important details of the existing subject unless the instruction explicitly changes them. User edit: " +
            prompt,
        },
      });

      return new Response(edited, {
        headers: {
          "Content-Type": edited.type || "image/png",
          "Cache-Control": "no-store",
          "X-Nexus-Image-Mode": "edit",
          "X-Nexus-Model": editModel,
        },
      });
    } catch (editError) {
      const continuityPrompt = previousPrompt
        ? "Create a visually consistent continuation of the previous scene. Previous scene: " +
          previousPrompt +
          ". New change: " +
          prompt +
          ". Preserve the same main subject, visual identity and scene details unless explicitly changed."
        : prompt;

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
          "X-Nexus-Edit-Fallback": "1",
        },
      });
    }
  }

  const image = await client.textToImage({
    model: imageModel,
    inputs: prompt,
  });

  return new Response(image, {
    headers: {
      "Content-Type": image.type || "image/png",
      "Cache-Control": "no-store",
      "X-Nexus-Image-Mode": "new",
      "X-Nexus-Model": imageModel,
    },
  });
}

async function handleVideo(request, env) {
  if (!env.HF_TOKEN)
    return json({ error: "HF_TOKEN não configurado." }, 503);

  const body = await request.json();
  const prompt = String(body.prompt || "").trim();
  const sourceImage = dataUrlToBlob(body.sourceImage);

  if (!prompt) return json({ error: "Prompt vazio." }, 400);

  const client = new InferenceClient(env.HF_TOKEN);

  if (sourceImage && typeof client.imageTextToVideo === "function") {
    const imageVideoModel =
      env.HF_IMAGE_VIDEO_MODEL || "Lightricks/LTX-Video";
    try {
      const video = await client.imageTextToVideo({
        model: imageVideoModel,
        inputs: sourceImage,
        parameters: { prompt },
      });

      return new Response(video, {
        headers: {
          "Content-Type": video.type || "video/mp4",
          "Cache-Control": "no-store",
          "X-Nexus-Video-Mode": "image-to-video",
          "X-Nexus-Model": imageVideoModel,
        },
      });
    } catch {}
  }

  const videoModel =
    env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B";
  const video = await client.textToVideo({
    model: videoModel,
    inputs: prompt,
  });

  return new Response(video, {
    headers: {
      "Content-Type": video.type || "video/mp4",
      "Cache-Control": "no-store",
      "X-Nexus-Video-Mode": "text-to-video",
      "X-Nexus-Model": videoModel,
    },
  });
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
