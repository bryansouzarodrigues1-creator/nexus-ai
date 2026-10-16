/**
 * Prevent image-edit requests from degrading into "preserve the original".
 *
 * FLUX.2 Klein accepts a guidance scale, NOT an img2img denoising strength.
 * These heuristics influence prompt priority and guidance only. They do not
 * claim pixel-perfect editing or bypass upstream provider restrictions.
 */
function normalized(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function requiresVisibleImageChange(prompt, hasSourceImage = true) {
  if (!hasSourceImage || !String(prompt || "").trim()) return false;
  const text = normalized(prompt);
  return !/(?:nao (?:mude|altere|edite|modifique) nada|deixe (?:exatamente )?(?:como esta|igual)|copie (?:exatamente )?(?:esta |a )?imagem|sem (?:nenhuma|qualquer) alteracao)/.test(text);
}

export function isBroadImageEdit(prompt) {
  const text = normalized(prompt);
  return /(?:ao meu lado|do meu lado|ao lado d|junto (?:com|de) mim|inclua|adicione|coloque|ponha|insira|acrescente|troque o fundo|mude o fundo|substitua o fundo|mude o cenario|transforme|me vista|me coloque|me coloca|altere a pose|mude a pose|crie uma montagem|fotomontagem)/.test(text);
}

export function prioritizeRequestedImageEdit(plan, prompt, hasSourceImage = true) {
  if (!requiresVisibleImageChange(prompt, hasSourceImage)) return plan;
  const base = plan && typeof plan === "object" ? plan : {};
  if (base.mode === "enhance") return base;
  const broad = isBroadImageEdit(prompt);
  const minimumStrength = broad ? 0.56 : 0.38;
  const strength = Number(base.editStrength);
  const existingCriteria = Array.isArray(base.successCriteria) ? base.successCriteria : [];
  const criteria = [
    ...existingCriteria,
    "O resultado precisa mostrar a alteracao expressamente solicitada pelo usuario; uma imagem visualmente inalterada nao e sucesso.",
  ];
  return {
    ...base,
    editStrength: Math.max(
      minimumStrength,
      Number.isFinite(strength) ? Math.min(0.85, Math.max(0.05, strength)) : minimumStrength
    ),
    preservationLevel:
      broad && base.preservationLevel === "maximum" ? "high" : base.preservationLevel,
    localized: broad ? false : base.localized,
    successCriteria: criteria.slice(-12),
  };
}

export function buildEditFulfillmentInstruction(prompt, hasSourceImage = true) {
  if (!requiresVisibleImageChange(prompt, hasSourceImage)) return "";
  return [
    "MANDATORY IMAGE EDIT: The uploaded image is the starting reference, NOT the final output.",
    "Actually perform the requested visual transformation before returning an image.",
    "Protect only details OUTSIDE the explicitly requested edit. The requested target MUST change.",
    isBroadImageEdit(prompt)
      ? "If the edit adds a person or changes the scene, adjust the canvas, composition and background as needed; don't freeze the source frame."
      : "Apply the requested local change clearly while keeping unrelated areas recognizable.",
    "Do not return an unchanged reconstruction of image 0.",
  ].join(" ");
}

export function cloudflareEditGuidance({ hasSourceImage = false, editStrength = 0.35 } = {}) {
  if (!hasSourceImage) return 3.5;
  const strength = Number.isFinite(Number(editStrength))
    ? Math.max(0, Math.min(0.85, Number(editStrength))) : 0.35;
  return Number((3.5 + strength * 3.2).toFixed(2));
}

export async function imageBytesMatchSource(sourceBlob, outputBytes) {
  if (!sourceBlob || !outputBytes || typeof sourceBlob.arrayBuffer !== "function") return false;
  const output = outputBytes instanceof Uint8Array
    ? outputBytes
    : outputBytes instanceof ArrayBuffer
      ? new Uint8Array(outputBytes)
      : null;
  if (!output || sourceBlob.size !== output.byteLength) return false;
  const input = new Uint8Array(await sourceBlob.arrayBuffer());
  for (let i = 0; i < output.byteLength; i++) {
    if (input[i] !== output[i]) return false;
  }
  return true;
}

export function exactCopyEditFailure() {
  return {
    verified: true,
    pass: false,
    score: 0.08,
    identity: 1,
    composition: 1,
    backgroundPreservation: 1,
    stylePreservation: 1,
    requestFulfillment: 0,
    artifactFree: 1,
    textAccuracy: 1,
    issues: ["O gerador devolveu os mesmos bytes da imagem original; a edicao nao aconteceu."],
    unwantedChanges: [],
    retryInstruction: "Perform the requested change instead of copying the original input image.",
  };
}
