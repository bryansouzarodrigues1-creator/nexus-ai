// Keep API failures readable: Cloudflare/SPA error pages are HTML, not JSON.
export async function readApiJson(response, context = "a solicitação") {
  if (!response || typeof response.text !== "function") {
    throw new Error("A API não retornou uma resposta válida.");
  }
  const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
  const raw = await response.text();
  const trimmed = raw.trim();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksJson && !type.includes("json")) {
    const hint = /<!doctype|<html/i.test(raw)
      ? "O servidor devolveu uma página HTML em vez da resposta da API."
      : "O servidor devolveu um formato inesperado.";
    throw new Error(`Não foi possível concluir ${context} (HTTP ${response.status}). ${hint} Verifique a conexão ou a rota do backend.`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`A resposta de ${context} veio inválida (HTTP ${response.status}). Tente novamente; se persistir, verifique os logs do Worker.`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Formato de resposta inesperado em ${context} (HTTP ${response.status}).`);
  }
  return data;
}
