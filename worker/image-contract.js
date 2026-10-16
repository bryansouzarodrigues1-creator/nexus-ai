import { extractExactRequestedText, inferNaturalAspectRatio } from "./image-task-core.js";

// Deterministic constraints always take precedence over uncertain LLM plans.
const OBJECTS = "(?:pessoas?|homens?|mulheres?|crianças?|cavalos?|cachorros?|gatos?|carros?|caminh(?:ão|ões)|motos?|pizzas?|hamb[uú]rgueres?|produtos?|objetos?|p[áa]ssaros?|flores?|pr[ée]dios?|casas?|rob[oô]s?|characters?|people|horses?|dogs?|cats?|cars?|trucks?)";
const QUANTITIES = { um:1, uma:1, one:1, dois:2, duas:2, two:2, tres:3, três:3, three:3, quatro:4, four:4, cinco:5, five:5, seis:6, six:6, sete:7, seven:7, oito:8, eight:8 };

function unique(strings, max = 12) {
  return [...new Set(strings.map(s => String(s || "").trim()).filter(Boolean))].slice(0, max);
}

export function extractImageContract(prompt) {
  const source = String(prompt || "").slice(0, 9000);
  const exactText = extractExactRequestedText(source, 12);
  const numbers = [];

  // Capture phones only when they are explicitly requested in a visual.
  for (const m of source.matchAll(/\b(?:whats\s*app|whatsapp|telefone|celular|contato|phone)\s*(?:é|e|:|n[uú]mero|de|do|no|para|-|=)?\s*[:=-]?\s*(\+?\d[\d\s().-]{8,17}\d)/giu)) {
    const number = m[1].trim().replace(/[.,;!?]+$/, "");
    const digits = number.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) numbers.push(number);
  }

  const sourceLower = source.toLocaleLowerCase("pt-BR");
  const counts = [];
  const regex = new RegExp("\\b(\\d{1,2}|um|uma|one|dois|duas|two|tr[eê]s|three|quatro|four|cinco|five|seis|six|sete|seven|oito|eight)\\s+("+OBJECTS+")\\b", "giu");
  for (const match of sourceLower.matchAll(regex)) {
    const quantity = Number.isFinite(Number(match[1])) ? Number(match[1]) : QUANTITIES[match[1]];
    if (quantity >= 1 && quantity <= 20) counts.push({ count: quantity, subject: match[2] });
  }

  const forbidden = [];
  for (const m of source.matchAll(/(?:\bn[aã]o\s+(?:inclua|adicione|coloque|mostre)|\bsem\s+|\bno\s+(?:extra|additional))([^.!?\n;]{2,90})/giu)) {
    const value = m[1].replace(/^[\s:,-]+/,"").trim();
    if (value) forbidden.push(value);
  }

  return {
    requestedText: unique([...exactText, ...numbers], 12),
    counts: counts.slice(0, 8),
    forbidden: unique(forbidden, 6),
    aspectRatio: inferNaturalAspectRatio(source, null),
  };
}

export function enforceImageContract(taskPlan, prompt) {
  const contract = extractImageContract(prompt);
  const plan = taskPlan && typeof taskPlan === "object" ? taskPlan : {};
  const requestedText = unique([...contract.requestedText, ...(plan.requestedText || [])], 12);
  const hasTexts = requestedText.length > 0;
  return {
    ...plan,
    requestedText,
    requiresTextAccuracy: Boolean(plan.requiresTextAccuracy || hasTexts),
    aspectRatio: contract.aspectRatio || plan.aspectRatio || "1:1",
    contract,
  };
}

export function imageContractInstructions(plan, userPrompt) {
  const contract = plan?.contract || extractImageContract(userPrompt);
  return [
    "NON-NEGOTIABLE REQUIREMENTS FROM THE CURRENT USER REQUEST (override creative expansion and prior experience):",
    contract.counts.length
      ? "EXACT OBJECT QUANTITIES: " + contract.counts.map(item => item.count + " × " + item.subject).join("; ") + ". Do not add, remove, duplicate or merge these subjects."
      : "",
    plan?.requestedText?.length
      ? "VISIBLE TEXT, CHARACTER FOR CHARACTER: " + plan.requestedText.map(text => JSON.stringify(text)).join(" | ") + ". Preserve every digit, letter, accent, space and punctuation. Do not invent labels, numbers or extra copy."
      : "",
    contract.forbidden.length
      ? "EXCLUSIONS: " + contract.forbidden.join("; ") + "."
      : "",
    contract.aspectRatio
      ? "REQUIRED IMAGE ASPECT RATIO: " + contract.aspectRatio + "."
      : "",
    "Original request has priority over paraphrases, task plans, past examples, aesthetics and generic design conventions.",
  ].filter(Boolean).join("\n");
}

export function evaluateObjectCountCompliance(required = [], observed = []) {
  const expected = Array.isArray(required) ? required.slice(0, 8) : [];
  if (!expected.length) return { applicable: false, verified: false, pass: true, mismatches: [] };
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const entries = Array.isArray(observed) ? observed.slice(0, 15) : [];
  const mismatches = [];
  let matched = 0;
  for (const item of expected) {
    // The verifier must cite the requested object by name; missing observations
    // are unknown, not evidence that the quantity was correct.
    const itemKey = normalize(item.subject);
    const found = entries.find(entry => normalize(entry?.subject) === itemKey);
    const actual = Number(found?.count);
    if (!found || !Number.isInteger(actual) || actual < 0) continue;
    matched++;
    if (actual !== item.count) mismatches.push({
      subject: item.subject,
      expected: item.count,
      observed: actual,
    });
  }
  return {
    applicable: true,
    verified: matched === expected.length,
    pass: matched === expected.length && mismatches.length === 0,
    mismatches,
  };
}
