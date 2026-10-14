// Select learned instructions only when they are relevant to the current request.
// This avoids poisoning a new image/chat with unrelated feedback from other tasks.
const STOP = new Set([
  "para","com","sem","uma","uns","das","dos","nos","nas","que","quando",
  "quero","faca","fazer","imagem","foto","criar","gerar","pedido",
  "este","esta","esse","essa","mais","muito","apenas","sobre","nao",
  "the","and","for","with","from","make","image","photo","please",
]);
function words(value) {
  const valueText = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return new Set((valueText.match(/[a-z0-9]{4,}/g) || []).filter(x => !STOP.has(x)));
}
export function selectRelevantLessons(lessons, request, limit = 8) {
  const requestTerms = words(request);
  if (!requestTerms.size) return [];
  return (Array.isArray(lessons) ? lessons : [])
    .filter(item => Number(item?.confidence || 0) >= 0.6)
    .map(item => {
      const triggerTerms = words(item?.trigger || "");
      const guidanceTerms = words(item?.guidance || "");
      const terms = triggerTerms.size ? triggerTerms : guidanceTerms;
      let matched = 0;
      for (const term of terms) if (requestTerms.has(term)) matched += 1;
      // For specific triggers, require lexical evidence of related tasks.
      const required = Math.min(2, Math.max(1, Math.floor(terms.size / 5)));
      const relevance = terms.size && matched >= required
        ? matched / Math.min(8, Math.max(1, terms.size))
        : 0;
      return { item, relevance };
    })
    .filter(entry => entry.relevance >= 0.16)
    .sort((a, b) =>
      b.relevance - a.relevance ||
      Number(b.item.confidence || 0) - Number(a.item.confidence || 0) ||
      Number(b.item.at || 0) - Number(a.item.at || 0)
    )
    .slice(0, Math.max(0, limit))
    .map(entry => ({
      taskType: entry.item.taskType,
      trigger: entry.item.trigger,
      guidance: entry.item.guidance,
      confidence: entry.item.confidence,
      signal: entry.item.signal,
    }));
}
