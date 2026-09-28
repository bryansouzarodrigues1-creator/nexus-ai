# NEXUS AI v2.0

NEXUS AI é um assistente multimodal web construído com React/Vite, Cloudflare Worker, Workers AI, Durable Objects e Workflows.

A V2 deixou de ser apenas um roteador de modelos e passou a ter estado server-side, raciocínio durável multi-etapas, verificação, reparo e edição visual validada.

## Arquitetura

```text
React / Vite
    ↓
Cloudflare Worker
    ├── chat rápido / visão / documentos / imagem
    ├── ConversationState (Durable Object)
    └── NexusAgentWorkflow (Cloudflare Workflow)
             ↓
       planner
         ↓
       tools
         ↓
       solver
         ↓
       critic
         ↓
      escalation?
       ↙       ↘
   modelo      GPT-OSS 120B
   rápido
       ↘       ↙
       verifier
          ↓
       repair se necessário
          ↓
        resposta
```

## Estado server-side

Cada conversa pode usar um `ConversationState` dedicado via Durable Objects.

Ele guarda:
- memória compactada;
- eventos recentes;
- tarefas do agente;
- métricas;
- perfil técnico da conversa.

IndexedDB continua sendo usado no navegador para mídia local, mas a inteligência da conversa não depende somente do cliente.

## Agente durável

Pedidos complexos ou de intensidade máxima podem ir para `NexusAgentWorkflow`.

O workflow usa:
1. Planner;
2. ferramentas registradas;
3. Solver;
4. Critic;
5. escalonamento para GPT-OSS 120B quando necessário;
6. Verifier;
7. reparo final quando a resposta não passa no limiar.

O processo é durável e consultado pela UI via polling.

## Tool Registry

Ferramentas permitidas atualmente:
- `web_search`
- `calculator`
- `conversation_context`

O Planner só pode solicitar ferramentas registradas.

Pedidos para ferramentas inexistentes são rejeitados de forma controlada. A NEXUS não executa nomes inventados como `dalle.text2im` ou pseudo tool calls.

A calculadora usa parser aritmético próprio; não usa `eval`.

## Modelos

### Workers AI
- geral: `@cf/google/gemma-4-26b-a4b-it`
- código / critic / verifier: `@cf/zai-org/glm-4.7-flash`
- raciocínio profundo: `@cf/openai/gpt-oss-120b`
- visão: `@cf/qwen/qwen3.8-27b`
- imagem rápida / edição: `@cf/black-forest-labs/flux-2-klein-4b`
- imagem qualidade / edição: `@cf/black-forest-labs/flux-2-klein-9b`

### Hugging Face fallback
- chat: GPT-OSS
- imagem: FLUX.1 Schnell
- edição: FLUX.1 Kontext
- vídeo: Wan 2.1 / LTX-Video

HF continua sendo fallback. Se sua cota acabar, chat, agente, visão, documentos e imagem ainda podem continuar pelo Cloudflare.

## Edição visual V2

Quando existe uma imagem de referência, a NEXUS não usa o Prompt Director criativo normal.

O pipeline é:

```text
imagem original
    +
pedido
    ↓
descrição visual
    ↓
EditSpec restritivo
    ↓
FLUX.2 com imagem de referência
    ↓
Visual Verifier
    ↓
passou?
  ↙     ↘
sim     não
 ↓       ↓
final   retry corretivo
           ↓
      verifica novamente
           ↓
      melhor tentativa
```

O EditSpec separa:
- o que deve ser preservado;
- o que pode mudar;
- alterações proibidas;
- âncoras de identidade, composição e estilo.

O verificador mede cumprimento do pedido e preservação. Se uma segunda tentativa for pior que a primeira, a NEXUS mantém a melhor.

A UI pode mostrar o score visual e se houve retry.

## Geração nova de imagem

Quando não há referência:
- Prompt Director pode enriquecer o pedido;
- FLUX.2 4B é o padrão;
- pedidos explícitos de máxima qualidade podem usar 9B;
- 9B pode cair para 4B antes do fallback externo.

## Memória

A NEXUS combina:
- histórico recente;
- memória compactada;
- Durable Object por conversa;
- `sessionId` e session affinity.

Mensagens recentes vencem a memória antiga em caso de conflito.

## Documentos

Suporte atual:
- PDF;
- DOCX;
- XLS/XLSX/XLSM/XLSB;
- ODS/ODT;
- Numbers;
- texto e arquivos de código.

Documentos ricos são convertidos via `env.AI.toMarkdown`.

## Pesquisa

A pesquisa pode usar `web_search_options` no Workers AI. SearXNG continua disponível como fallback opcional quando configurado.

## Observabilidade

O Durable Object registra métricas de:
- rota;
- provedor;
- modelo;
- latência;
- sucesso/erro;
- score do verifier;
- escalonamento;
- reparo;
- ferramentas solicitadas/sucedidas;
- score visual e retries de edição.

## Rate limiting

Bindings nativos protegem a franquia:
- chat/memória por cliente;
- mídia por cliente;
- limite agregado de uso de IA.

O frontend usa um UUID anônimo local apenas para controle de abuso.

## Vídeo

Vídeo ainda é experimental e permanece separado.

O fluxo atual usa Hugging Face para:
- text-to-video;
- image-to-video.

A V2 não ativa automaticamente serviços pagos de vídeo.

## Endpoints

- `GET /api/status`
- `POST /api/chat`
- `POST /api/memory`
- `POST /api/agent/start`
- `GET /api/agent/:id`
- `POST /api/image`
- `POST /api/video`

## Validação

Todo push em `main` executa:

```bash
npm install
npm run check
npm run build
npx wrangler@4.141.0 deploy --dry-run --outdir .wrangler-dry
```

## Ainda não implementado

Itens planejados, mas que não devem ser confundidos com recursos atuais:
- sandbox seguro para executar código;
- embeddings / Vectorize / pgvector;
- streaming token a token;
- provider self-hosted com vLLM;
- pipeline profissional de video-to-video;
- geração de vídeo gratuita confiável e ilimitada.

## Segurança de credenciais

`HF_TOKEN` fica como Secret no Worker. Nunca deve ir para frontend ou GitHub.
