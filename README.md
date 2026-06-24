# spec-flow-ui

App fullstack do spec-flow. Monorepo npm workspaces com três pacotes:

| Pacote     | O que é                                                                 |
|------------|-------------------------------------------------------------------------|
| `client/`  | Frontend React + Vite — **só exibição**. Busca JSON pronto do backend.   |
| `server/`  | Backend Express + Knex + SQLite — **dono de toda integração com o GitHub** (GraphQL + Contents API) e da API REST. |
| `shared/`  | Tipos TypeScript compartilhados (contrato de exibição). Sem build.       |

O token do GitHub vive **apenas no backend** (`GITHUB_TOKEN`) e nunca é embutido
no bundle do navegador. O frontend conhece só os endpoints `/api/*`.

## Pré-requisitos

- Node.js 20.6+ (usa `--env-file`; testado no Node 24).
- Um token do GitHub com leitura de issues e a API de sub-issues habilitada.

## Configuração

```bash
npm install                      # instala os 3 workspaces de uma vez
cp server/.env.example server/.env
# edite server/.env: GITHUB_TOKEN, GITHUB_REPO, GITHUB_EPIC_ISSUE
```

Sem `GITHUB_*` configurado, `GET /api/workitems/...` responde **503** (não há
fixture de fallback). O Dashboard (`/api/repositories`, SQLite) funciona sem token.

## Desenvolvimento

```bash
npm run dev      # sobe server (3001) e client (5173) juntos; Vite faz proxy de /api
```

Abra http://localhost:5173 → `#/dashboard`.

## Produção (processo único)

```bash
npm run build    # gera client/dist
npm start        # Express serve a API + o build do frontend (mesma origem)
```

Abra http://localhost:3001.

## Endpoints

| Método | Rota                              | Descrição                                  |
|--------|-----------------------------------|--------------------------------------------|
| GET    | `/api/workitems/:level/:number`   | `WorkItemView` (epic/feature/story) do GitHub |
| GET    | `/api/repositories`               | Repositórios conectados (SQLite)           |
| GET    | `/status`                         | Health check                               |

`:level/:number` inválido → 400; issue inexistente → 404; erro do GitHub → 502;
GitHub não configurado → 503.

## Scripts (raiz)

- `npm run dev` — server + client em paralelo.
- `npm run build` — build do frontend.
- `npm start` — produção, processo único (`SERVE_STATIC=true`).
- `npm run typecheck` — checa os três workspaces.
