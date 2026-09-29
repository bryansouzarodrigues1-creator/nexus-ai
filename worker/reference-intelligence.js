function cleanList(value, max = 8, maxChars = 420) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().slice(0, maxChars))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

export function createReferenceSkeleton({
  manualDescriptions = [],
  manualCount = 0,
  autoApprovedCount = 0,
  startIndex = 1,
} = {}) {
  const manual = Math.max(0, Math.min(3, Number(manualCount || 0)));
  const approved = Math.max(
    0,
    Math.min(3 - manual, Number(autoApprovedCount || 0))
  );
  const descriptions = Array.isArray(manualDescriptions)
    ? manualDescriptions
    : [];

  const items = [];

  for (let i = 0; i < manual; i++) {
    items.push({
      imageIndex: Number(startIndex) + i,
      source: "manual",
      description: String(descriptions[i] || "").slice(0, 2400),
      role: "supplementary_reference",
      relevant: true,
      useFor: [],
      avoid: [
        "unrequested identity transfer",
        "unrequested scene transfer",
      ],
      confidence: 0.5,
    });
  }

  for (let i = 0; i < approved; i++) {
    items.push({
      imageIndex: Number(startIndex) + manual + i,
      source: "approved_history",
      description: "",
      role: "continuity_evidence",
      relevant: true,
      useFor: [
        "stable identity",
        "facial traits",
        "body proportions",
        "established style",
      ],
      avoid: [
        "stale pose",
        "stale clothing",
        "stale background",
        "stale edit state",
      ],
      confidence: 0.9,
    });
  }

  return items;
}

export function sanitizeReferencePlan(parsed, skeleton) {
  const base = Array.isArray(skeleton) ? skeleton : [];
  const proposed = Array.isArray(parsed?.references)
    ? parsed.references
    : [];

  const byIndex = new Map(
    proposed.map((item) => [
      Number(item?.imageIndex),
      item,
    ])
  );

  return {
    references: base.map((fallback) => {
      // Prior outputs explicitly approved by the user are continuity anchors.
      // Never let an LLM reinterpret them as a source of stale mutable state.
      if (fallback.source === "approved_history") {
        return fallback;
      }

      const candidate = byIndex.get(Number(fallback.imageIndex));
      if (!candidate) return fallback;

      return {
        ...fallback,
        relevant:
          typeof candidate.relevant === "boolean"
            ? candidate.relevant
            : fallback.relevant,
        role: String(candidate.role || fallback.role).slice(0, 120),
        useFor: cleanList(
          candidate.useFor?.length
            ? candidate.useFor
            : fallback.useFor,
          8
        ),
        avoid: cleanList(
          candidate.avoid?.length
            ? candidate.avoid
            : fallback.avoid,
          8
        ),
        confidence: Math.max(
          0,
          Math.min(
            1,
            Number.isFinite(Number(candidate.confidence))
              ? Number(candidate.confidence)
              : fallback.confidence
          )
        ),
      };
    }),
    globalRules: cleanList(parsed?.globalRules, 8, 520),
  };
}

export function formatReferencePlan(plan) {
  const refs = Array.isArray(plan?.references)
    ? plan.references
    : [];
  if (!refs.length) return "";

  const lines = refs.map((item) => {
    const parts = [
      "Image " + Number(item.imageIndex),
      "source=" + String(item.source || "unknown"),
      item.role ? "role=" + item.role : "",
      item.description
        ? "visual=" + String(item.description).replace(/\s+/g, " ").slice(0, 900)
        : "",
      item.useFor?.length
        ? "use_for=" + item.useFor.join("; ")
        : "",
      item.avoid?.length
        ? "avoid=" + item.avoid.join("; ")
        : "",
      Number.isFinite(Number(item.confidence))
        ? "confidence=" + Math.round(Number(item.confidence) * 100) + "%"
        : "",
    ].filter(Boolean);

    return parts.join(" | ");
  });

  const rules = Array.isArray(plan?.globalRules) && plan.globalRules.length
    ? "\nGLOBAL RULES: " + plan.globalRules.join("; ")
    : "";

  return (
    "REFERENCE INTELLIGENCE:\n" +
    lines.join("\n") +
    rules
  ).slice(0, 6200);
}
