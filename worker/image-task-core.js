export function extractExactRequestedText(prompt, limit = 8) {
  return [
    ...String(prompt || "").matchAll(/[“"']([^“”"'\n]{1,180})[”"']/g),
  ]
    .map((match) => String(match?.[1] || "").trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .slice(0, Math.max(1, Math.min(20, Number(limit || 8))));
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
