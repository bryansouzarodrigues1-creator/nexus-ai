import { InferenceClient } from "@huggingface/inference";

const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function searchWeb(query, env) {
  if (!env.SEARXNG_URL) return { results: [], unavailable: true };
  const base = env.SEARXNG_URL.replace(/\/$/, "");
  const url = base + "/search?q=" + encodeURIComponent(query) + "&format=json&language=pt-BR&safesearch=0";
  const res = await fetch(url, { headers: { "User-Agent": "NEXUS-AI/0.3" } });
  if (!res.ok) throw new Error("SearXNG respondeu " + res.status);
  const data = await res.json();
  return {
    unavailable: false,
    results: (data.results || []).slice(0, 6).map(r => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || ""
    }))
  };
}

async function handleStatus(env) {
  return json({
    ok: true,
    version: "0.4.0",
    providers: {
      chat: Boolean(env.HF_TOKEN),
      search: Boolean(env.SEARXNG_URL),
      image: Boolean(env.HF_TOKEN),
      video: Boolean(env.HF_TOKEN)
    },
    models: {
      chat: env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest",
      image: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      video: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B"
    }
  });
}

async function handleChat(request, env) {
  const body = await request.json();
  const message = String(body.message || "").trim();
  const mode = body.mode === "search" ? "search" : "chat";
  const history = Array.isArray(body.history)
    ? body.history
        .filter(m => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }))
    : [];
  if (!message) return json({ error: "Mensagem vazia." }, 400);
  if (!env.HF_TOKEN) return json({ error: "HF_TOKEN ainda não foi configurado no Cloudflare." }, 503);

  let search = { results: [], unavailable: false };
  if (mode === "search") {
    search = await searchWeb(message, env);
    if (search.unavailable) return json({ error: "Pesquisa ainda não configurada. Adicione SEARXNG_URL." }, 503);
  }

  const context = search.results.length
    ? "\n\nRESULTADOS DE PESQUISA:\n" + search.results.map((r, i) =>
      "[" + (i + 1) + "] " + r.title + "\n" + r.url + "\n" + r.content
    ).join("\n\n")
    : "";

  const primaryModel = env.HF_CHAT_MODEL || "openai/gpt-oss-120b:cheapest";
  const fallbackModel = "openai/gpt-oss-20b:fastest";
  const system = [
    "Você é NEXUS AI, um assistente geral, inteligente, direto e útil.",
    "Mantenha continuidade entre as mensagens da conversa. Resolva referências curtas como 'por quê?', 'e isso?', 'continua' e pronomes usando o histórico recebido.",
    "Nunca diga que falta contexto quando o histórico já contém o contexto necessário.",
    "Responda no idioma do usuário e adapte o nível de detalhe ao pedido.",
    "Não invente fatos, fontes ou ações que não aconteceram.",
    "Quando um pedido for perigoso ou ilegal, não forneça instruções acionáveis; explique brevemente o motivo e ofereça ajuda segura relacionada, preservando o contexto da conversa."
  ].join(" ");

  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: message + context }
  ];

  async function runModel(model) {
    const res = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.HF_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 1400,
        messages
      })
    });
    return { res, raw: await res.text(), model };
  }

  let attempt = await runModel(primaryModel);
  if (!attempt.res.ok && primaryModel !== fallbackModel && [400, 402, 404, 429, 503].includes(attempt.res.status)) {
    attempt = await runModel(fallbackModel);
  }

  if (!attempt.res.ok) {
    let detail = attempt.raw;
    try { detail = JSON.parse(attempt.raw)?.error?.message || attempt.raw; } catch {}
    return json({ error: "Falha no provedor: " + detail }, 502);
  }

  const data = JSON.parse(attempt.raw);
  return json({
    answer: data?.choices?.[0]?.message?.content || "O modelo respondeu sem texto.",
    model: attempt.model,
    sources: search.results.map(r => ({ title: r.title, url: r.url }))
  });
}

async function handleImage(request, env) {
  if (!env.HF_TOKEN) return json({ error: "HF_TOKEN não configurado." }, 503);
  const { prompt } = await request.json();
  if (!String(prompt || "").trim()) return json({ error: "Prompt vazio." }, 400);
  const client = new InferenceClient(env.HF_TOKEN);
  const blob = await client.textToImage({
    model: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
    inputs: String(prompt).trim()
  });
  return new Response(blob, {
    headers: { "Content-Type": blob.type || "image/png", "Cache-Control": "no-store" }
  });
}

async function handleVideo(request, env) {
  if (!env.HF_TOKEN) return json({ error: "HF_TOKEN não configurado." }, 503);
  const { prompt } = await request.json();
  if (!String(prompt || "").trim()) return json({ error: "Prompt vazio." }, 400);
  const client = new InferenceClient(env.HF_TOKEN);
  const blob = await client.textToVideo({
    model: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B",
    inputs: String(prompt).trim()
  });
  return new Response(blob, {
    headers: { "Content-Type": blob.type || "video/mp4", "Cache-Control": "no-store" }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/status" && request.method === "GET") return handleStatus(env);
      if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
      if (url.pathname === "/api/image" && request.method === "POST") return handleImage(request, env);
      if (url.pathname === "/api/video" && request.method === "POST") return handleVideo(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error?.message || "Erro interno." }, 500);
    }
  }
};
