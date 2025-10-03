# Chat Assistant

Serviço Node.js para armazenar histórico de conversas em MongoDB e interagir com a API da OpenAI, oferecendo dois fluxos de resposta: completions tradicionais e o fluxo Assistants v2 com ferramentas.

## Visão geral
- **Persistência**: todas as mensagens são guardadas em MongoDB com TTL opcional e índice por thread.
- **Integração OpenAI**: suporte tanto para `chat.completions` quanto para Threads/Assistants v2 (com cancelamento automático de runs pendentes e submissão de tool outputs).
- **Autenticação opcional**: um token Bearer pode ser exigido em todas as rotas.
- **Contexto configurável**: limite de mensagens e caracteres reaproveitados em cada chamada pode ser ajustado por variáveis de ambiente.

## Requisitos
- Node.js 20+
- MongoDB 6+
- Conta na OpenAI com chave de API válida
- (Opcional) Docker e Docker Compose

## Configuração
1. Copie `.env.example` (se existir) ou crie um arquivo `.env` com as variáveis abaixo.
2. Instale dependências: `npm install`.
3. Suba uma instância MongoDB local ou use a conexão fornecida em `MONGODB_URI`.
4. Inicie o servidor com `npm start`.

### Variáveis de ambiente
| Variável | Obrigatório | Default | Descrição |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Sim | — | Chave de API usada em todas as chamadas à OpenAI. A aplicação encerra se estiver ausente. |
| `OPENAI_MODEL` | Não | `gpt-4o-mini` | Modelo usado na rota `/reply`. |
| `OPENAI_ASSISTANT_ID` | Para Assistants | — | Identificador do assistant v2. Sem ele, `/assist/reply` retorna `assistant_not_configured`. |
| `PORT` | Não | `8080` | Porta HTTP local. |
| `MONGODB_URI` | Não | `mongodb://localhost:27017/chatdb` | URI de conexão do MongoDB. |
| `AUTH_TOKEN` | Não | `null` | Se definido, todas as rotas exigem `Authorization: Bearer <token>`. |
| `MAX_MESSAGES` | Não | `50` | Máximo de mensagens resgatadas ao montar contexto. |
| `MAX_CHARS` | Não | `16000` | Limite de caracteres para o contexto acumulado. |
| `TTL_HOURS` | Não | `0` | Quando > 0, cada mensagem recebe `expiresAt` com TTL de `TTL_HOURS`. |
| `ASSIST_POLL_MS` | Não | `800` | Intervalo de pooling ao aguardar runs do Assistants v2. |
| `ASSIST_POLL_TIMEOUT_MS` | Não | `20000` | Timeout máximo ao aguardar conclusão de runs. |

### Execução com Docker Compose
```bash
docker compose up --build
```
O serviço `mongo` é inicializado com usuário/senha `root`/`rootpass`. A aplicação usa a URI já configurada no `docker-compose.yml`.

## Estrutura
- `server.js`: define rotas HTTP e integrações com MongoDB e OpenAI.
- `helpers/assistants.js`: funções utilitárias para Threads e Runs da OpenAI.
- `ThreadMap.js`: mapeia `threadId` locais para `openaiThreadId`.
- `catalog.js`: tabela de candidatos válidos e filas Salesforce correspondentes.

## Rotas
Todas as rotas aceitam/retornam JSON e, se `AUTH_TOKEN` estiver definido, exigem header `Authorization: Bearer <token>`.

### `GET /health`
Retorna o status da aplicação e da conexão MongoDB.
```json
{ "ok": true, "mongo": "up" }
```

### `POST /messages`
Insere uma mensagem manualmente.

**Body**
```json
{
  "threadId": "thread-123",
  "role": "user",
  "content": "Mensagem enviada",
  "externalId": "opcional"
}
```

**Respostas**
- `201`: `{ "id": "<uuid>" }`
- `400`: campos obrigatórios ausentes ou `role` inválido
- `500`: erro na inserção

### `GET /threads/:threadId`
Retorna todas as mensagens (ordenadas por criação) para a thread informada.

### `POST /reply`
Fluxo tradicional usando `chat.completions`.

**Body**
```json
{
  "threadId": "thread-123",
  "latestUserInput": "Olá, tudo bem?",
  "systemPrompt": "Instrua o modelo a responder em PT-BR"
}
```

1. Caso `latestUserInput` exista, registra a mensagem do usuário.
2. Busca até `MAX_MESSAGES` mensagens anteriores respeitando `MAX_CHARS`.
3. Monta payload com prompt de sistema (default: "Você é um assistente útil...").
4. Chama a OpenAI e salva a resposta retornada.

**Resposta**
```json
{
  "threadId": "thread-123",
  "reply": "Olá! Como posso ajudar?"
}
```

### `POST /assist/reply`
Fluxo baseado no Assistants v2. Exige `OPENAI_ASSISTANT_ID`.

**Body**
```json
{
  "threadId": "thread-123",
  "latestUserInput": "Preciso de ajuda com cobrança"
}
```

Processo resumido:
1. Garante que existe um thread remoto (`ThreadMap`).
2. Cancela runs pendentes antes de enviar nova mensagem.
3. Inicia novo run e fica em loop até `requires_action` ou conclusão.
4. Caso o assistant solicite tool outputs `emit_routing`, responde com dados de roteamento (filas Salesforce).
5. Persist e devolve a resposta final (textual ou `display_text` do tool call).

**Resposta**
```json
{
  "threadId": "thread-123",
  "reply": "Encaminhei sua solicitação para o time financeiro.",
  "openaiThreadId": "thread_abc",
  "decision": {
    "salesforce_queue": "Queue_Financeiro_COC",
    "candidate_id": "COC::Financeiro",
    "confidence": 0.92,
    "abstain": false,
    "rationale": "Dados apontam para fila financeira"
  }
}
```

## Desenvolvimento
- Logs de erros de OpenAI aparecem no console com status HTTP e corpo retornado.
- Para limpar mensagens expiradas configure `TTL_HOURS > 0`; o índice TTL do MongoDB remove documentos automaticamente.
- Teste a API usando ferramentas como `curl` ou Insomnia.

### Exemplo `curl`
```bash
curl -X POST http://localhost:8080/reply \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"demo","latestUserInput":"Olá"}'
```

## Licença
Defina a licença aqui, se aplicável.
