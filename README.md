# NEXUS AI v1.0

NEXUS AI é um assistente multimodal web com React/Vite e um único Cloudflare Worker. A v1 usa roteamento automático, memória longa, visão, documentos, pesquisa e geração visual para maximizar inteligência por custo.

## Roteador inteligente
- geral: `@cf/google/gemma-4-26b-a4b-it`
- código: `@cf/zai-org/glm-4.7-flash`
- raciocínio profundo: `@cf/openai/gpt-oss-120b` com reasoning high
- visão: `@cf/qwen/qwen3.8-27b`
- imagem rápida/edição: `@cf/black-forest-labs/flux-2-klein-4b`
- imagem HQ/edição: `@cf/black-forest-labs/flux-2-klein-9b`
- pesquisa: `web_search_options` com SearXNG opcional como fallback

## Memória
- até 60 mensagens recentes podem entrar no orçamento de contexto
- conversas longas são compactadas em uma memória de longo prazo via `/api/memory`
- decisões, estados técnicos, requisitos e pendências antigas continuam disponíveis
- mensagens recentes vencem a memória compactada em caso de conflito
- cada thread envia `sessionId` e usa `x-session-affinity` para favorecer prompt caching

## Documentos e arquivos
- texto/código: leitura local no navegador
- PDF, DOCX, XLS/XLSX/XLSM/XLSB, ODS, ODT e Numbers: `env.AI.toMarkdown`
- o conteúdo convertido é guardado no contexto da conversa para perguntas seguintes

## Imagens
- FLUX.2 usa multipart tanto na geração quanto na edição
- a imagem anterior é enviada como referência real em continuações
- somente a cópia enviada à IA é reduzida para caber no limite de referência
- pedidos explícitos de alta qualidade usam 9B; se ele falhar, a NEXUS tenta 4B antes de sair do Cloudflare
- a imagem original permanece no IndexedDB do navegador

## Prompt Director
Gemma 4 pode refinar silenciosamente prompts de imagem/vídeo preservando estilo, personagens, cores, objetos e restrições. Com Workers AI disponível, essa etapa não cai para o Hugging Face.

## Pesquisa
Primeiro usa pesquisa nativa do modelo via `web_search_options`; se necessário e configurado, usa SearXNG. Citações em `citations` e `annotations/url_citation` são extraídas e mostradas na interface.

## Respostas
Respostas do assistente são renderizadas com Markdown/GFM, incluindo código, tabelas, listas, links e blockquotes.

## Proteção de cota
O Worker usa bindings nativos de Rate Limiting:
- 30 chamadas de chat/memória por minuto por cliente anônimo
- 8 gerações de mídia por minuto por cliente anônimo
- proteção agregada de 120 chamadas de IA por minuto por localidade Cloudflare

O navegador cria um UUID local anônimo (`nexus_client_id`) apenas para limitar abuso de uso. Não é necessário login.

## Vídeo
Vídeo continua isolado no Hugging Face (`Wan-AI/Wan2.1-T2V-1.3B` e `Lightricks/LTX-Video`). Se a cota do HF acabar, chat, visão, raciocínio, documentos e imagens continuam pelo Workers AI. Modelos de vídeo pagos não são ativados automaticamente.

## Fallbacks
Hugging Face permanece como fallback opcional para chat e imagem. `HF_TOKEN` é Secret do Worker e nunca deve ser exposto no frontend.

## Validação
Cada push em `main` executa:
```bash
npm install
npm run check
npm run build
npx wrangler@4.141.0 deploy --dry-run --outdir .wrangler-dry
```

## Endpoints
- `GET /api/status`
- `POST /api/chat`
- `POST /api/memory`
- `POST /api/image`
- `POST /api/video`
