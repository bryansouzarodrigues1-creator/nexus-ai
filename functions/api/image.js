import { InferenceClient } from "@huggingface/inference";

export async function onRequestPost({ request, env }) {
  try {
    if (!env.HF_TOKEN) return Response.json({ error: "HF_TOKEN não configurado." }, { status: 503 });
    const { prompt } = await request.json();
    if (!String(prompt || "").trim()) return Response.json({ error: "Prompt vazio." }, { status: 400 });

    const client = new InferenceClient(env.HF_TOKEN);
    const blob = await client.textToImage({
      model: env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
      inputs: String(prompt).trim()
    });
    return new Response(blob, {
      headers: {
        "Content-Type": blob.type || "image/png",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json({ error: error?.message || "Falha ao gerar imagem." }, { status: 502 });
  }
}
