# Spec-Flow Views

Aplicação React (Vite + TypeScript) que implementa três telas de leitura do fluxo
spec-flow, todas com o mesmo layout descrito em
[`rfc/rfc-epic-view.md`](../rfc/rfc-epic-view.md):

- **Epic View** — um épico e suas Features.
- **Feature View** — uma feature, com Descrição em abas **Spec | Plan** e suas Stories.
- **Story View** — uma story e suas Tasks (cards-folha).

Os dados vêm de **GitHub Issues**, estruturadas conforme o RFC-001 do projeto
[`spec-flow`](../../spec-flow) (`Epic → Feature → Story → Task`).

## Como rodar

```bash
npm install
npm run dev      # http://localhost:5173
```

Sem variáveis de ambiente, o app renderiza um **fixture local** (`src/data/fixture.ts`)
com o épico de exemplo "CHK-204 — Reformulação do fluxo de Checkout".

### Navegação (router de hash)

As três telas são rotas de hash; navegar é drill-down (cards descem, breadcrumb sobe):

```
#/epic/204      → Epic View   (cards de Feature clicáveis)
#/feature/220   → Feature View (cards de Story clicáveis)
#/story/221     → Story View  (cards de Task — folhas, sem link)
```

### Conectar a issues reais do GitHub

Copie `.env.example` para `.env` e preencha:

```env
VITE_GITHUB_TOKEN=ghp_...
VITE_GITHUB_REPO=owner/repo
VITE_GITHUB_EPIC_ISSUE=204   # habilita o modo live; o número da rota tem precedência
```

Com config presente, o app busca a issue da rota e suas sub-issues via GraphQL. Na
Feature View, busca também `docs/features/<slug>/plan.md` (Contents API) para a aba Plan.

```bash
npm run build      # gera dist/
npm run typecheck  # checagem de tipos sem emitir
```

## Mapeamento GitHub → tela

Toda a tradução vive em [`src/github/adapter.ts`](src/github/adapter.ts)
(`adaptEpic` / `adaptFeature` / `adaptStory`), reusando os mesmos helpers genéricos:

| Campo da tela | Origem na issue do GitHub |
|---|---|
| Título / Descrição (Spec) | Título sem prefixo `[TIPO]`; corpo da issue = MDX |
| Plan (só Feature) | `docs/features/<slug>/plan.md` no repo (slug via `slugify`) |
| `code` (`CHK-220`) | Acrônimo do time (3 letras) + número da issue |
| `team` | Label `team:*` → milestone → `VITE_GITHUB_TEAM` |
| Epic `status` | Coluna de Status do Project; Feature/Story derivam do próprio `pct` |
| `priority` | Label `P0`–`P3` → Crítica / Alta / Média / Baixa |
| `owner` / `assignee` | Primeiro `assignee` da issue |
| Filhos (cards) | Sub-issues: Features (no Epic), Stories (na Feature), Tasks (na Story) |
| `pct` / tasks | Tasks (folhas) fechadas ÷ total, recursivo pela subárvore |
| `status` do filho | Derivado do `pct`: `100%`→done, `>0`→prog, `0`→todo |
| `tags` | Labels de Area (`Frontend`…), Release (`v2.0`) e `tag:*` |

**Progresso do cabeçalho:** Epic = média dos % das Features (regra da RFC, `meanPct`);
Feature/Story = ponderado por Tasks (`countTasks` na raiz) — assim o % bate com o que
aquele item mostra como card na tela acima.

## Estrutura

```
src/
├── types.ts              WorkItemView, ChildItem, MetaField, Crumb, Status, Level
├── github/
│   ├── types.ts          Formas cruas da GitHub Issues API
│   ├── adapter.ts        GitHub → WorkItemView (adaptEpic/Feature/Story)
│   └── client.ts         GraphQL (sub-issues) + Contents API (plan.md)
├── data/
│   ├── fixture.ts        Payload de exemplo + fixturePlans (plan.md offline)
│   └── source.ts         loadWorkItem(level, number): live ou fixture fatiado
├── lib/                  status / avatar / date / router / slugify
├── components/           TopBar, Hero, ProgressPanel, Description (abas), Mdx,
│                         ItemsPanel, ItemCard (com modo folha), Avatar,
│                         ProgressBar, LoadingState
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
- Cards de Task (Story View) são folhas: checkbox + badge de status, sem barra nem
  contagem. Estados de loading e vazio conforme a seção 6; barras com
  `role="progressbar"` (seção 7).

## Limitações conhecidas (modo live)

- **Pai no breadcrumb:** um fetch de issue única não traz o pai pela API de
  sub-issues; o up-link é resolvido best-effort a partir do corpo
  (`_… pai: <url>_`, convenção do spec-flow) ou fica sem link. Drill-down para baixo
  é sempre confiável.
- **Story → Task por texto no corpo:** o `decompose` do spec-flow liga Task à Story
  por texto no corpo, não pela API de sub-issues. Em repositórios reais a Story View
  pode vir sem Tasks até que a ligação seja feita por sub-issues. O fixture já usa
  sub-issues e não tem essa limitação.
- **`plan.md` ausente:** 404 na Contents API → a aba Plan não aparece.
