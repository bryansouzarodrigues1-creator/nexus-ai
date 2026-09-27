export async function onRequestGet({ env }) {
  return Response.json({
    ok: true,
    version: "0.2.0",
    providers: {
      chat: Boolean(env.HF_TOKEN),
      search: Boolean(env.SEARXNG_URL),
      image: Boolean(env.HF_TOKEN),
      video: Boolean(env.HF_TOKEN)
    },
    models: {
      chat: env.HF_CHAT_MODEL || "openai/gpt-oss-20b:fastest",
      image: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      video: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B"
    }
  });
}
