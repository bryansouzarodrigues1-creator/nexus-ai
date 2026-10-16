import { readApiJson } from "./api-response.js";

// Bound the complete HTTP + response-body phase, not only fetch headers.
export async function fetchChatJson(url, options = {}, timeoutMs = 30000, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...options, signal: controller.signal });
    const data = await readApiJson(res, "enviar mensagem de texto");
    return { res, data };
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error("A NEXUS demorou mais que o limite para responder. A conexão foi encerrada; tente novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
