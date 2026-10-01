export function shouldPrioritizeImageFidelity({
  hasSourceImage = false,
  taskMode = "create",
  preservationLevel = "medium",
  requiresTextAccuracy = false,
} = {}) {
  const preservationHeavy =
    Boolean(hasSourceImage) &&
    ["high", "maximum"].includes(
      String(preservationLevel || "")
    );

  const precisionMode = [
    "strict_edit",
    "enhance",
    "identity_lock",
  ].includes(String(taskMode || ""));

  return (
    preservationHeavy ||
    precisionMode ||
    Boolean(requiresTextAccuracy)
  );
}


export function shouldUseExpressImageEdit({
  prompt = "",
  requestedQuality = "fast",
  hasSourceImage = false,
  hasRootReference = false,
  extraReferencesUsed = 0,
  taskMode = "strict_edit",
  requiresTextAccuracy = false,
} = {}) {
  if (!hasSourceImage) return false;
  if (requestedQuality === "quality") return false;
  if (hasRootReference) return false;
  if (Number(extraReferencesUsed || 0) > 0) return false;
  if (requiresTextAccuracy) return false;

  const mode = String(taskMode || "");
  if (!["strict_edit", "remove_replace"].includes(mode)) {
    return false;
  }

  const text = String(prompt || "").trim();
  if (!text || text.length > 260) return false;

  const highRisk =
    /\b(rosto|face|identidade|mesma pessoa|pessoa|homem|mulher|crian[cç]a|personagem|cabelo|olhos?|boca|nariz|corpo|pose|fundo|background|cen[aá]rio|tatuagem|logo|texto|escreva|frase|placa|documento|assinatura)\b/i.test(text);

  if (highRisk) return false;

  const simpleLocalizedIntent =
    /\b(cor|color|tom|tonalidade|camisa|camiseta|roupa|cal[cç]a|sapato|t[eê]nis|objeto|item|remov|retir|tir|apag|limp|substitu|troqu|mud)\w*/i.test(text);

  return simpleLocalizedIntent;
}

export function shouldVerifyFastImageCandidate({
  hasSourceImage = false,
  requestedQuality = "fast",
  taskMode = "create",
  requiresTextAccuracy = false,
  manualExtraReferencesUsed = 0,
  expressEdit = false,
} = {}) {
  if (requestedQuality === "quality") return true;
  if (requiresTextAccuracy) return true;
  if (Number(manualExtraReferencesUsed || 0) > 0) return true;
  if (!hasSourceImage) return false;
  if (expressEdit) return false;

  return [
    "identity_lock",
    "enhance",
    "background",
    "remove_replace",
    "strict_edit",
  ].includes(String(taskMode || ""));
}
