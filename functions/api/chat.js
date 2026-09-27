const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

async function searchWeb(query, env) {
  if (!env.SEARXNG_URL) return { results: [], unavailable: true };
  const base = env.SEARXNG_URL.replace(/\/$/, "");
  const url = base + "/search?q=" + encodeURIComponent(query) + "&format=json&language=pt-BR&safesearch=0";
  const res = await fetch(url, { headers: { "User-Agent": "NEXUS-AI/0.2" } });
  if (!res.ok) throw new Error("SearXNG respondeu " + res.status);
  const data = await res.json();
  const results = (data.results || []).slice(0, 6).map(r => ({
    title: r.title || "",
    url: r.url || "",
    content: r.content || ""
  }));
  return { results, unavailable: false };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const message = String(body.message || "").trim();
    const mode = body.mode === "search" ? "search" : "chat";
    if (!message) return Response.json({ error: "Mensagem vazia." }, { status: 400 });
    if (!env.HF_TOKEN) return Response.json({ error: "HF_TOKEN ainda não foi configurado no Cloudflare." }, { status: 503 });

    let search = { results: [], unavailable: false };
    if (mode === "search") {
      search = await searchWeb(message, env);
      if (search.unavailable) {
        return Response.json({ error: "Pesquisa ainda não configurada. Adicione SEARXNG_URL nas variáveis do Cloudflare." }, { status: 503 });
      }
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
        "Authorization": "Bearer " + env.HF_TOKEN,
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
      return Response.json({ error: "Falha no provedor: " + detail }, { status: 502 });
    }

    const data = JSON.parse(raw);
    const answer = data?.choices?.[0]?.message?.content;
    return Response.json({
      answer: answer || "O modelo respondeu sem texto.",
      model,
      sources: search.results.map(r => ({ title: r.title, url: r.url }))
    });
  } catch (error) {
    return Response.json({ error: error?.message || "Erro interno." }, { status: 500 });
  }
}
