import { DurableObject } from "cloudflare:workers";

const MAX_EVENTS = 120;
const MAX_TASKS = 40;
const MAX_METRICS = 200;

function cleanText(value, max = 12000) {
  return String(value ?? "").trim().slice(0, max);
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
    const [summary, events, tasks, metrics, profile] = await Promise.all([
      this.ctx.storage.get("summary"),
      this.ctx.storage.get("events"),
      this.ctx.storage.get("tasks"),
      this.ctx.storage.get("metrics"),
      this.ctx.storage.get("profile"),
    ]);

    return {
      summary: typeof summary === "string" ? summary : "",
      events: Array.isArray(events) ? events : [],
      tasks: tasks && typeof tasks === "object" ? tasks : {},
      metrics: Array.isArray(metrics) ? metrics : [],
      profile: profile && typeof profile === "object" ? profile : {},
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

  async clear() {
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }
}
