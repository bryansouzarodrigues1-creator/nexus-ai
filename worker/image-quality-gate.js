function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function comparable(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function levenshtein(a, b) {
  const aa = comparable(a);
  const bb = comparable(b);

  if (aa === bb) return 0;
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;

  let previous = Array.from({ length: bb.length + 1 }, (_, i) => i);
  let current = new Array(bb.length + 1);

  for (let i = 1; i <= aa.length; i++) {
    current[0] = i;
    for (let j = 1; j <= bb.length; j++) {
      const substitution = previous[j - 1] + (aa[i - 1] === bb[j - 1] ? 0 : 1);
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        substitution
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[bb.length];
}

function similarity(a, b) {
  const aa = comparable(a);
  const bb = comparable(b);
  const maxLength = Math.max(aa.length, bb.length);
  if (!maxLength) return 1;
  return clamp01(1 - levenshtein(aa, bb) / maxLength);
}

function bestObservedSimilarity(expected, observed) {
  const target = comparable(expected);
  if (!target) return 1;

  const items = (Array.isArray(observed) ? observed : [])
    .map(comparable)
    .filter(Boolean)
    .slice(0, 24);

  const joined = comparable(items.join(" | "));
  const candidates = [...items, joined].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(target)) return 1;
  }

  let best = 0;
  const targetLength = target.length;

  for (const candidate of candidates) {
    best = Math.max(best, similarity(target, candidate));

    if (candidate.length <= targetLength + 8) continue;

    const minWindow = Math.max(1, targetLength - 3);
    const maxWindow = Math.min(candidate.length, targetLength + 3);

    for (let windowLength = minWindow; windowLength <= maxWindow; windowLength++) {
      const step = Math.max(1, Math.floor(windowLength / 8));
      for (let start = 0; start + windowLength <= candidate.length; start += step) {
        best = Math.max(
          best,
          similarity(target, candidate.slice(start, start + windowLength))
        );
        if (best >= 0.999) return 1;
      }
    }
  }

  return clamp01(best);
}

export function scoreExactTextRequirements(expected, observed) {
  const expectedTexts = (Array.isArray(expected) ? expected : [])
    .map(comparable)
    .filter(Boolean)
    .slice(0, 12);

  const observedTexts = (Array.isArray(observed) ? observed : [])
    .map(comparable)
    .filter(Boolean)
    .slice(0, 24);

  if (!expectedTexts.length) {
    return {
      applicable: false,
      score: 1,
      exactMatches: 0,
      total: 0,
      missing: [],
      perText: [],
    };
  }

  const perText = expectedTexts.map((text) => {
    const score = bestObservedSimilarity(text, observedTexts);
    return {
      text,
      score,
      exact: score >= 0.999,
    };
  });

  const score =
    perText.reduce((sum, item) => sum + item.score, 0) /
    Math.max(1, perText.length);

  return {
    applicable: true,
    score: clamp01(score),
    exactMatches: perText.filter((item) => item.exact).length,
    total: perText.length,
    missing: perText
      .filter((item) => item.score < 0.92)
      .map((item) => item.text),
    perText,
  };
}

export function fuseReferenceCompliance(baseVerification, referenceCompliance) {
  const base = baseVerification && typeof baseVerification === "object"
    ? { ...baseVerification }
    : {};

  if (
    !referenceCompliance ||
    referenceCompliance.applicable !== true ||
    referenceCompliance.verified !== true
  ) {
    return base;
  }

  const baseScore = clamp01(base.score ?? 0.5);
  const referenceScore = clamp01(referenceCompliance.score ?? 0.5);
  const leakageRisk = clamp01(referenceCompliance.leakageRisk ?? 0);

  const fusedScore = Math.min(
    baseScore,
    baseScore * 0.72 + referenceScore * 0.28
  );

  const referencePass =
    referenceScore >= 0.74 &&
    leakageRisk <= 0.28;

  return {
    ...base,
    pass: Boolean(base.pass) && referencePass,
    score: fusedScore,
    referenceVerified: true,
    referenceScore,
    referenceLeakageRisk: leakageRisk,
    referencePass,
    issues: [
      ...(Array.isArray(base.issues) ? base.issues : []),
      ...(Array.isArray(referenceCompliance.issues)
        ? referenceCompliance.issues
        : []),
    ].slice(0, 20),
    unwantedChanges: [
      ...(Array.isArray(base.unwantedChanges) ? base.unwantedChanges : []),
      ...(Array.isArray(referenceCompliance.leakedAttributes)
        ? referenceCompliance.leakedAttributes
        : []),
    ].slice(0, 20),
    retryInstruction: [
      String(base.retryInstruction || "").trim(),
      String(referenceCompliance.retryInstruction || "").trim(),
    ].filter(Boolean).join(" ").slice(0, 3600),
  };
}


function finiteOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function metric(value, fallback = 0) {
  return clamp01(finiteOr(value, fallback));
}

function addBlocker(blockers, code, value, threshold, priority, message) {
  if (metric(value) >= threshold) return;
  blockers.push({
    code,
    value: metric(value),
    threshold: clamp01(threshold),
    priority: Math.max(1, Math.min(10, Number(priority || 5))),
    message: String(message || "").slice(0, 500),
  });
}

export function evaluateImageQualityGate(
  verification,
  taskPlan = {}
) {
  const v =
    verification && typeof verification === "object"
      ? verification
      : {};

  if (v.verified !== true) {
    return {
      verified: false,
      pass: true,
      score: null,
      blockers: [],
      blockerCodes: [],
      retryInstruction: "",
      failureClass: "",
    };
  }

  const mode = String(taskPlan?.mode || "create");
  const preservation = String(
    taskPlan?.preservationLevel || "medium"
  );
  const strict = preservation === "maximum";
  const high = preservation === "high";
  const requiresIdentity = Boolean(
    taskPlan?.requiresIdentityLock
  );
  const requiresText = Boolean(
    taskPlan?.requiresTextAccuracy
  );

  const overall = metric(v.score, 0.5);
  const request = metric(
    v.requestFulfillment,
    overall
  );
  const identity = metric(v.identity, overall);
  const composition = metric(
    v.composition,
    overall
  );
  const background = metric(
    v.backgroundPreservation,
    overall
  );
  const style = metric(
    v.stylePreservation,
    overall
  );
  const artifacts = metric(
    v.artifactFree,
    overall
  );
  const text = metric(
    v.textAccuracy,
    requiresText ? 0 : 1
  );
  const reference = v.referenceVerified
    ? metric(v.referenceScore, 0.5)
    : 1;
  const leakage = v.referenceVerified
    ? metric(v.referenceLeakageRisk, 0)
    : 0;

  const blockers = [];

  addBlocker(
    blockers,
    "overall_quality",
    overall,
    strict ? 0.82 : high ? 0.79 : 0.76,
    5,
    "A qualidade visual global ficou abaixo do mínimo."
  );

  addBlocker(
    blockers,
    "request_fulfillment",
    request,
    mode === "create" || mode === "poster"
      ? 0.78
      : 0.74,
    10,
    "O resultado não cumpriu suficientemente o pedido."
  );

  addBlocker(
    blockers,
    "artifacts",
    artifacts,
    0.7,
    8,
    "Há artefatos, deformações ou inconsistências visuais."
  );

  if (requiresIdentity) {
    addBlocker(
      blockers,
      "identity",
      identity,
      strict ? 0.88 : high ? 0.84 : 0.82,
      10,
      "A identidade visual do sujeito desviou da referência."
    );
  }

  if (strict || high) {
    addBlocker(
      blockers,
      "composition",
      composition,
      strict ? 0.8 : 0.74,
      8,
      "Enquadramento, geometria ou composição mudaram demais."
    );
    addBlocker(
      blockers,
      "background",
      background,
      strict ? 0.78 : 0.72,
      7,
      "O fundo mudou além do permitido."
    );
    addBlocker(
      blockers,
      "style",
      style,
      strict ? 0.78 : 0.72,
      6,
      "Iluminação ou estilo visual desviaram da referência."
    );
  }

  if (requiresText) {
    const exactTotal = Math.max(
      0,
      Number(v.exactTextTotal || 0)
    );
    const exactMatches = Math.max(
      0,
      Number(v.exactTextMatches || 0)
    );

    if (
      exactTotal > 0 &&
      exactMatches < exactTotal
    ) {
      blockers.push({
        code: "exact_text",
        value:
          exactTotal > 0
            ? clamp01(exactMatches / exactTotal)
            : text,
        threshold: 1,
        priority: 10,
        message:
          "O texto obrigatório não foi reproduzido exatamente.",
      });
    } else {
      addBlocker(
        blockers,
        "text_accuracy",
        text,
        0.9,
        9,
        "O texto da imagem não está fiel ao texto solicitado."
      );
    }
  }

  if (v.referenceVerified) {
    addBlocker(
      blockers,
      "reference_compliance",
      reference,
      0.74,
      9,
      "A referência suplementar não foi aplicada corretamente."
    );

    if (leakage > 0.28) {
      blockers.push({
        code: "reference_leakage",
        value: clamp01(1 - leakage),
        threshold: 0.72,
        priority: 9,
        message:
          "Atributos proibidos vazaram de uma referência suplementar.",
      });
    }
  }

  if (
    v.pass === false &&
    blockers.length === 0
  ) {
    blockers.push({
      code: "verifier_reject",
      value: overall,
      threshold: overall,
      priority: 5,
      message:
        "O verificador visual detectou uma falha não classificada.",
    });
  }

  blockers.sort(
    (a, b) =>
      Number(b.priority || 0) -
        Number(a.priority || 0) ||
      Number(a.value || 0) -
        Number(b.value || 0)
  );

  const weighted = strict || high
    ? (
        overall * 0.16 +
        request * 0.24 +
        identity * 0.22 +
        composition * 0.11 +
        background * 0.07 +
        style * 0.06 +
        artifacts * 0.07 +
        text * 0.04 +
        reference * 0.03 -
        leakage * 0.05
      )
    : (
        overall * 0.25 +
        request * 0.31 +
        identity * 0.08 +
        composition * 0.07 +
        background * 0.03 +
        style * 0.05 +
        artifacts * 0.1 +
        text * 0.07 +
        reference * 0.04 -
        leakage * 0.03
      );

  const blockerPenalty = Math.min(
    0.28,
    blockers.reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          Number(item.threshold || 0) -
            Number(item.value || 0)
        ) *
          (Number(item.priority || 5) / 10) *
          0.24,
      0
    )
  );

  const score = clamp01(
    weighted - blockerPenalty
  );

  const retryParts = [];
  const codes = new Set(
    blockers.map((item) => item.code)
  );

  if (
    codes.has("identity")
  ) {
    retryParts.push(
      "Restore the exact same subject identity, facial structure, hair, body proportions and recognizable traits from the authoritative reference."
    );
  }
  if (
    codes.has("request_fulfillment")
  ) {
    retryParts.push(
      "Complete the user's requested change precisely; do not leave the requested target partially unchanged."
    );
  }
  if (
    codes.has("exact_text") ||
    codes.has("text_accuracy")
  ) {
    retryParts.push(
      "Reproduce every required text string exactly character-for-character, preserving accents, numbers, capitalization and punctuation."
    );
  }
  if (
    codes.has("reference_compliance")
  ) {
    retryParts.push(
      "Use supplementary references only for their declared attributes and match those requested attributes more faithfully."
    );
  }
  if (
    codes.has("reference_leakage")
  ) {
    retryParts.push(
      "Remove all unrequested identity, pose, clothing, background, lighting or scene attributes leaked from supplementary references."
    );
  }
  if (
    codes.has("composition")
  ) {
    retryParts.push(
      "Restore the original framing, camera angle, geometry and spatial relationships."
    );
  }
  if (
    codes.has("background")
  ) {
    retryParts.push(
      "Restore all background elements that were not explicitly requested to change."
    );
  }
  if (
    codes.has("style")
  ) {
    retryParts.push(
      "Restore the original lighting, color treatment and visual style outside the requested edit."
    );
  }
  if (
    codes.has("artifacts")
  ) {
    retryParts.push(
      "Remove distortions, warped anatomy, duplicated details, seams and other generation artifacts."
    );
  }

  const modelRetry = String(
    v.retryInstruction || ""
  ).trim();

  return {
    verified: true,
    pass: blockers.length === 0,
    score,
    blockers: blockers.slice(0, 10),
    blockerCodes: blockers
      .slice(0, 10)
      .map((item) => item.code),
    retryInstruction: [
      ...retryParts.slice(0, 5),
      modelRetry,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 4200),
    failureClass:
      blockers[0]?.code || "",
  };
}

export function applyImageQualityGate(
  verification,
  taskPlan = {}
) {
  const base =
    verification && typeof verification === "object"
      ? { ...verification }
      : {};

  const gate = evaluateImageQualityGate(
    base,
    taskPlan
  );

  if (!gate.verified) {
    return {
      ...base,
      qualityGate: gate,
    };
  }

  return {
    ...base,
    pass: gate.pass,
    qualityGate: gate,
    qualityGateScore: gate.score,
    qualityGateBlockers:
      gate.blockerCodes,
    retryInstruction:
      gate.retryInstruction ||
      String(base.retryInstruction || ""),
  };
}


export function planImageRetryStrategy(
  verification,
  taskPlan = {},
  attemptIndex = 1
) {
  const v =
    verification && typeof verification === "object"
      ? verification
      : {};
  const blockers = new Set(
    Array.isArray(v.qualityGateBlockers)
      ? v.qualityGateBlockers
      : Array.isArray(v.qualityGate?.blockerCodes)
        ? v.qualityGate.blockerCodes
        : []
  );

  const baseStrength = Math.max(
    0.05,
    Math.min(
      0.85,
      Number.isFinite(Number(taskPlan?.editStrength))
        ? Number(taskPlan.editStrength)
        : 0.3
    )
  );

  const attempt = Math.max(
    1,
    Math.min(4, Math.round(Number(attemptIndex || 1)))
  );

  const preservationCodes = [
    "identity",
    "composition",
    "background",
    "style",
    "reference_leakage",
  ];
  const fulfillmentCodes = [
    "request_fulfillment",
    "reference_compliance",
  ];

  const preserveProblem = preservationCodes.some((code) =>
    blockers.has(code)
  );
  const fulfillProblem = fulfillmentCodes.some((code) =>
    blockers.has(code)
  );
  const textProblem =
    blockers.has("exact_text") ||
    blockers.has("text_accuracy");
  const artifactProblem =
    blockers.has("artifacts");

  let delta = 0;
  let retryClass = "balanced";

  if (preserveProblem && !fulfillProblem) {
    delta = -0.055 * attempt;
    retryClass = "preserve";
  } else if (fulfillProblem && !preserveProblem) {
    delta = 0.065 * attempt;
    retryClass = "fulfill";
  } else if (preserveProblem && fulfillProblem) {
    delta = -0.02 * attempt;
    retryClass = "balanced";
  } else if (textProblem) {
    delta = 0;
    retryClass = "text";
  }

  if (artifactProblem) {
    delta -= 0.02 * attempt;
    if (
      !preserveProblem &&
      !fulfillProblem &&
      !textProblem
    ) {
      retryClass = "artifact";
    }
  }

  const editStrength = Math.max(
    0.05,
    Math.min(0.85, baseStrength + delta)
  );

  const hints = [];

  if (retryClass === "preserve") {
    hints.push(
      "Reduce transformation pressure outside the requested target and lock the authoritative reference more strongly."
    );
  } else if (retryClass === "fulfill") {
    hints.push(
      "Increase transformation pressure only on the explicitly requested target while keeping protected regions locked."
    );
  } else if (retryClass === "text") {
    hints.push(
      "Keep global composition stable and focus the retry on exact text rendering character-for-character."
    );
  } else if (retryClass === "artifact") {
    hints.push(
      "Use a gentler correction focused on removing artifacts without redesigning valid regions."
    );
  } else {
    hints.push(
      "Balance target fulfillment with strict preservation of protected regions."
    );
  }

  if (blockers.has("reference_leakage")) {
    hints.push(
      "Do not transfer identity, pose, background or scene state from supplementary references."
    );
  }

  if (blockers.has("reference_compliance")) {
    hints.push(
      "Apply only the declared useFor attributes from supplementary references more faithfully."
    );
  }

  return {
    retryClass,
    editStrength,
    delta,
    blockers: [...blockers],
    promptHint: hints.join(" ").slice(0, 1200),
  };
}
