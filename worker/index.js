export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const { message, mode = 'chat' } = await request.json();
      if (!message) return json({ error: 'Mensagem vazia.' }, 400);

      if (!env.HF_TOKEN) {
        return json({
          answer: mode === 'search'
            ? 'A interface e o roteador estão funcionando. Para pesquisa real, conecte o adapter de busca gratuito. O token/modelo de IA ainda não foi configurado no servidor.'
            : 'NEXUS AI V0.1 está online, mas o motor de linguagem ainda não foi configurado. Defina HF_TOKEN no servidor para ativar um modelo open-weight sem expor a chave no navegador.'
        });
      }
      const model = env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
      const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method:'POST',
        headers:{'Authorization':`Bearer ${env.HF_TOKEN}`,'Content-Type':'application/json'},
        body: JSON.stringify({inputs:`Você é NEXUS AI. Responda em português quando apropriado.\nUsuário: ${message}\nAssistente:`,parameters:{max_new_tokens:700,return_full_text:false}})
      });
      if(!r.ok) return json({error:`Provedor respondeu ${r.status}. Troque o modelo ou verifique sua cota/token.`},502);
      const out = await r.json();
      const answer = Array.isArray(out) ? out[0]?.generated_text : out?.generated_text || out?.[0]?.generated_text;
      return json({answer: answer || 'O provedor respondeu sem texto.'});
    }
    return new Response('NEXUS AI worker online', {status:200});
  }
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}})}
