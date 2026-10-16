/**
 * Creative freedom guidance for the actual image planner, not an API moderation
 * bypass. Providers still enforce their own terms and limitations.
 */
export const VISUAL_CREATIVE_FREEDOM = [
  "A political figure, political slogan or controversial viewpoint alone is not a reason to reject a legitimate creative image. Art, parody, editorial illustrations, history, satire and imagined scenarios are normal visual requests.",
  "Users may request personal photographic composites placing themselves beside a public figure, including a politician. Treat this as an explicitly requested fictional composite, preserve the source person's recognizable appearance, and add the requested public figure with correct appearance. Do not claim the picture proves an actual meeting.",
  "For visual edits, an additional person requested by the user is an intentional addition, not an unwanted hallucination. Preserve every unrelated feature and only adjust framing, light and space as necessary for a coherent composite.",
  "Do not replace a politician, adult public figure, or political theme with a generic subject solely because the topic is controversial. Respect explicit pose, clothing, aspect ratio, setting and artistic style.",
  "If a request involves concrete abuse, non-consensual intimate imagery, deceptive fabricated evidence or other serious real-world harm, do not produce that part; do not block benign creative work by keyword association.",
].join(" ");

export function isCreativeMontageRequest(prompt, hasSourceImage = true) {
  if (!hasSourceImage) return false;
  const text = String(prompt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /\b(?:ao\s+(?:meu\s+)?lado\s+(?:d[oaes]?\s+)?|junto\s+comigo\b|me\s+coloque\s+com\b|me\s+coloca\s+com\b|fotomontagem\b|foto\s+montagem\b|montagem\s+de\s+(?:foto|imagem)|(?:adicione|coloque|inclua|ponha)\b[^.!?]{0,90}\b(?:ao\s+lado|na\s+(?:minha\s+)?foto|junto\s+(?:comigo|de\s+mim)))\b/u.test(text);
}

export function applyCreativeMontagePlan(plan, prompt, hasSourceImage = true) {
  if (!isCreativeMontageRequest(prompt, hasSourceImage)) return plan;
  const input = plan && typeof plan === "object" ? plan : {};
  const criteria = Array.isArray(input.successCriteria) ? input.successCriteria : [];
  return {
    ...input,
    mode: "strict_edit",
    requiresIdentityLock: true,
    preservationLevel: "high",
    editStrength: Math.max(0.48, Number(input.editStrength) || 0.22),
    localized: false,
    successCriteria: [
      ...criteria,
      "Adicionar somente a(s) pessoa(s) solicitada(s), preservando a identidade e os traços da pessoa original; ajustar composição apenas se necessário.",
    ].slice(-12),
  };
}
