# Plan.md — Página de Changelog do Produto

## Contexto do Plano
> Feature de teste do pipeline spec-wave v0.7.1. Este plano assume decisões técnicas para os itens marcados `[TODO: requer esclarecimento do PO]` no spec.md, de forma a viabilizar a implementação com a stack disponível. Essas decisões estão sinalizadas com **[ASSUMPTION]** e devem ser revalidadas com o PO antes do merge final.

---

# Estratégia Técnica

## Abordagem Arquitetural

A feature será implementada como um módulo isolado e somente leitura, aproveitando a arquitetura monorepo existente (`client` / `server` / `shared`):

- **Fonte da verdade:** arquivo `CHANGELOG.md` versionado na raiz do repositório do produto (Regra de Negócio 2). **[ASSUMPTION]** formato Markdown, seguindo convenção *Keep a Changelog* (`## [versão] - data` + lista de itens), resolvendo o TODO da Regra 5.
- **Leitura do arquivo:** feita exclusivamente pelo **backend** via `fs.readFileSync` (Node.js), nunca pelo frontend diretamente — mantendo o padrão arquitetural já existente ("TODA integração de dados vive no backend; o frontend só consome JSON da API `/api/*`").
- **Sem persistência em banco:** conforme Regra de Negócio 2, nenhuma tabela SQLite/Knex é criada. A leitura é feita on-demand com cache em memória (TTL curto) para atender ao NFR de performance (<1s).
- **Atualização do conteúdo:** **[ASSUMPTION]** exclusivamente via commit/deploy no repositório (Regra 6) — não haverá nenhuma interface administrativa de edição.
- **Acesso à página:** **[ASSUMPTION]** pública dentro do app, sem exigência de autenticação adicional, coerente com `auth_protocol` do tech_context ("Sem autenticação de usuário no app"). O cenário Gherkin que menciona "usuário autenticado" será satisfeito trivialmente, pois não há controle de acesso a violar.
- **Renderização:** o backend expõe o conteúdo bruto (raw) do Markdown; o frontend usa `react-markdown` + `remark-gfm` (já presentes na stack) para renderizar — atendendo à regra "apenas formatação de exibição é permitida, sem transformação de conteúdo de negócio".
- **Nenhuma coleta de dados:** rota `GET /api/changelog` não recebe nem registra identificadores de usuário; nenhum script de analytics/cookie é incluído na página.

## Decisões-Chave

| Decisão | Justificativa |
|---|---|
| Arquivo `CHANGELOG.md` lido via filesystem no backend, não via GitHub Contents API | O changelog é do próprio produto (não de repositórios de terceiros geridos pela ferramenta); leitura local é mais simples, rápida e sem dependência de rede/token GitHub |
| Endpoint expõe Markdown bruto (`content: string`), sem parsing estrutural em JSON | Evita transformação de conteúdo de negócio (Regra 4); delega apenas formatação visual ao `react-markdown` |
| Cache em memória com TTL de 60s no backend | Atende NFR de performance (<1s) sem necessidade de CDN/infra adicional (resolve parcialmente TODO da dependência externa) |
| Nenhum endpoint de escrita (`POST`/`PUT`/`DELETE`) para changelog | Garante somente-leitura (Regra 1, Cenário Gherkin 3) por ausência física de rota, não apenas por ocultação de UI |
| Sem middleware de tracking/analytics na rota e página | Atende requisito de minimização de dados (Regra 3, Cenário Gherkin 4) |

## Matriz de Rastreabilidade

| Critério de Aceite (Gherkin) | Componente Técnico |
|---|---|
| Usuário acessa a página com sucesso; versões em ordem decrescente com número, data e itens | `GET /api/changelog` (server/src/routes/changelogRoutes.ts) + `ChangelogPage.tsx` (client) + `CHANGELOG.md` |
| Changelog vazio → mensagem amigável | `changelogService.ts` (detecção de `content.trim() === ''`) + `EmptyState.tsx` |
| Usuário tenta editar/excluir/comentar → nenhum controle disponível | Ausência de rotas `POST/PUT/DELETE /api/changelog`; `ChangelogPage.tsx` não renderiza nenhum botão de ação |
| Nenhum dado do usuário é coletado | Ausência de scripts de analytics/cookies; rota `GET /api/changelog` sem parâmetros de identidade; logger sem PII (`server/src/lib/logger.ts`) |
| Arquivo ausente/corrompido → erro amigável, sem detalhes técnicos | `changelogService.ts` (try/catch ENOENT) + `ErrorState.tsx` + resposta `404`/`500` com DTO padronizado |
| Conteúdo exibido = arquivo exato | `GET /api/changelog` retorna raw Markdown sem transformação + `react-markdown`/`remark-gfm` no client |

---

# Detalhamento da Implementação

## Backend

### Novo arquivo estático
- `CHANGELOG.md` na raiz do repositório (fora de `client/`, `server/`, `shared/`).
- Formato: `## [x.y.z] - YYYY-MM-DD` seguido de lista `- item`.
- Caminho configurável via variável de ambiente `CHANGELOG_FILE_PATH` (default: `../CHANGELOG.md` relativo a `server/`). **[Ref: Regra 5]**

### Serviço
- **Arquivo:** `server/src/services/changelogService.ts`
- **Função:** `getChangelogContent(): Promise<ChangelogResponseDTO>`
  - Lê o arquivo via `fs.promises.readFile(CHANGELOG_FILE_PATH, 'utf-8')`.
  - Cache em memória (`{ content, cachedAt }`) com TTL de 60s (constante `CHANGELOG_CACHE_TTL_MS = 60_000`) — atende NFR de performance. **[Ref: Cenário "Conteúdo exibido corresponde exatamente"]**
  - Se `content.trim() === ''` → retorna `{ content: '', isEmpty: true }`. **[Ref: Cenário "Changelog está vazio"]**
  - Em caso de `ENOENT` ou erro de leitura → lança `ChangelogNotFoundError` (via `server/src/lib/errors.ts`), logado internamente via `winston` **sem dados de usuário**. **[Ref: Cenário "Arquivo ausente ou corrompido"]**

### Rota
- **Arquivo:** `server/src/routes/changelogRoutes.ts`
- **Endpoint:** `GET /api/changelog`
  - **Sem autenticação** (consistente com `auth_protocol` do sistema). **[Ref: Cenário "Usuário autenticado" — acesso não bloqueado]**
  - **Sem parâmetros de query/body de identidade.** **[Ref: Cenário "Nenhum dado do usuário é coletado"]**
  - Respostas:
    - `200 OK` → `{ content: string; isEmpty: boolean }`
    - `404 Not Found` → `{ error: "CHANGELOG_NOT_FOUND", message: "Não foi possível carregar o changelog neste momento." }`
    - `500 Internal Server Error` → `{ error: "CHANGELOG_READ_ERROR", message: "Não foi possível carregar o changelog neste momento." }`
  - Registrada em `server/src/app.ts` junto às demais rotas `/api/*`.
  - Herda automaticamente `helmet`, `cors` (restrito a `CORS_ORIGIN`) e `express-rate-limit` (120 req/min) já configurados globalmente. **[Ref: NFR Segurança]**
  - **Nenhum verbo de escrita é exposto** (`POST`/`PUT`/`DELETE` inexistentes para este recurso). **[Ref: Cenário "Usuário tenta editar"]**

### Contrato compartilhado
- **Arquivo:** `packages/shared/src/types/changelog.ts` (pacote `@spec-flow/shared`)
```ts
export interface ChangelogResponseDTO {
  content: string;
  isEmpty: boolean;
}

export interface ChangelogErrorDTO {
  error: 'CHANGELOG_NOT_FOUND' | 'CHANGELOG_READ_ERROR';
  message: string;
}
```

## Banco de Dados

- **Nenhuma migration é necessária.** Conforme Regra de Negócio 2 do spec.md ("sem uso de banco de dados"), o changelog não passa pela camada SQLite/Knex.
- A tabela `repositories` existente **não é utilizada nem alterada** por esta feature.
- Justificativa registrada explicitamente para rastreabilidade: ausência de schema é uma decisão técnica ligada diretamente à Regra 2 do spec.

## Frontend

### Estrutura de arquivos
- `client/src/features/changelog/ChangelogPage.tsx` — página principal.
- `client/src/features/changelog/api.ts` — `fetchChangelog(): Promise<ChangelogResponseDTO>` (usa `fetch('/api/changelog')`).
- `client/src/features/changelog/components/LoadingState.tsx` — estado de carregamento. **[Ref: Cenário Erro E3 do spec]**
- `client/src/features/changelog/components/EmptyState.tsx` — mensagem "Ainda não há novidades registradas." **[Ref: Cenário "Changelog está vazio"]**
- `client/src/features/changelog/components/ErrorState.tsx` — mensagem "Não fo