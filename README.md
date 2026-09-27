# NEXUS AI v0.2

Assistente multimodal web com frontend React/Vite e backend serverless em Cloudflare Pages Functions.

## Recursos
- Chat com modelo open-weight via Hugging Face Inference Providers
- Pesquisa web via SearXNG configurável
- Geração de imagem via Hugging Face Inference Providers
- Geração de vídeo via Hugging Face Inference Providers
- Histórico local no navegador
- Status dos provedores em `/api/status`
- Segredos apenas no servidor

## Deploy no Cloudflare Pages
Conecte este repositório ao Cloudflare Pages.

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`

Depois, em **Settings → Variables and Secrets**, configure:

### Obrigatório
- `HF_TOKEN` como **Secret**

### Opcionais
- `HF_CHAT_MODEL` — padrão: `openai/gpt-oss-20b:fastest`
- `HF_IMAGE_MODEL` — padrão: `black-forest-labs/FLUX.1-schnell`
- `HF_VIDEO_MODEL` — padrão: `Wan-AI/Wan2.1-T2V-1.3B`
- `SEARXNG_URL` — URL de uma instância SearXNG com saída JSON habilitada

## Segurança
Nunca coloque `HF_TOKEN` no frontend, commit, README ou variável pública. Use Secret no Cloudflare.

## Desenvolvimento local
```bash
npm install
npm run dev
```

As funções em `functions/api/*` são executadas pelo Cloudflare Pages quando o projeto estiver implantado.
