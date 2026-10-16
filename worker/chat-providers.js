import { withDeadline } from "./chat-timeout.js";

// In-memory per-isolate health. Never persist API tokens or prompt contents.
const cooldowns = new Map();
const PROVIDERS = Object.freeze({
  groq: {
    key: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "openai/gpt-oss-120b",
    quickModel: "openai/gpt-oss-20b",
    vision: false,
  },
  gemini: {
    key: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    quickModel: "gemini-2.5-flash-lite",
    vision: true,
  },
  openrouter: {
    key: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "openrouter/free",
    quickModel: "openrouter/free",
    vision: true,
  },
});

export function getChatProviderStatus(env = {}) {
  return {
    cloudflare: Boolean(env.AI),
    groq: Boolean(env.GROQ_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
    huggingface: Boolean(env.HF_TOKEN),
  };
}

export function availableChatProviders(env = {}, { vision = false, quickReply = false } = {}) {
  return Object.entries(PROVIDERS)
    .filter(([, item]) => Boolean(env[item.key]) && (!vision || item.vision))
    .map(([name, item]) => ({
      name,
      url: item.url,
      key: env[item.key],
      model: String(env[name.toUpperCase() + "_CHAT_MODEL"] || (quickReply ? item.quickModel : item.model)),
    }));
}

export function isProviderCoolingDown(name, now = Date.now()) {
  return (cooldowns.get(name) || 0) > now;
}

export function noteProviderResult(name, attempt, now = Date.now()) {
  if (attempt?.ok) {
    cooldowns.delete(name);
    return;
  }
  const status = Number(attempt?.status) || 0;
  const raw = String(attempt?.raw || "");
  let duration = 0;
  if (status === 402 || /no remaining credits|insufficient (balance|credit)|quota exhausted|billing.*(required|disabled)/i.test(raw)) {
    duration = 6 * 60 * 60 * 1000;
  } else if (status === 401 || status === 403) {
    duration = 60 * 60 * 1000;
  } else if (status === 429) {
    duration = 90 * 1000;
  } else if (status === 404) {
    duration = 15 * 60 * 1000;
  } else if (status === 504 || /tempo limite|timeout|timed out/i.test(raw)) {
    duration = 45 * 1000;
  } else if (status >= 500) {
    duration = 25 * 1000;
  }
  if (duration) cooldowns.set(name, now + duration);
}

function modelText(data) {
  const value = data?.choices?.[0]?.message?.content ?? data?.response ?? data?.output_text;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(x => typeof x === "string" ? x : x?.text || x?.content || "").join("").trim();
  return "";
}

export async function callExternalChat(candidate, messages, options = {}, fetcher = fetch) {
  const provider = candidate.name;
  const model = candidate.model;
  try {
    const response = await withDeadline(async signal => {
      const result = await fetcher(candidate.url, {
        method: "POST",
        signal,
        headers: {
          Authorization: "Bearer " + candidate.key,
          "Content-Type": "application/json",
          ...(provider === "openrouter" ? { "X-Title": "NEXUS AI" } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          max_tokens: Math.min(Math.max(160, Number(options.maxTokens) || 1024), 2800),
          temperature: options.temperature ?? 0.65,
        }),
      });
      const raw = await result.text();
      return { ok: result.ok, status: result.status, raw };
    }, options.timeoutMs || 6000, provider);
    if (!response.ok) {
      let details = "";
      try {
        const parsed = JSON.parse(response.raw);
        details = String(parsed?.error?.message || parsed?.error || parsed?.message || "");
      } catch {}
      return {
        ok: false, status: response.status,
        raw: details.slice(0, 280) || "HTTP " + response.status,
        model, provider,
      };
    }
    let data;
    try { data = JSON.parse(response.raw); } catch {}
    const answer = modelText(data);
    if (!answer) {
      return { ok: false, status: 502, raw: "Resposta sem texto utilizável.", model, provider };
    }
    return {
      ok: true,
      status: 200,
      // Preserve the exact response schema consumed by the existing chat UI.
      raw: JSON.stringify({
        choices: [{ message: { role: "assistant", content: answer } }],
        usage: data?.usage || null,
        citations: data?.citations || [],
      }),
      model: data?.model || model,
      provider,
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.code === "NEXUS_TIMEOUT" ? 504 : 503,
      raw: error?.code === "NEXUS_TIMEOUT" ? "Tempo limite de resposta do provedor." : "Falha de conexão com o provedor.",
      model,
      provider,
    };
  }
}
