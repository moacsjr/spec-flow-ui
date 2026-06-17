# Epic View

Aplicação React (Vite + TypeScript) que implementa a tela **Epic View** descrita em
[`rfc/rfc-epic-view.md`](../rfc/rfc-epic-view.md). Os dados vêm de **GitHub Issues**,
estruturadas conforme o RFC-001 do projeto [`spec-flow`](../../spec-flow)
(`rfc/rfc-integrate-spec-kit-into-kanban.md`).

## Como rodar

```bash
npm install
npm run dev      # http://localhost:5173
```

Sem variáveis de ambiente, o app renderiza um **fixture local** (`src/data/fixture.ts`)
com o épico de exemplo "CHK-204 — Reformulação do fluxo de Checkout".

### Conectar a um Epic real do GitHub

Copie `.env.example` para `.env` e preencha:

```env
VITE_GITHUB_TOKEN=ghp_...
VITE_GITHUB_REPO=owner/repo
VITE_GITHUB_EPIC_ISSUE=204
```

O app busca a issue do Epic e suas sub-issues via GraphQL e renderiza ao vivo.

```bash
npm run build      # gera dist/
npm run typecheck  # checagem de tipos sem emitir
```

## Mapeamento GitHub → Epic View

Toda a tradução vive em [`src/github/adapter.ts`](src/github/adapter.ts). A hierarquia
do RFC-001 (`Epic → Feature → Story → Task`) alimenta o modelo da tela:

| Campo da tela | Origem na issue do GitHub |
|---|---|
| Epic (título, descrição) | Issue com label `[EPIC]` — título sem prefixo, corpo = MDX |
| `code` (`CHK-204`) | Acrônimo do time (3 letras) + número da issue |
| `team` | Label `team:*` → milestone → `VITE_GITHUB_TEAM` |
| `status` | Coluna de Status do GitHub Project (emoji removido) ou estado da issue |
| `priority` | Label `P0`–`P3` → Crítica / Alta / Média / Baixa |
| `dates` | `createdAt` da issue → `dueOn` do milestone |
| `owner` | Primeiro `assignee` da issue |
| Features | Sub-issues `[FEATURE]` do Epic |
| Feature `pct` / tasks | Tasks (folhas) fechadas ÷ total, recursivo pelas Stories |
| Feature `status` | Derivado do `pct`: `100%`→done, `>0`→prog, `0`→todo |
| Feature `tags` | Labels de Area (`Frontend`…), Release (`v2.0`) e `tag:*` |
| Feature `assignee` | Primeiro `assignee` da sub-issue |

Valores derivados (`epicPct`, legenda, mapa de status) seguem a seção 5 do RFC e
ficam em [`src/lib/status.ts`](src/lib/status.ts).

## Estrutura

```
src/
├── types.ts              Modelo de domínio (Epic, Feature, Status) — RFC seção 5
├── github/
│   ├── types.ts          Formas cruas da GitHub Issues API
│   ├── adapter.ts        GitHub → modelo de domínio
│   └── client.ts         Busca ao vivo via GraphQL (sub-issues)
├── data/
│   ├── fixture.ts        Payload de exemplo (forma da API do GitHub)
│   └── source.ts         Seleciona GitHub ao vivo ou fixture
├── lib/                  status / avatar / date
├── components/           TopBar, Hero, ProgressPanel, Description, Mdx,
│                         FeaturesPanel, FeatureCard, Avatar, ProgressBar, LoadingState
└── styles/
    ├── tokens.css        Design tokens — RFC seção 2.1 (--accent é o único token de marca)
    └── app.css           Layout e componentes — RFC seções 3 e 4
```

## Fidelidade ao design

- Tokens de cor, tipografia (Space Grotesk / Manrope / JetBrains Mono) e espaçamentos
  seguem a seção 2 do RFC.
- A descrição é renderizada com `react-markdown` + `remark-gfm` e o mapa de elementos
  da seção 4.4 (parágrafos, `h3`, listas com marcador `›`, callouts, checklist de
  critérios de aceite, blocos de código).
- Estados de loading e vazio conforme a seção 6; barras de progresso com
  `role="progressbar"` (seção 7).
