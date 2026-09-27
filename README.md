# NEXUS AI v1.0

NEXUS AI é um assistente multimodal web com React/Vite e um único Cloudflare Worker. A v1 maximiza inteligência por custo usando roteamento automático em vez de enviar toda pergunta para o mesmo modelo.

## Arquitetura

React / Vite → Cloudflare Worker → NEXUS Router → Workers AI, com Hugging Face como fallback.

### Roteador automático
- general / vision: `@cf/google/gemma-4-26b-a4b-it`
- code: `@cf/zai-org/glm-4.7-flash`
- deep reasoning: `@cf/openai/gpt-oss-120b` com esforço alto
- image fast/edit: `@cf/black-forest-labs/flux-2-klein-4b`
- image quality/edit: `@cf/black-forest-labs/flux-2-klein-9b`
- search: pesquisa nativa via `web_search_options`, com SearXNG como fallback opcional

## Memória e cache
- Até 60 mensagens recentes entram no orçamento de contexto.
- Cada conversa envia seu próprio `sessionId`.
- O Worker usa `x-session-affinity` para favorecer prompt caching e menor latência/custo.

## Documentos
Arquivos simples de texto/código são lidos no navegador. PDF, DOCX, XLSX/XLS/XLSM/XLSB, ODS, ODT e Numbers são enviados ao Worker e convertidos via `env.AI.toMarkdown` antes da análise.

## Imagens
- FLUX.2 usa multipart tanto para geração do zero quanto para edição.
- A última imagem é enviada como referência real para continuidade visual.
- A cópia de referência é reduzida para ficar dentro do limite do modelo; a imagem original é preservada.
- Pedidos explícitos de qualidade máxima/fotorrealismo usam o 9B; o restante usa o 4B para preservar a franquia diária.

## Prompt Director
Pedidos de imagem e vídeo podem ser refinados por Gemma antes da geração. Com Workers AI disponível, essa expansão não cai para o Hugging Face, evitando chamadas inúteis quando a cota do HF estiver zerada.

## Vídeo
Vídeo continua isolado do restante do sistema. Hoje usa Hugging Face (`Wan-AI/Wan2.1-T2V-1.3B` e `Lightricks/LTX-Video`). Se a cota do HF acabar, chat, raciocínio, visão, documentos e imagem continuam pelo Cloudflare. A aplicação não ativa modelos pagos de vídeo automaticamente.

## Cloudflare binding
`wrangler.jsonc` usa o binding `AI` e assets do diretório `dist`.

## Secret
- `HF_TOKEN`: opcional para fallbacks de chat/imagem; necessário no fluxo atual de vídeo.

## Variáveis opcionais
- `CF_GENERAL_MODEL`
- `CF_REASONING_MODEL`
- `CF_CODE_MODEL`
- `CF_PROMPT_MODEL`
- `CF_VISION_MODEL`
- `CF_IMAGE_FAST_MODEL`
- `CF_IMAGE_QUALITY_MODEL`
- `HF_CHAT_MODEL`
- `HF_IMAGE_MODEL`
- `HF_IMAGE_EDIT_MODEL`
- `HF_VIDEO_MODEL`
- `HF_IMAGE_VIDEO_MODEL`
- `SEARXNG_URL`

## Validação automática
Cada push em `main` executa `npm install`, `npm run check`, `npm run build` e `npx wrangler@4.141.0 deploy --dry-run --outdir .wrangler-dry`.

## Credenciais
Nunca coloque `HF_TOKEN` no frontend ou no GitHub.
