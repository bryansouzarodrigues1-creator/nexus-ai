import { DurableObject } from "cloudflare:workers";

export class NexusConversationState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async readState() {
    return (
      (await this.ctx.storage.get("state")) || {
        memorySummary: "",
        summaryUpTo: 0,
        activeWorkflowId: null,
        lastRoute: null,
        lastModel: null,
        updatedAt: null,
      }
    );
  }

  async writeState(patch = {}) {
    const current = await this.readState();
    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put("state", next);
    return next;
  }

  async appendEvent(event) {
    const events = (await this.ctx.storage.get("events")) || [];
    const next = [
      ...events.slice(-79),
      {
        ...event,
        at: new Date().toISOString(),
      },
    ];
    await this.ctx.storage.put("events", next);
    return next;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/state") {
      return Response.json(await this.readState());
    }

    if (request.method === "POST" && url.pathname === "/state") {
      const patch = await request.json();
      return Response.json(await this.writeState(patch));
    }

    if (request.method === "POST" && url.pathname === "/event") {
      const event = await request.json();
      await this.appendEvent(event);
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/events") {
      return Response.json((await this.ctx.storage.get("events")) || []);
    }

    return new Response("Not found", { status: 404 });
  }
}
