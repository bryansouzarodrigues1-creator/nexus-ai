# NEXUS AI v2.6

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

## Image Intelligence V2.6

A V2.6 transforma a geração/edição de imagem em um pipeline de decisão e validação, em vez de enviar o prompt cru diretamente ao modelo.

### Image Task Router

Antes da geração, a NEXUS classifica a intenção em um dos modos:

- `create`
- `strict_edit`
- `enhance`
- `remove_replace`
- `poster`
- `identity_lock`
- `background`

O plano também define:
- nível de preservação;
- força da edição;
- se a mudança deve ser localizada;
- necessidade de bloqueio de identidade;
- necessidade de fidelidade de texto;
- critérios de sucesso;
- riscos prováveis;
- proporção da saída.

### Visual Context V2

Quando existe referência, a NEXUS extrai contexto visual estruturado antes de editar:

- sujeito principal;
- quantidade de sujeitos;
- presença de rosto;
- traços visuais úteis para preservar aparência;
- roupa;
- pose;
- enquadramento;
- fundo;
- iluminação;
- estilo;
- cores;
- texto existente;
- elementos protegidos/editáveis;
- âncoras espaciais;
- áreas de risco.

O contexto é descritivo e não tenta identificar pessoas reais.

### EditSpec V2

O Edit Planner recebe o Task Plan + Visual Context + lições do Learning Loop e gera:

```text
operationType
targetChange[]
preserve[]
forbiddenChanges[]
identityAnchor
compositionAnchor
styleAnchor
editStrength
localized
successCriteria[]
failureRisks[]
textRequirements[]
```

### Visual Verifier V2

Em edição, o verificador tenta comparar diretamente a imagem original e o resultado usando o modelo de visão. Se a comparação multimodal não estiver disponível, usa descrições visuais como fallback.

Criações do zero e posters também passam por um Generation Verifier. Ele compara o resultado com o pedido, verifica composição, cumprimento do prompt, artefatos, realismo e fidelidade de texto. Portanto o auto-reparo não fica limitado a edições.

Scores avaliados:
- qualidade global;
- identidade;
- composição;
- preservação de fundo;
- preservação de estilo;
- cumprimento do pedido;
- ausência de artefatos;
- fidelidade de texto;
- realismo.

Os limiares ficam mais rígidos quando o Task Router marca preservação `high` ou `maximum`.

### Retry corretivo orientado por falha

No modo Qualidade, uma edição ou geração reprovada pode receber até duas novas tentativas. Cada retry recebe os problemas concretos detectados pelo verifier. No modo rápido, uma tentativa corretiva pode ser feita quando a verificação está disponível.

A NEXUS não escolhe automaticamente o último resultado: cada candidato recebe score ponderado e a melhor tentativa vence.

### Proporção e resolução

A referência enviada ao FLUX.2 continua abaixo de 512×512 por exigência do provider.

A saída, porém, preserva a proporção original da imagem:
- modo rápido: lado maior em torno de 1024 px;
- modo qualidade: lado maior em torno de 1536 px.

Para criação sem referência, o Task Router escolhe entre proporções comuns como 1:1, 16:9, 9:16 e 4:5.

### Aprendizado visual

Falhas finais do Visual Verifier podem virar lições reutilizáveis no Learning Loop, incluindo o tipo da tarefa e o nível de preservação.

A V2.6 também mantém uma **Image Case Memory** persistente. Ela não guarda os pixels/imagens geradas. Guarda somente metadados úteis de experiência, como:
- modo visual;
- resumo da intenção;
- nível de preservação;
- provider/modelo;
- score;
- identidade;
- cumprimento do pedido;
- artefatos;
- fidelidade de texto;
- retries;
- problemas e mudanças indesejadas observadas.

Antes de uma nova tarefa visual, casos anteriores do mesmo modo podem ser recuperados e usados pelo Visual Context Extractor/Edit Planner.

A UI exibe quando disponível:
- tipo de tarefa visual;
- nível de preservação;
- score visual;
- score de identidade;
- cumprimento do pedido;
- ausência de artefatos;
- quantidade de retries;
- resolução da saída.

## Estado server-side

Cada conversa pode usar um `ConversationState` dedicado via Durable Objects.

Ele guarda:
- memória compactada;
- eventos recentes;
- tarefas do agente;
- métricas;
- perfil técnico da conversa.

IndexedDB continua sendo usado no navegador para mídia local, mas a inteligência da conversa não depende somente do cliente.

## Learning Loop V2.2

A V2.2 adiciona aprendizado persistente no nível do sistema.

Isso NÃO altera os pesos dos modelos base. O aprendizado acontece por memória, feedback, métricas, recuperação de lições e adaptação dos planners.

O Learning Store global guarda:
- feedback positivo/negativo;
- lições reutilizáveis;
- desempenho por task/provider/model;
- taxa de sucesso;
- aprovação explícita;
- score médio;
- quantidade de retries;
- latência recente.

Fontes de aprendizado:
- botões 👍 / 👎 na UI;
- correções naturais como "não foi isso", "ficou ruim", "nada a ver";
- sinais positivos como "agora sim", "perfeito", "isso mesmo";
- scores do Visual Verifier;
- resultados de chat, agente, imagem e vídeo;
- falhas e fallbacks dos providers.

Quando existe feedback textual, um modelo extrai uma regra curta e generalizável antes de armazená-la. Ele é instruído a não guardar tokens, senhas ou detalhes pessoais sem valor geral.

Chat, agente, edição de imagem e Video Planner recuperam lições anteriores antes de executar novas tarefas.

O Visual Verifier também pode gerar automaticamente uma lição quando uma edição falha de forma material.

Exemplo:

```text
edição troca o rosto
      ↓
Visual Verifier detecta
      ↓
lição persistente
      ↓
próxima edição semelhante
      ↓
Edit Planner recebe a regra antes de gerar
```

O próximo nível futuro é transformar dados aprovados em dataset limpo para LoRA/fine-tuning. Isso ainda não faz parte da V2.2.

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

## Adaptive Core V2.5

A V2.5 transforma o Learning Loop em um roteador que realmente usa o histórico.

### Adaptive Router

O roteador agora combina:

- heurística base do pedido;
- confiabilidade operacional;
- feedback explícito positivo/negativo;
- score de verificadores;
- latência média;
- custo relativo da rota;
- quantidade de evidência disponível;
- exploração controlada de alternativas.

O histórico usa suavização e priors para impedir que uma ou duas amostras mudem a rota prematuramente.

Pedidos explícitos de raciocínio profundo ou qualidade máxima continuam bloqueando downgrade automático.

### Falha operacional não é falha de qualidade

O Learning Store diferencia:

- quota/créditos;
- rate limit;
- autenticação;
- incompatibilidade de modelo/task;
- timeout/falha transitória;
- erro de qualidade.

Assim, um modelo não perde reputação de qualidade apenas porque um provedor ficou sem saldo ou indisponível.

### Chat adaptativo

Rotas gerais e de código podem mudar de modelo somente quando há evidência histórica suficiente.

Rotas de pesquisa, visão e raciocínio profundo permanecem mais conservadoras.

### Imagem adaptativa

No modo normal, a NEXUS pode escolher entre o modelo rápido e o modelo de qualidade usando o histórico de:

- verifier visual;
- feedback do usuário;
- confiabilidade;
- latência;
- custo relativo.

Quando o usuário pede qualidade máxima explicitamente, o modelo de qualidade continua obrigatório como primeira tentativa.

### Diagnóstico de aprendizado

Novo endpoint:

```text
GET /api/learning/status
```

Ele retorna somente telemetria agregada e lições reutilizáveis. Não retorna conteúdo bruto de conversas.

A interface agora possui o painel **Aprendizado**, mostrando:

- modelos e rotas rastreados;
- confiabilidade;
- aprovação explícita;
- score médio;
- latência;
- quantidade de amostras;
- falhas operacionais versus falhas de qualidade;
- lições aprendidas.

O roteador puro possui testes de regressão executados no `npm run check`.

## Core Focus V2.4

A V2.4 prioriza os recursos de melhor custo/benefício para uso próprio:

- chat e raciocínio;
- pesquisa;
- arquivos;
- visão;
- geração e edição de imagens;
- Learning Loop.

### Vídeo

A infraestrutura de vídeo V2.3 foi preservada, mas fica **desativada por padrão** para evitar gasto acidental.

Mesmo com chaves configuradas, `POST /api/video` só gera vídeo quando:

```text
VIDEO_ENABLED=1
```

Sem essa flag, o backend recusa a geração antes de chamar qualquer provider.

A aba Vídeo continua visível como recurso futuro.

### Codex

A interface reserva uma aba **Codex · Futuro**.

Nenhuma API de coding dedicada é chamada nessa fase. Programação continua disponível pelo chat/agente atual usando a infraestrutura já existente.

A ideia futura é criar um agente de código completo com leitura de projeto, edição, execução, testes e reparo, mas somente quando custo e infraestrutura justificarem.

## Video Provider Pool V2.3

A NEXUS pode usar vários provedores de vídeo legítimos e independentes.

Ordem padrão:

```text
WaveSpeed
   ↓ se indisponível / sem saldo
Novita
   ↓ se indisponível / sem saldo
Hugging Face
```

A ordem pode ser alterada por `VIDEO_PROVIDER_ORDER`.

Provedores suportados atualmente:
- Hugging Face Inference Providers;
- WaveSpeed direct API;
- Novita direct API para text-to-video.

WaveSpeed usa LTX 2.5 por padrão para:
- text-to-video;
- image-to-video.

Novita usa Wan 2.7 por padrão para text-to-video.

Image-to-video na Novita não está habilitado ainda porque a API exige uma URL de imagem; a NEXUS não publica automaticamente imagens privadas do usuário.

Chaves esperadas:
- `HF_TOKEN`
- `WAVESPEED_API_KEY`
- `NOVITA_API_KEY`

Nenhuma chave deve ser exposta no frontend.

O pool tenta somente provedores para os quais existe uma chave configurada. Se um falhar por cota, incompatibilidade ou indisponibilidade, a próxima opção é tentada.

A NEXUS registra qual provider funcionou ou falhou no Learning Loop, preparando o caminho para roteamento adaptativo por desempenho e custo.

## Video Foundation V2.1

Vídeo continua experimental, mas agora possui um pipeline próprio.

### Text-to-video

Fluxo:

```text
pedido
  ↓
Video Planner
  ↓
prompt temporal + câmera + movimento + negative prompt
  ↓
router de modelos
  ↓
modelo rápido ou qualidade
  ↓
fallbacks controlados
  ↓
MP4
```

Modelo text-to-video padrão:
- `tencent/HunyuanVideo`

A V2.1.1 removeu LTX 0.9.8 13B e Wan 2.1 1.3B da lista automática de text-to-video depois de detectar incompatibilidades reais no provider Fal.

Modelos T2V adicionais só entram automaticamente quando configurados explicitamente por variável de ambiente.

O provider padrão é `auto`, podendo ser sobrescrito por `HF_VIDEO_PROVIDER`.

### Image-to-video

Quando existe imagem de referência:

```text
imagem
  +
pedido
  ↓
Video Planner
  ↓
image-text-to-video
  ↓
LTX-Video
  ↓
se indisponível
  ↓
image-to-video
  ↓
Wan I2V
```

Modelo padrão:
- `Lightricks/LTX-Video-0.9.8-13B-distilled`

A V2.1.1 usa o task `imageToVideo` diretamente, incluindo o prompt como parâmetro. Um fallback I2V adicional só é usado se for configurado explicitamente.

Regra importante: se todos os modelos condicionados pela imagem falharem, a NEXUS retorna erro.

Ela NÃO cai para text-to-video, porque isso perderia a referência e poderia gerar uma cena totalmente diferente.

### Qualidade

Pedidos normais usam modo `fast`.

Termos como "máxima qualidade", "cinematográfico" ou "melhor qualidade" ativam `quality`.

O Video Planner controla de forma conservadora:
- movimento;
- câmera;
- negative prompt;
- número de frames;
- guidance;
- passos de inferência.

### Observabilidade de vídeo

A NEXUS registra:
- modelo;
- provider;
- rota text-to-video/image-to-video;
- latência;
- qualidade;
- quantidade de fallbacks;
- falhas por modelo.

A UI mostra quando o Video Planner foi usado e se houve fallback.

### Custos

A V2.1 não ativa automaticamente nenhum serviço pago.

Vídeo depende de infraestrutura GPU externa disponível através do provedor configurado. Se a cota/crédito acabar, a NEXUS informa isso sem prejudicar chat, imagem, visão, documentos ou agente.

## Endpoints

- `GET /api/status`
- `POST /api/chat`
- `POST /api/memory`
- `POST /api/feedback`
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
- verificação automática frame-a-frame de vídeo;
- geração de vídeo gratuita confiável e ilimitada.

## Segurança de credenciais

`HF_TOKEN` fica como Secret no Worker. Nunca deve ir para frontend ou GitHub.
