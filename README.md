# Chat Assistant

Aplicacao Node.js/Express com MongoDB para operar um assistente baseado em OpenAI Assistants v2, com:

- chat web autenticado
- area administrativa para auditoria de threads, decisoes e usuarios
- integracao com OpenAI Threads/Runs
- persistencia local de mensagens e decisoes em MongoDB
- suporte a streaming SSE e resposta JSON tradicional

## Visao geral

O projeto expõe uma interface web simples e uma API HTTP no mesmo processo:

- a raiz `/` redireciona para a area administrativa se houver sessao ativa
- usuarios nao autenticados sao enviados para `/login.html`
- o chat autenticado fica em `/chat`
- a area administrativa fica em `/admin/`
- as chamadas ao assistant acontecem em `/assist/reply` e `/assist/stream`

O backend mantem um mapeamento entre `threadId` local e `openaiThreadId` remoto, salva mensagens e decisoes no MongoDB e, quando o assistant pede `emit_routing`, transforma isso em um payload normalizado com campos como `candidate_id`, `confidence`, `abstain` e `display_text`.

## Stack

- Node.js 20+
- Express 4
- MongoDB 6+
- Mongoose 8
- OpenAI Assistants v2
- Docker / Docker Compose opcionais

## Estrutura

### Backend

- `server.js`: bootstrap do Express, middlewares, rotas web e API, conexao com Mongo.
- `src/config/env.js`: leitura e validacao das variaveis de ambiente.
- `src/db/mongoose.js`: conexao Mongoose.
- `src/routes/*.js`: definicao das rotas HTTP.
- `src/controllers/*.js`: regras de entrada/saida HTTP.
- `src/services/AssistConversationService.js`: orquestracao principal do fluxo com a OpenAI.
- `src/clients/OpenAIAssistantsClient.js`: chamadas HTTP para threads, runs, mensagens e streaming da OpenAI.
- `src/domain/*.js`: interpretacao de eventos do streaming e decisao de roteamento.
- `src/models/*.js`: colecoes MongoDB.
- `src/middleware/*.js`: autenticacao por bearer token opcional e autenticacao por cookie de sessao.

### Frontend

- `public/login.html`: tela de login. Se nao existir nenhum usuario, o primeiro acesso tenta bootstrap via `/auth/register`.
- `public/index.html`: tela de chat autenticada.
- `public/admin/index.html`: listagem de threads.
- `public/admin/thread.html`: detalhe de uma thread.
- `public/admin/dashboard.html`: indicadores agregados.
- `public/admin/users.html`: administracao de usuarios.

## Como a aplicacao funciona

### 1. Autenticacao web

- O login web usa cookie `session`, assinado com `SESSION_SECRET`.
- O primeiro usuario do sistema pode ser criado automaticamente via `POST /auth/register`.
- Depois que ja existe um usuario, novos cadastros publicos sao bloqueados.
- Apenas usuarios `admin` podem criar usuarios e resetar senhas.

### 2. Conversa com a OpenAI

Fluxo de `/assist/reply`:

1. Garante que `OPENAI_ASSISTANT_ID` exista.
2. Gera `threadId` se o cliente nao enviar um.
3. Salva a mensagem do usuario no MongoDB.
4. Garante ou cria o `openaiThreadId` remoto.
5. Cancela o ultimo run ativo, se houver.
6. Envia a nova mensagem para a thread na OpenAI.
7. Executa o assistant, por padrao no caminho rapido baseado em streaming.
8. Se houver tool call `emit_routing`, transforma a decisao em payload local.
9. Faz fallback para buscar a resposta final da thread se o streaming rapido nao retornar texto suficiente.
10. Persiste a resposta do assistant e a decisao no MongoDB.
11. Retorna JSON para o cliente.

Fluxo de `/assist/stream`:

- inicia uma resposta SSE
- envia o evento inicial `thread`
- repassa `delta` conforme a OpenAI gera texto
- publica `decision` quando aparece `emit_routing`
- encerra com `completed`

### 3. Persistencia

Colecoes principais:

- `Message`: mensagens `user` e `assistant`
- `Decision`: decisoes de roteamento retornadas pelo assistant
- `ThreadMap`: relacao entre `threadId` local e `openaiThreadId`
- `User`: usuarios da interface administrativa

## Variaveis de ambiente

Estas sao as variaveis realmente usadas pelo codigo atual:

| Variavel | Obrigatoria | Default | Uso |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Sim | - | Chave usada nas chamadas para a OpenAI. A aplicacao nao inicia sem ela. |
| `OPENAI_ASSISTANT_ID` | Sim para responder | - | Assistant v2 usado em `/assist/reply` e `/assist/stream`. |
| `PORT` | Nao | `8080` | Porta HTTP local. |
| `MONGODB_URI` | Nao | `mongodb://localhost:27017/chatdb` | URI de conexao do MongoDB. |
| `AUTH_TOKEN` | Nao | `null` | Se definido, exige `Authorization: Bearer <token>` nas rotas `/assist/*`. |
| `ASSIST_POLL_MS` | Nao | `200` | Intervalo de polling em partes do fluxo de runs. |
| `ASSIST_POLL_TIMEOUT_MS` | Nao | `15000` | Timeout maximo ao aguardar conclusao de runs. |
| `REPLY_FAST_DEFAULT` | Nao | `true` | Ativa o caminho rapido baseado em streaming em `/assist/reply`. |
| `REPLY_FLAT_DEFAULT` | Nao | `true` | Faz `/assist/reply` responder no formato flat esperado por integracoes externas. |
| `SESSION_SECRET` | Nao, mas recomendado | `dev-secret` | Segredo usado para assinar o cookie de sessao. |
| `NODE_ENV` | Nao | - | Em `production`, o cookie de sessao recebe `Secure` e `SameSite=None`. |
| `DEBUG_SSE` | Nao | `false` | Habilita logs de eventos SSE no console. |
| `DEBUG_RUN` | Nao | `false` | Habilita logs de polling e estados de run. |

### Variaveis legadas no `.env.sample`

O arquivo `.env.sample` ainda contem algumas variaveis antigas, como `OPENAI_MODEL`, `MAX_MESSAGES`, `MAX_CHARS` e `TTL_HOURS`, mas o codigo atual nao as utiliza.

## Exemplo de `.env`

```env
PORT=8080
MONGODB_URI=mongodb://localhost:27017/chatdb
OPENAI_API_KEY=<sua-chave>
OPENAI_ASSISTANT_ID=<assistant-id>
AUTH_TOKEN=
ASSIST_POLL_MS=800
ASSIST_POLL_TIMEOUT_MS=20000
REPLY_FAST_DEFAULT=true
REPLY_FLAT_DEFAULT=true
SESSION_SECRET=troque-isto-em-producao
DEBUG_SSE=false
DEBUG_RUN=false
```

## Executando localmente

### Sem Docker

1. Instale dependencias:

```bash
npm install
```

2. Garanta um MongoDB acessivel.

3. Configure o `.env`.

4. Inicie a aplicacao:

```bash
npm start
```

5. Acesse:

- `http://localhost:8080/login.html`
- `http://localhost:8080/admin/`
- `http://localhost:8080/chat`

### Com Docker Compose

O `docker-compose.yml` sobe:

- `mongo` com usuario `root` e senha `rootpass`
- `app` expondo `8080:8080`

Subida:

```bash
docker compose up --build
```

Parada:

```bash
docker compose down
```

Observacao importante:

- no `docker-compose.yml`, o app recebe `MONGODB_URI=mongodb://root:rootpass@mongo:27017/chatdb?authSource=admin`
- esse hostname `mongo` funciona dentro da rede do Compose
- em EC2 sem Compose, ele nao funciona; nesse caso use um hostname/IP real do Mongo

## Rotas web

### Navegacao

- `GET /`
  - com sessao: redireciona para `/admin/`
  - sem sessao: redireciona para `/login.html?next=%2Fadmin%2F`

- `GET /login.html`
  - pagina de login

- `GET /chat`
  - exige sessao
  - serve a interface de chat

- `GET /admin/`
  - exige sessao
  - serve a lista de threads

- `GET /admin/index.html`
- `GET /admin/thread.html`
- `GET /admin/dashboard.html`
  - exigem sessao

`public/admin/users.html` existe e pode ser servido pelo `express.static`, mas a protecao de API continua sendo feita no backend das rotas `/admin/users`.

## Rotas de autenticacao

### `POST /auth/register`

Cria o primeiro usuario do sistema. Se ja existir qualquer usuario, responde `403 register_disabled`.

Body:

```json
{
  "email": "admin@empresa.com",
  "name": "Admin",
  "password": "SenhaForte123"
}
```

Resposta:

```json
{
  "id": "user-id",
  "email": "admin@empresa.com",
  "name": "Admin",
  "role": "admin"
}
```

### `POST /auth/login`

Autentica um usuario e grava cookie de sessao.

Body:

```json
{
  "email": "admin@empresa.com",
  "password": "SenhaForte123"
}
```

### `GET /auth/me`

Retorna o usuario autenticado a partir do cookie de sessao.

### `POST /auth/logout`

Limpa o cookie `session`.

### `POST /auth/change-password`

Exige sessao. Altera a senha do usuario autenticado.

Body:

```json
{
  "currentPassword": "senha-atual",
  "newPassword": "senha-nova"
}
```

## Rotas do assistant

Se `AUTH_TOKEN` estiver definido, as rotas abaixo exigem:

```http
Authorization: Bearer <AUTH_TOKEN>
```

### `POST /assist/reply`

Retorna a resposta do assistant em JSON.

Body:

```json
{
  "threadId": "thread-123",
  "latestUserInput": "Preciso de ajuda com cobranca"
}
```

Resposta tipica no modo flat:

```json
{
  "threadId": "thread-123",
  "display_text": "Encaminhei sua solicitacao para o time financeiro.",
  "candidate_id": "UNIDADE::AREA",
  "confidence": 0.92,
  "abstain": false,
  "rationale": "Dados apontam para fila financeira",
  "next_steps": [],
  "questions_needed": [],
  "reply": "Encaminhei sua solicitacao para o time financeiro."
}
```

Observacoes:

- se `threadId` nao for enviado, o backend gera um UUID
- se o caminho rapido nao retornar texto suficiente, o backend busca a resposta final na thread antes de responder

### `GET /assist/stream`
### `POST /assist/stream`

Retornam Server-Sent Events.

Parametros:

- `threadId`
- `latestUserInput`

Eventos esperados:

- `thread`
- `delta`
- `decision`
- `completed`
- `error`

Exemplo com `curl`:

```bash
curl -N "http://localhost:8080/assist/stream?threadId=demo&latestUserInput=Ola"
```

## Rotas administrativas

Todas exigem sessao autenticada. Algumas exigem perfil `admin`.

### `GET /admin/threads`

Lista threads com filtros e ordenacao.

Query params:

- `search`
- `from`
- `to`
- `page`
- `limit`
- `sort` em `threadId|firstAt|lastAt|messageCount`
- `dir` em `asc|desc`

### `GET /admin/threads/:threadId/messages`

Retorna:

- mensagens da thread
- decisoes da thread
- timeline consolidada

### `GET /admin/decisions`

Lista decisoes com filtros por periodo, `candidate_id` e `abstain`.

### `GET /admin/stats`

Retorna estatisticas agregadas do periodo.

### `GET /admin/export/messages`

Exige `admin`. Exporta mensagens em `application/x-ndjson`.

### `GET /admin/export/decisions`

Exige `admin`. Exporta decisoes em `application/x-ndjson`.

### `GET /admin/users`

Exige `admin`. Lista usuarios.

### `POST /admin/users`

Exige `admin`. Cria usuario com papel `admin` ou `curator`.

Body:

```json
{
  "email": "curador@empresa.com",
  "name": "Curador",
  "role": "curator",
  "password": "SenhaInicial123"
}
```

### `POST /admin/users/:id/reset-password`

Exige `admin`. Reseta a senha de um usuario.

Body:

```json
{
  "newPassword": "NovaSenha123"
}
```

## Modelos de dados

### `Message`

Campos:

- `_id`
- `threadId`
- `role` em `user|assistant`
- `content`
- `createdAt`

Indices:

- `{ threadId: 1, createdAt: 1 }`
- indice text em `content`

### `Decision`

Campos:

- `_id`
- `threadId`
- `openaiThreadId`
- `decision`
- `createdAt`

Indice:

- `{ threadId: 1, createdAt: -1 }`

### `ThreadMap`

Campos:

- `threadId`
- `openaiThreadId`
- `createdAt`

### `User`

Campos:

- `email`
- `name`
- `passwordHash`
- `role` em `admin|curator`
- `createdAt`

## Roteamento e integracao externa

O projeto contem um catalogo simples de candidatos e filas internas.

Esses candidatos sao traduzidos para filas de atendimento em `src/domain/RoutingCatalog.js`.

Quando o assistant chama a funcao `emit_routing`, o backend:

1. le os argumentos da tool call
2. monta a decisao normalizada
3. devolve o resultado como `tool_output`
4. persiste a decisao localmente

## Logs e debug

Logs normais:

- inicializacao do servidor
- erros de `/assist/reply`
- erros de `/assist/stream`

Logs opcionais:

- `DEBUG_RUN=true`: estados de runs e submits de tool outputs
- `DEBUG_SSE=true`: eventos SSE, decisoes e fallback de texto

Exemplo:

```bash
DEBUG_RUN=true DEBUG_SSE=true npm start
```

## Operacao em EC2 / proxy reverso

Pontos importantes para deploy:

- a app escuta em `PORT`, por padrao `8080`
- o healthcheck HTTP e `GET /health`
- o chat usa SSE em `/assist/stream`; gateways e proxies precisam suportar conexoes longas/streaming
- se `NODE_ENV=production`, o cookie de sessao usa `Secure`, entao o acesso deve passar por HTTPS
- se o balanceador terminar TLS e encaminhar HTTP para a app, verifique se o navegador ainda recebe o cookie de sessao corretamente

## Limites e observacoes

- o `README` anterior descrevia rotas `/reply`, `/messages` e `/threads/:threadId` que nao existem mais no codigo atual
- `OPENAI_MODEL` aparece em arquivos de exemplo, mas nao participa do fluxo atual
- nao existem testes automatizados configurados neste repositório

## Exemplos de verificacao rapida

### Health

```bash
curl http://localhost:8080/health
```

### Criar primeiro usuario

```bash
curl -X POST http://localhost:8080/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@empresa.com\",\"password\":\"SenhaForte123\"}"
```

### Login

```bash
curl -i -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@empresa.com\",\"password\":\"SenhaForte123\"}"
```

### Resposta JSON do assistant

```bash
curl -X POST http://localhost:8080/assist/reply \
  -H "Content-Type: application/json" \
  -d "{\"threadId\":\"demo\",\"latestUserInput\":\"Ola\"}"
```

### Streaming SSE

```bash
curl -N "http://localhost:8080/assist/stream?threadId=demo&latestUserInput=Ola"
```
