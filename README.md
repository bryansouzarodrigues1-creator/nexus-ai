# NEXUS AI v0.7

Assistente multimodal web com React/Vite no frontend e um único Cloudflare Worker como backend e servidor dos assets.

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

A inferência pesada acontece nos provedores de nuvem. O dispositivo do usuário apenas executa o navegador, envia os pedidos e exibe os resultados.

## Recursos atuais

- Chat com histórico real de conversa e orçamento de contexto
- Modelo principal forte com fallback automático
- Análise de imagens por modelo de visão, com fallback de caption
- Análise de arquivos de texto/código
- Geração de imagens
- Continuidade visual: a última imagem pode ser enviada como referência para edição
- Persistência local de imagens e vídeos em IndexedDB
- Imagem → vídeo quando o provedor/modelo suportar
- Texto → vídeo como fallback
- Pesquisa web preparada via SearXNG
- Histórico de conversas no navegador
- Status e modelos ativos em `/api/status`
- Segredos somente no servidor

## Modelos padrão

- Chat: `openai/gpt-oss-120b:cheapest`
- Fallback do chat: `openai/gpt-oss-20b:fastest`
- Visão: `Qwen/Qwen2.5-VL-3B-Instruct`
- Caption fallback: `Salesforce/blip-image-captioning-large`
- Imagem: `black-forest-labs/FLUX.1-schnell`
- Edição de imagem: `black-forest-labs/FLUX.1-Kontext-dev`
- Vídeo: `Wan-AI/Wan2.1-T2V-1.3B`
- Imagem → vídeo: `Lightricks/LTX-Video`

A disponibilidade e os limites dos modelos dependem dos Inference Providers associados à conta/token. Alguns modelos de edição podem exigir aceitar os termos no Hugging Face. Se a edição não estiver disponível, a NEXUS tenta preservar o contexto por regeneração.

## Cloudflare

O projeto usa `wrangler.jsonc` com:

- Worker: `worker/index.js`
- Static assets: `dist`
- compatibilidade Node habilitada

Build:

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
- `HF_VISION_MODEL`
- `HF_IMAGE_CAPTION_MODEL`
- `HF_IMAGE_MODEL`
- `HF_IMAGE_EDIT_MODEL`
- `HF_VIDEO_MODEL`
- `HF_IMAGE_VIDEO_MODEL`
- `SEARXNG_URL`

## Pesquisa web

O modo Pesquisa só fica operacional quando `SEARXNG_URL` apontar para uma instância com saída JSON habilitada.

## Desenvolvimento local

```bash
npm install
npm run check
npm run dev
```

## Segurança de credenciais

Nunca coloque `HF_TOKEN` no frontend, em commits ou em variáveis públicas. Use Secret no Cloudflare.
