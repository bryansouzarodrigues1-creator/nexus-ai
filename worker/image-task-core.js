export function extractExactRequestedText(prompt, limit = 8) {
  const source = String(prompt || "");
  const max = Math.max(
    1,
    Math.min(20, Number(limit || 8))
  );
  const values = [];

  const clean = (value) =>
    String(value || "")
      .trim()
      .replace(/^[“"'‘’]+|[”"'‘’]+$/g, "")
      .trim()
      .slice(0, 180);

  const push = (value) => {
    const cleaned = clean(value);
    if (!cleaned) return;
    if (!values.includes(cleaned)) {
      values.push(cleaned);
    }
  };

  for (const match of source.matchAll(
    /[“"']([^“”"'\n]{1,180})[”"']/g
  )) {
    push(match?.[1]);
  }

  const labeledPatterns = [
    /\b(?:texto|t[ií]tulo|frase|headline|copy)\s*[:=-]\s*([^\n,;]{1,180})/giu,
    /\b(?:escreva|coloque|adicione|inclua|use)\s+(?:o\s+)?(?:texto|t[ií]tulo|frase)\s*[:=-]?\s*([^\n,;]{1,180})/giu,
  ];

  for (const pattern of labeledPatterns) {
    for (const match of source.matchAll(pattern)) {
      push(match?.[1]);
    }
  }

  // Conservador: só captura comando direto sem "texto/título" quando a
  // expressão está claramente em caixa alta/números. Isso evita transformar
  // o restante de um prompt normal em copy obrigatória.
  for (const match of source.matchAll(
    /\b(?:escreva|coloque)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9\s$€£%.,:+\-]{2,100})(?=$|[;!?])/g
  )) {
    const candidate = clean(match?.[1]);
    const letters = candidate.replace(
      /[^A-Za-zÀ-ÿ]/g,
      ""
    );
    if (
      !letters ||
      letters === letters.toUpperCase()
    ) {
      push(candidate);
    }
  }

  return values.slice(0, max);
}

export function inferNaturalAspectRatio(prompt, fallback = null) {
  const text = String(prompt || "").toLowerCase();

  const explicit =
    text.match(/\b(1:1|16:9|9:16|4:5|5:4|3:2|2:3)\b/)?.[1];
  if (explicit) return explicit;

  if (/\b(story|stories|reels?|tiktok|vertical|9x16)\b/i.test(text)) {
    return "9:16";
  }

  if (
    /\b(youtube|thumbnail|miniatura|banner|widescreen|paisagem|horizontal)\b/i.test(
      text
    )
  ) {
    return "16:9";
  }

  if (/\b(feed|instagram|post vertical|4x5)\b/i.test(text)) {
    return "4:5";
  }

  if (/\b(avatar|perfil|quadrad[oa]|square)\b/i.test(text)) {
    return "1:1";
  }

  return fallback;
}
