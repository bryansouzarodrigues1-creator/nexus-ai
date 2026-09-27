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
    version: "0.3.0",
    providers: {
      chat: Boolean(env.HF_TOKEN),
      search: Boolean(env.SEARXNG_URL),
      image: Boolean(env.HF_TOKEN),
      video: Boolean(env.HF_TOKEN)
    },
    models: {
      chat: env.HF_CHAT_MODEL || "openai/gpt-oss-20b:fastest",
      image: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      video: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B"
    }
  });
}

async function handleChat(request, env) {
  const body = await request.json();
  const message = String(body.message || "").trim();
  const mode = body.mode === "search" ? "search" : "chat";
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

  const model = env.HF_CHAT_MODEL || "openai/gpt-oss-20b:fastest";
  const res = await fetch(HF_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.HF_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 900,
      messages: [
        { role: "system", content: "Você é NEXUS AI, um assistente geral, direto e útil. Responda em português quando o usuário falar em português. Não invente fontes." },
        { role: "user", content: message + context }
      ]
    })
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw;
    try { detail = JSON.parse(raw)?.error?.message || raw; } catch {}
    return json({ error: "Falha no provedor: " + detail }, 502);
  }

  const data = JSON.parse(raw);
  return json({
    answer: data?.choices?.[0]?.message?.content || "O modelo respondeu sem texto.",
    model,
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
