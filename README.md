# NEXUS AI v0.9

NEXUS AI é um assistente multimodal web com React/Vite e um único Cloudflare Worker.

## Arquitetura atual

```text
React / Vite
    ↓
Cloudflare Worker
    ├── Workers AI — motor principal
    │   ├── chat: Nemotron 3 Super 120B
    │   ├── prompt expansion: Gemma 4 26B A4B
    │   └── imagem/edição: FLUX.2 Klein 4B
    │
    └── Hugging Face Inference Providers — fallback
        ├── GPT-OSS
        ├── FLUX
        └── vídeo
```

O processamento pesado continua integralmente na nuvem.

## Por que dois provedores

A cota gratuita do Hugging Face Inference Providers é pequena. A NEXUS agora usa a franquia diária do Cloudflare Workers AI para chat, expansão de prompt e imagem, mantendo o Hugging Face como fallback.

Isso evita que a aplicação inteira pare quando os créditos mensais do Hugging Face acabarem.

## Recursos

- Chat contextual com histórico
- Cloudflare Nemotron 120B como chat principal
- Cloudflare Gemma 4 como motor rápido e diretor criativo
- Hugging Face GPT-OSS como fallback
- Expansão automática de prompts multimídia
- Geração de imagens pelo FLUX.2 Klein 4B
- Edição real da imagem anterior por referência
- Redimensionamento apenas da cópia de referência enviada ao modelo
- Imagem original preservada no navegador
- Persistência de mídia em IndexedDB
- Análise de imagem e arquivos
- Vídeo via Hugging Face enquanto houver cota/créditos
- Erros de quota, HTML inválido, timeout e rate limit tratados sem derrubar o Worker
- Provedor e modelo usados aparecem na interface

## Workers AI binding

O `wrangler.jsonc` inclui:

```json
"ai": {
  "binding": "AI"
}
```

O Worker acessa o serviço como `env.AI`.

## Modelos padrão

### Cloudflare
- Chat: `@cf/nvidia/nemotron-3-120b-a12b`
- Prompt/fast fallback: `@cf/google/gemma-4-26b-a4b-it`
- Imagem/edição: `@cf/black-forest-labs/flux-2-klein-4b`

### Hugging Face fallback
- Chat: `openai/gpt-oss-120b:cheapest`
- Chat fallback: `openai/gpt-oss-20b:fastest`
- Imagem: `black-forest-labs/FLUX.1-schnell`
- Edição: `black-forest-labs/FLUX.1-Kontext-dev`
- Vídeo: `Wan-AI/Wan2.1-T2V-1.3B`
- Imagem → vídeo: `Lightricks/LTX-Video`

## Vídeo

Vídeo continua sendo a parte mais cara da arquitetura. A v0.9 não ativa silenciosamente modelos pagos de terceiros no Cloudflare. Se a cota do Hugging Face acabar, a interface informa isso claramente em vez de gerar uma cobrança sem autorização.

## Configuração

### Secret existente
- `HF_TOKEN` — usado apenas para os fallbacks do Hugging Face e vídeo

### Variáveis opcionais
- `CF_CHAT_MODEL`
- `CF_PROMPT_MODEL`
- `CF_VISION_MODEL`
- `CF_IMAGE_MODEL`
- `HF_CHAT_MODEL`
- `HF_IMAGE_MODEL`
- `HF_IMAGE_EDIT_MODEL`
- `HF_VIDEO_MODEL`
- `HF_IMAGE_VIDEO_MODEL`
- `SEARXNG_URL`

## Validação

```bash
npm install
npm run check
npm run build
npx wrangler@4.141.0 deploy --dry-run
```

## Credenciais

Nunca exponha `HF_TOKEN` no frontend ou no repositório.
