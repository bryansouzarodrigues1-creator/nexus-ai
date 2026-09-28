import { DurableObject } from "cloudflare:workers";

const MAX_EVENTS = 120;
const MAX_TASKS = 40;
const MAX_METRICS = 200;
const MAX_FEEDBACK = 240;
const MAX_LESSONS = 160;
const MAX_MODEL_STATS = 140;

function cleanText(value, max = 12000) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanLearningKind(value) {
  const kind = cleanText(value || "general", 40).toLowerCase();
  return /^(chat|agent|code|search|image|video|vision|file|general)$/.test(kind)
    ? kind
    : "general";
}

function cleanSignal(value) {
  const signal = cleanText(value || "neutral", 20).toLowerCase();
  return /^(positive|negative|neutral)$/.test(signal) ? signal : "neutral";
}

function cleanSerializableObject(value, fallback = null) {
  if (!value || typeof value !== "object") return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function modelStatKey(kind, provider, model) {
  return [
    cleanLearningKind(kind),
    cleanText(provider || "unknown", 80),
    cleanText(model || "unknown", 180),
  ].join("::");
}

function updateModelStats(stats, item = {}) {
  const next = stats && typeof stats === "object" ? { ...stats } : {};
  const kind = cleanLearningKind(item.kind);
  const provider = cleanText(item.provider || "unknown", 80);
  const model = cleanText(item.model || "unknown", 180);
  const key = modelStatKey(kind, provider, model);
  const current = next[key] && typeof next[key] === "object" ? next[key] : {};

  const score = Number(item.score);
  const hasScore = Number.isFinite(score);
  const scoreCount = Number(current.scoreCount || 0);
  const oldAvg = Number(current.avgScore || 0);
  const newScoreCount = scoreCount + (hasScore ? 1 : 0);
  const avgScore = hasScore
    ? ((oldAvg * scoreCount) + Math.max(0, Math.min(1, score))) / newScoreCount
    : oldAvg;

  const signal = cleanSignal(item.signal);
  const count = Number(current.count || 0) + 1;

  next[key] = {
    key,
    kind,
    provider,
    model,
    count,
    success: Number(current.success || 0) + (item.ok === false ? 0 : 1),
    failure: Number(current.failure || 0) + (item.ok === false ? 1 : 0),
    positive: Number(current.positive || 0) + (signal === "positive" ? 1 : 0),
    negative: Number(current.negative || 0) + (signal === "negative" ? 1 : 0),
    retries: Number(current.retries || 0) + Math.max(0, Number(item.retries || 0)),
    avgScore,
    scoreCount: newScoreCount,
    lastLatencyMs: Math.max(0, Number(item.latencyMs || 0)),
    updatedAt: Date.now(),
  };

  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0, MAX_MODEL_STATS)
  );
}

function cleanEvent(event = {}) {
  return {
    id: cleanText(event.id || crypto.randomUUID(), 120),
    at: Number(event.at || Date.now()),
    type: cleanText(event.type || "event", 80),
    role: cleanText(event.role || "", 32),
    content: cleanText(event.content || "", 16000),
    meta:
      event.meta && typeof event.meta === "object"
        ? JSON.parse(JSON.stringify(event.meta)).valueOf()
        : null,
  };
}

export class ConversationState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async getSnapshot() {
    const [summary, events, tasks, metrics, profile, feedback, lessons, modelStats, providerHealth] = await Promise.all([
      this.ctx.storage.get("summary"),
      this.ctx.storage.get("events"),
      this.ctx.storage.get("tasks"),
      this.ctx.storage.get("metrics"),
      this.ctx.storage.get("profile"),
      this.ctx.storage.get("feedback"),
      this.ctx.storage.get("lessons"),
      this.ctx.storage.get("modelStats"),
      this.ctx.storage.get("providerHealth"),
    ]);

    return {
      summary: typeof summary === "string" ? summary : "",
      events: Array.isArray(events) ? events : [],
      tasks: tasks && typeof tasks === "object" ? tasks : {},
      metrics: Array.isArray(metrics) ? metrics : [],
      profile: profile && typeof profile === "object" ? profile : {},
      feedback: Array.isArray(feedback) ? feedback : [],
      lessons: Array.isArray(lessons) ? lessons : [],
      modelStats: modelStats && typeof modelStats === "object" ? modelStats : {},
      providerHealth:
        providerHealth && typeof providerHealth === "object"
          ? providerHealth
          : {},
    };
  }

  async appendEvent(event) {
    const events = (await this.ctx.storage.get("events")) || [];
    const next = [...events, cleanEvent(event)].slice(-MAX_EVENTS);
    await this.ctx.storage.put("events", next);
    return { ok: true, count: next.length };
  }

  async appendEvents(items = []) {
    const events = (await this.ctx.storage.get("events")) || [];
    const cleaned = Array.isArray(items) ? items.map(cleanEvent) : [];
    const next = [...events, ...cleaned].slice(-MAX_EVENTS);
    await this.ctx.storage.put("events", next);
    return { ok: true, count: next.length };
  }

  async setSummary(summary) {
    const value = cleanText(summary, 20000);
    await this.ctx.storage.put("summary", value);
    return { ok: true, length: value.length };
  }

  async mergeProfile(patch = {}) {
    const current = (await this.ctx.storage.get("profile")) || {};
    const next = {
      ...current,
      ...(patch && typeof patch === "object" ? patch : {}),
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put("profile", next);
    return next;
  }

  async setTask(id, task = {}) {
    const taskId = cleanText(id, 100);
    if (!taskId) throw new Error("Task id obrigatório.");

    const tasks = (await this.ctx.storage.get("tasks")) || {};
    tasks[taskId] = {
      ...(tasks[taskId] || {}),
      ...(task && typeof task === "object" ? task : {}),
      id: taskId,
      updatedAt: Date.now(),
    };

    const entries = Object.entries(tasks)
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0, MAX_TASKS);

    const next = Object.fromEntries(entries);
    await this.ctx.storage.put("tasks", next);
    return next[taskId];
  }

  async getTask(id) {
    const tasks = (await this.ctx.storage.get("tasks")) || {};
    return tasks[cleanText(id, 100)] || null;
  }

  async recordMetric(metric = {}) {
    const metrics = (await this.ctx.storage.get("metrics")) || [];
    const next = [
      ...metrics,
      {
        at: Date.now(),
        type: cleanText(metric.type || "metric", 80),
        route: cleanText(metric.route || "", 80),
        provider: cleanText(metric.provider || "", 80),
        model: cleanText(metric.model || "", 180),
        latencyMs: Number(metric.latencyMs || 0),
        ok: metric.ok !== false,
        meta:
          metric.meta && typeof metric.meta === "object"
            ? metric.meta
            : null,
      },
    ].slice(-MAX_METRICS);

    await this.ctx.storage.put("metrics", next);
    return { ok: true };
  }

  async recordLearningOutcome(outcome = {}) {
    const modelStats = (await this.ctx.storage.get("modelStats")) || {};
    const nextStats = updateModelStats(modelStats, {
      kind: outcome.kind || outcome.type || "general",
      provider: outcome.provider,
      model: outcome.model,
      ok: outcome.ok,
      score: outcome.score,
      retries: outcome.retries,
      latencyMs: outcome.latencyMs,
      signal: "neutral",
    });
    await this.ctx.storage.put("modelStats", nextStats);
    return { ok: true };
  }

  async recordFeedback(feedback = {}) {
    const items = (await this.ctx.storage.get("feedback")) || [];
    const item = {
      id: cleanText(feedback.id || crypto.randomUUID(), 120),
      at: Date.now(),
      sessionId: cleanText(feedback.sessionId || "", 128),
      kind: cleanLearningKind(feedback.kind),
      signal: cleanSignal(feedback.signal),
      prompt: cleanText(feedback.prompt || "", 4000),
      outputPreview: cleanText(feedback.outputPreview || "", 5000),
      note: cleanText(feedback.note || "", 4000),
      provider: cleanText(feedback.provider || "", 80),
      model: cleanText(feedback.model || "", 180),
      route: cleanText(feedback.route || "", 80),
      score: Number.isFinite(Number(feedback.score))
        ? Math.max(0, Math.min(1, Number(feedback.score)))
        : null,
      meta: cleanSerializableObject(feedback.meta, null),
    };

    const nextFeedback = [...items, item].slice(-MAX_FEEDBACK);
    const modelStats = (await this.ctx.storage.get("modelStats")) || {};
    const nextStats = updateModelStats(modelStats, {
      kind: item.kind,
      provider: item.provider,
      model: item.model,
      ok: item.signal !== "negative",
      score: item.score,
      retries: item.meta?.retries || 0,
      signal: item.signal,
    });

    await Promise.all([
      this.ctx.storage.put("feedback", nextFeedback),
      this.ctx.storage.put("modelStats", nextStats),
    ]);

    return item;
  }

  async addLesson(lesson = {}) {
    const guidance = cleanText(lesson.guidance || "", 4000);
    if (!guidance) return { ok: false, reason: "empty-guidance" };

    const lessons = (await this.ctx.storage.get("lessons")) || [];
    const normalized = guidance.toLowerCase().replace(/\s+/g, " ").trim();

    const withoutDuplicate = lessons.filter((item) => {
      const existing = cleanText(item?.guidance || "", 4000)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      return existing !== normalized;
    });

    const item = {
      id: cleanText(lesson.id || crypto.randomUUID(), 120),
      at: Date.now(),
      taskType: cleanLearningKind(lesson.taskType),
      trigger: cleanText(lesson.trigger || "", 2500),
      guidance,
      confidence: Math.max(
        0,
        Math.min(1, Number.isFinite(Number(lesson.confidence))
          ? Number(lesson.confidence)
          : 0.7)
      ),
      source: cleanText(lesson.source || "feedback", 40),
      signal: cleanSignal(lesson.signal),
    };

    const next = [...withoutDuplicate, item].slice(-MAX_LESSONS);
    await this.ctx.storage.put("lessons", next);
    return { ok: true, lesson: item };
  }

  async getLearningContext(taskType = "general") {
    const kind = cleanLearningKind(taskType);
    const [lessons, modelStats] = await Promise.all([
      this.ctx.storage.get("lessons"),
      this.ctx.storage.get("modelStats"),
    ]);

    const relevantLessons = (Array.isArray(lessons) ? lessons : [])
      .filter((item) => item?.taskType === kind || item?.taskType === "general")
      .sort((a, b) => {
        const confidenceDiff =
          Number(b?.confidence || 0) - Number(a?.confidence || 0);
        return confidenceDiff || Number(b?.at || 0) - Number(a?.at || 0);
      })
      .slice(0, 8)
      .map((item) => ({
        taskType: item.taskType,
        trigger: item.trigger,
        guidance: item.guidance,
        confidence: item.confidence,
        signal: item.signal,
      }));

    const relevantStats = Object.values(
      modelStats && typeof modelStats === "object" ? modelStats : {}
    )
      .filter((item) => item?.kind === kind || item?.kind === "general")
      .map((item) => {
        const positive = Number(item?.positive || 0);
        const negative = Number(item?.negative || 0);
        const explicitTotal = positive + negative;
        return {
          kind: item.kind,
          provider: item.provider,
          model: item.model,
          count: Number(item.count || 0),
          successRate:
            Number(item.count || 0) > 0
              ? Number(item.success || 0) / Number(item.count || 1)
              : 0,
          explicitApproval:
            explicitTotal > 0 ? positive / explicitTotal : null,
          avgScore: Number(item.avgScore || 0),
          retries: Number(item.retries || 0),
          updatedAt: Number(item.updatedAt || 0),
        };
      })
      .sort((a, b) => {
        const aApproval = a.explicitApproval == null ? 0.5 : a.explicitApproval;
        const bApproval = b.explicitApproval == null ? 0.5 : b.explicitApproval;
        const aRank = aApproval * 0.5 + a.avgScore * 0.3 + a.successRate * 0.2;
        const bRank = bApproval * 0.5 + b.avgScore * 0.3 + b.successRate * 0.2;
        return bRank - aRank || b.updatedAt - a.updatedAt;
      })
      .slice(0, 8);

    return {
      taskType: kind,
      lessons: relevantLessons,
      modelStats: relevantStats,
    };
  }

  async getProviderHealth() {
    const health = (await this.ctx.storage.get("providerHealth")) || {};
    const now = Date.now();
    const next = {};

    for (const [key, value] of Object.entries(
      health && typeof health === "object" ? health : {}
    )) {
      if (!value || typeof value !== "object") continue;
      const cooldownUntil = Number(value.cooldownUntil || 0);
      next[key] = {
        ...value,
        available: cooldownUntil <= now,
      };
    }

    return next;
  }

  async markProviderFailure(provider, failure = {}) {
    const key = cleanText(provider || "unknown", 80).toLowerCase();
    if (!key) throw new Error("Provider obrigatório.");

    const health = (await this.ctx.storage.get("providerHealth")) || {};
    const now = Date.now();
    const cooldownMs = Math.max(
      0,
      Math.min(
        7 * 24 * 60 * 60 * 1000,
        Number(failure.cooldownMs || 0)
      )
    );

    health[key] = {
      provider: key,
      status: "cooldown",
      kind: cleanText(failure.kind || "unknown", 40),
      reason: cleanText(failure.reason || "", 1400),
      cooldownUntil: now + cooldownMs,
      lastFailureAt: now,
      failures: Number(health[key]?.failures || 0) + 1,
      successes: Number(health[key]?.successes || 0),
      updatedAt: now,
    };

    await this.ctx.storage.put("providerHealth", health);
    return health[key];
  }

  async markProviderSuccess(provider) {
    const key = cleanText(provider || "unknown", 80).toLowerCase();
    if (!key) throw new Error("Provider obrigatório.");

    const health = (await this.ctx.storage.get("providerHealth")) || {};
    const now = Date.now();
    health[key] = {
      provider: key,
      status: "available",
      kind: "",
      reason: "",
      cooldownUntil: 0,
      lastSuccessAt: now,
      failures: Number(health[key]?.failures || 0),
      successes: Number(health[key]?.successes || 0) + 1,
      updatedAt: now,
    };

    await this.ctx.storage.put("providerHealth", health);
    return health[key];
  }

  async clearProviderHealth(provider = "") {
    const key = cleanText(provider, 80).toLowerCase();
    if (!key) {
      await this.ctx.storage.delete("providerHealth");
      return { ok: true, all: true };
    }

    const health = (await this.ctx.storage.get("providerHealth")) || {};
    delete health[key];
    await this.ctx.storage.put("providerHealth", health);
    return { ok: true, provider: key };
  }

  async clearLearning() {
    await Promise.all([
      this.ctx.storage.delete("feedback"),
      this.ctx.storage.delete("lessons"),
      this.ctx.storage.delete("modelStats"),
      this.ctx.storage.delete("providerHealth"),
    ]);
    return { ok: true };
  }

  async clear() {
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }
}
