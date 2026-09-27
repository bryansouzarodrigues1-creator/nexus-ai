# NEXUS AI v0.8

NEXUS AI é um assistente multimodal web com frontend React/Vite e um único Cloudflare Worker como backend/orquestrador.

## Arquitetura

```text
React / Vite
    ↓
Cloudflare Worker
    ├── /api/chat
    ├── /api/status
    ├── /api/image
    ├── /api/video
    └── assets do dist/
          ↓
Hugging Face Inference Providers
```

A inferência pesada acontece nos provedores de nuvem. O dispositivo do usuário apenas executa o navegador, envia dados e exibe os resultados.

## Recursos atuais

- Chat com histórico contextual e fallback automático
- Modelo principal `openai/gpt-oss-120b:cheapest`
- Fallback do chat para `openai/gpt-oss-20b:fastest`
- Expansão inteligente de prompts para imagem e vídeo
- O 120B atua como diretor criativo antes do modelo visual
- Expansão preserva intenção, estilo, objetos, cores e restrições do usuário
- Análise de imagens por modelo de visão com fallback de caption
- Análise de arquivos de texto e código
- Geração de imagens
- Edição/continuidade visual usando a imagem anterior como referência
- Persistência local de mídia em IndexedDB
- Imagem → vídeo quando suportado pelo provedor/modelo
- Texto → vídeo como fallback
- Pesquisa web preparada via SearXNG
- Tratamento robusto de erros HTML, respostas inválidas, timeout, cota e rate limit
- Status e modelos ativos em `/api/status`
- Segredos somente no servidor

## Modelos padrão

- Chat: `openai/gpt-oss-120b:cheapest`
- Prompt expander: usa `HF_PROMPT_MODEL`, depois `HF_CHAT_MODEL`, depois o 120B
- Chat fallback: `openai/gpt-oss-20b:fastest`
- Visão: `Qwen/Qwen2.5-VL-3B-Instruct`
- Caption fallback: `Salesforce/blip-image-captioning-large`
- Imagem: `black-forest-labs/FLUX.1-schnell`
- Edição de imagem: `black-forest-labs/FLUX.1-Kontext-dev`
- Vídeo: `Wan-AI/Wan2.1-T2V-1.3B`
- Imagem → vídeo: `Lightricks/LTX-Video`

A disponibilidade e os limites dependem dos Inference Providers associados à conta/token.

## Prompt expansion

Antes de gerar imagem ou vídeo, o Worker chama um modelo de texto para transformar pedidos simples em prompts visuais de maior fidelidade.

Exemplo conceitual:

```text
"um cavalo correndo na chuva"
        ↓
NEXUS Prompt Director
        ↓
descrição visual detalhada e coerente
        ↓
FLUX / Wan / LTX
```

Se a expansão falhar por indisponibilidade ou cota, o prompt original é usado automaticamente. A geração não depende da expansão para continuar funcionando.

Quando existe uma imagem de referência, o expansor recebe instruções para preservar identidade visual e modificar somente o que o usuário pediu.

## Cloudflare

O projeto usa `wrangler.jsonc`:

- Worker: `worker/index.js`
- Static assets: `dist`
- Node compatibility habilitada

Build/deploy:

```bash
npm install
npm run check
npm run build
npx wrangler deploy
```

## Variáveis e segredos

### Obrigatório

- `HF_TOKEN` — Secret do Cloudflare Worker

### Opcionais

- `HF_CHAT_MODEL`
- `HF_PROMPT_MODEL`
- `HF_VISION_MODEL`
- `HF_IMAGE_CAPTION_MODEL`
- `HF_IMAGE_MODEL`
- `HF_IMAGE_EDIT_MODEL`
- `HF_VIDEO_MODEL`
- `HF_IMAGE_VIDEO_MODEL`
- `SEARXNG_URL`

## Pesquisa web

O modo Pesquisa fica operacional quando `SEARXNG_URL` apontar para uma instância com saída JSON habilitada.

## Desenvolvimento local

```bash
npm install
npm run check
npm run dev
```

## Credenciais

Nunca coloque `HF_TOKEN` no frontend, em commits ou em variáveis públicas. Use Secret no Cloudflare.
