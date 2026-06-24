# server

Backend Express + Knex + SQLite (`better-sqlite3`). **Dono de toda a integração
com o GitHub** (GraphQL de sub-issues + Contents API para `plan.md`) e da API REST
consumida pelo frontend `client`. O token vive só aqui (`GITHUB_TOKEN`).

## Endpoints

| Método | Rota                             | Descrição                                       |
|--------|----------------------------------|-------------------------------------------------|
| GET    | `/api/workitems/:level/:number`  | `WorkItemView` (epic/feature/story) do GitHub   |
| GET    | `/api/repositories`              | Lista repositórios (até 50, recentes 1º)        |
| GET    | `/status`                        | Health check (`{ status: "ok", uptime }`)       |

`workitems`: nível/número inválido → 400; não encontrado → 404; erro do GitHub →
502; `GITHUB_*` ausente → 503 (sem fixture de fallback).

Schema de `GET /api/repositories`:

```json
[{ "id": 1, "name": "Meu Repositório", "url": "https://github.com/user/repo", "createdAt": "2024-05-12T14:30:00.000Z" }]
```

## Rodando

```bash
cd server
npm install
cp .env.example .env      # opcional; defaults servem para dev
npm run dev               # migra + faz seed + sobe na porta 3001
```

O frontend (`epic-view`, porta 5173) faz proxy de `/api` para esta porta — veja `epic-view/vite.config.ts`.

## Scripts

- `npm run dev` — sobe com hot-reload (aplica migrações e seed no boot).
- `npm run migrate` — aplica migrações pendentes.
- `npm run seed` — popula dados de exemplo (idempotente).
- `npm run backup` — copia `data/database.db` para `backups/database-<data>.db`.
- `npm run typecheck` — checagem de tipos.

## Backup diário

`npm run backup` gera uma cópia datada. Para automatizar, agende via cron:

```cron
0 3 * * *  cd /caminho/para/server && npm run backup
```

## Segurança

- Queries parametrizadas (Knex) — prevenção de SQL injection.
- `helmet`, CORS restrito à origem do frontend, `express-rate-limit`.
- URLs validadas por regex (`src/lib/validation.ts`); segredos só via env.
