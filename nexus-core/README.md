# NEXUS Core 0.1 — servidor próprio, experimental

**Status:** protótipo **isolado**, sem implantação, sem custo de inferência e sem alterar a NEXUS pública.
**Arquitetura:** `llama.cpp` (CPU) + modelo aberto `Qwen/Qwen3-0.6B-GGUF:Q8_0` + cliente Node independente.
**Licença dos pesos:** Apache 2.0, conferir diretamente no [model card](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF).
**Interface:** `POST /v1/chat/completions`, OpenAI-compatible.
**Importante:** não estamos treinando pesos nesta etapa; o objetivo é ter inferência independente funcionando e mensurável.

## Por que começamos assim

- Hospedagem e escolha de modelos ficam sob nosso controle. Não é um serviço pago de inferência de terceiros.
- A NEXUS em Cloudflare Workers continua como está, sem novas bindings, migrations ou secrets.
- Não subir o servidor não gera gastos. O `docker compose` tem perfil `inference` (execução somente quando solicitada).
- Modelo pequeno é para comprovar a estrutura, não para substituir respostas complexas da NEXUS.

## Testes sem modelo e sem custos (CI)

Na raiz do repositório:

```bash
npm run check:core
```

Isso verifica a configuração, a validação de URL HTTPS, o isolamento da chave, formato de mensagens, respostas, falhas de rede e timeout usando mocks locais. **Não baixa modelos e não faz chamadas para provedores.**

## Rodar em máquina/VM isolada com Docker (opcional, mediante aprovação de ambiente)

Requer Docker Compose, internet para a primeira transferência dos pesos e memória suficiente. Apenas rode numa máquina que você controle. No host:

```bash
cd nexus-core
cp .env.example .env
# Edite .env: substitua REPLACE_WITH... por uma chave aleatória forte.
# Exemplo local: python3 -c 'import secrets; print(secrets.token_urlsafe(36))'
chmod 600 .env
docker compose --profile inference up -d
```

A primeira inicialização pode demorar porque os pesos são baixados de Hugging Face para um volume de cache do Docker (não são incluídos no GitHub). O contêiner é intencionalmente limitado a 4 GiB e usa apenas CPU com duas threads. O modelo deve responder em `http://127.0.0.1:18080` **somente do host**. Se a VM não tiver Docker ou memória adequada, não rode.

A partir da mesma máquina:

```bash
set -a
source .env
set +a
export NEXUS_CORE_BASE_URL=http://127.0.0.1:18080
node smoke.mjs --live
```

A primeira consulta é um teste real do modelo, sem API da Groq ou Workers AI. O script informa se respondeu, o tempo e a saída; **não imprime a chave**. Nenhum desses comandos foi executado na sua conta ainda.

Parar:

```bash
docker compose --profile inference down
```

O volume de cache não é removido pelo `down`; remover pesos intencionalmente requer excluir o volume. Em cloud pago, **parar Docker não garante interromper a cobrança da VM**; desligue ou exclua o recurso no painel do provedor conforme a política de cobrança.

## Nuvem com menor custo: realidade de 2026

- Código e testes em GitHub: sem novos serviços contratados.
- Docker em VM com franquia gratuita legítima: possível se a conta **for elegível e houver capacidade**; não é garantia.
- Hugging Face CPU Basic informa tarifa de US$0/h, porém **criar novos Spaces de compute (Gradio/Docker) exige um plano pago**. Não presumimos que o usuário possa criar um Space gratuito.
- CPU pequena pode demorar bastante para gerar respostas; para um chatbot público de alta qualidade, a migração exige uma GPU/infraestrutura custeada e testes.
- **Não criar recursos Railway, Hugging Face ou qualquer VM neste marco:** um serviço sempre ativo pode consumir créditos ou gerar cobranças.

## Segurança e privacidade

1. `.env` é ignorado pelo Git. Nunca inclua a chave em chat, README, commit ou URL.
2. `compose.yaml` só publica a porta em `127.0.0.1`: não há endpoint aberto na internet.
3. Para ligar um Worker público ao Core em VM precisamos de **HTTPS autenticado de servidor para servidor** e controle de acesso. Isso será uma atualização separada, opcional, após verificar a inferência.
4. Não usar diretamente uma URL pública HTTP, não fazer proxy de uma API protegida pelo navegador e não transportar a chave de inferência ao React.
5. O cliente `core-client.mjs` aceita HTTP apenas para localhost; remoto exige HTTPS e bloqueia redirecionamentos para não enviar credenciais a outros hosts.
6. Dados das conversas da NEXUS não são copiados nem usados para treinamento automaticamente.

## Próximos marcos

1. **0.1:** código e contratos do servidor; CI verde; executar um teste real em host separado autorizado.
2. **0.2:** gateway privado e feature flag de integração com Worker, default desativado; comparar NEXUS Core vs atual em prompts de teste.
3. **0.3:** memória própria com isolamento/autenticação e recuperação de conhecimentos autorizados.
4. **0.4:** coletar exemplos corrigidos, limpar e avaliar dados; LoRA/QLoRA em GPU apenas com autorização de orçamento.
5. **1.0:** substituir parte do tráfego apenas se qualidade, tempo de resposta, custo e segurança forem aceitáveis.

**Regra de publicação:** esta PR deve continuar aberta enquanto não houver aprovação explícita para integrar. Criar a branch não altera a produção, e o Core não é instalado automaticamente pelo Cloudflare.
