# NEXUS AI v0.1

MVP web preparado para chat, pesquisa, arquivos, imagem e vídeo com arquitetura de provedores plugáveis.

## Rodar localmente (opcional)
```bash
npm install
npm run dev
```

## Deploy grátis
- Frontend: Cloudflare Pages ou GitHub Pages.
- API: Cloudflare Worker usando `worker/index.js`.
- Segredo opcional: `HF_TOKEN`.
- Modelo configurável: `HF_MODEL`.

## Estado atual
- Interface responsiva: pronta.
- Histórico local: pronto.
- Modos Chat/Pesquisa: prontos na UI.
- Endpoint server-side: pronto.
- Adapter Hugging Face: preparado.
- Pesquisa web real: próximo adapter.
- Upload/visão: próximo adapter.
- Imagem/vídeo: estrutura/UI preparada; motores ainda não conectados.

Nunca coloque tokens no código do frontend.
