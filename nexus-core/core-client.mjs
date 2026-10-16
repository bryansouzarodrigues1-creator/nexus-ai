/**
 * Optional, isolated experimental client for an operator-hosted llama.cpp server.
 * No code in the production Worker imports this module in NEXUS Core 0.1.
 * Cloud/remote connections must use HTTPS and a server-side API key.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class CoreClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoreClientError";
    this.code = code;
  }
}

export function normalizeCoreEndpoint(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new CoreClientError("NOT_CONFIGURED", "NEXUS Core não tem endpoint configurado.");
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CoreClientError("INVALID_ENDPOINT", "Endpoint inválido.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new CoreClientError("INVALID_ENDPOINT", "Endpoint não pode conter credenciais, query ou fragmento.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new CoreClientError("INSECURE_ENDPOINT", "Servidor remoto requer HTTPS.");
  }
  if (!["/", "/v1", "/v1/"].includes(url.pathname)) {
    throw new CoreClientError("INVALID_ENDPOINT", "Use somente a origem ou /v1 como endereço base.");
  }
  return url.origin + "/v1/chat/completions";
}

function validateConfiguration(config) {
  const endpoint = normalizeCoreEndpoint(config.baseUrl);
  const key = String(config.apiKey || "");
  if (key.length < 24 || /^(?:replace|example|changeme)/i.test(key)) {
    throw new CoreClientError("MISSING_KEY", "Configure uma chave secreta longa no servidor.");
  }
  const model = String(config.model || "nexus-core-0.1");
  if (!/^[\w.\-:/]{1,120}$/.test(model)) {
    throw new CoreClientError("INVALID_MODEL", "Identificador de modelo inválido.");
  }
  return { endpoint, key, model };
}

export async function queryNexusCore(
  config,
  messages,
  { fetcher = fetch, maxTokens = 256, timeoutMs = 60000 } = {}
) {
  const { endpoint, key, model } = validateConfiguration(config || {});
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30) {
    throw new CoreClientError("INVALID_MESSAGES", "Envie de 1 a 30 mensagens.");
  }
  const sanitized = messages.map(message => {
    if (!["system", "user", "assistant"].includes(message?.role) ||
        typeof message?.content !== "string" || !message.content.trim() ||
        message.content.length > 12000) {
      throw new CoreClientError("INVALID_MESSAGES", "Mensagens devem ter papel válido e texto limitado.");
    }
    return { role: message.role, content: message.content };
  });
  const limit = Math.max(16, Math.min(1024, Math.round(Number(maxTokens) || 256)));
  const deadline = Math.max(1000, Math.min(120000, Math.round(Number(timeoutMs) || 60000)));
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), deadline);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model,
        messages: sanitized,
        stream: false,
        max_tokens: limit,
      }),
      redirect: "error",
      signal: abortController.signal,
    });
    if (!response?.ok) {
      throw new CoreClientError("UPSTREAM_ERROR",
        "NEXUS Core indisponível (HTTP " + (Number(response?.status) || 502) + ").");
    }
    const text = await response.text();
    if (text.length > 750000) {
      throw new CoreClientError("INVALID_RESPONSE", "Resposta do modelo excedeu o limite.");
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CoreClientError("INVALID_RESPONSE", "Modelo não respondeu em JSON válido.");
    }
    const answer = body?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new CoreClientError("EMPTY_RESPONSE", "Modelo respondeu sem texto.");
    }
    return {
      answer: answer.trim().slice(0, 50000),
      model: String(body.model || model).slice(0, 140),
      finishReason: String(body?.choices?.[0]?.finish_reason || "").slice(0, 40),
      usage: body.usage && typeof body.usage === "object" ? body.usage : null,
      provider: "nexus-core-self-hosted",
    };
  } catch (error) {
    if (error instanceof CoreClientError) throw error;
    throw new CoreClientError(
      abortController.signal.aborted ? "TIMEOUT" : "CONNECTION_FAILED",
      abortController.signal.aborted
        ? "O servidor NEXUS Core demorou demais para responder."
        : "Não foi possível contactar o servidor NEXUS Core."
    );
  } finally {
    clearTimeout(timer);
  }
}
