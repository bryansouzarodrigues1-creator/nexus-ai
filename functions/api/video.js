import { InferenceClient } from "@huggingface/inference";

export async function onRequestPost({ request, env }) {
  try {
    if (!env.HF_TOKEN) return Response.json({ error: "HF_TOKEN não configurado." }, { status: 503 });
    const { prompt } = await request.json();
    if (!String(prompt || "").trim()) return Response.json({ error: "Prompt vazio." }, { status: 400 });

    const client = new InferenceClient(env.HF_TOKEN);
    const blob = await client.textToVideo({
      model: env.HF_VIDEO_MODEL || "Wan-AI/Wan2.1-T2V-1.3B",
      inputs: String(prompt).trim()
    });
    return new Response(blob, {
      headers: {
        "Content-Type": blob.type || "video/mp4",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json({ error: error?.message || "Falha ao gerar vídeo." }, { status: 502 });
  }
}
