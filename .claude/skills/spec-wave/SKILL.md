---
name: spec-wave
description: "Use when the user wants to set up a spec-driven GitHub workflow, create a Feature issue, generate spec.md or plan.md, decompose a Feature into Stories/Tasks, write RFC documentation, or audit and fix a Pull Request. Implements the RFC-001 workflow with GitHub Projects v2, labels, and AI-powered GitHub Actions."
argument-hint: "[info|setup|update|issue|feature|spec|plan|ready|decompose|implement|uninstall|rfc|fix-pr] [target]"
user-invocable: true
allowed-tools:
  - Bash(npx @spec-wave/cli *)
  - Bash(gh issue *)
  - Bash(gh project *)
  - Bash(gh repo view *)
  - Bash(gh auth status)
  - Bash(gh pr *)
  - Bash(gh api *)
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git push *)
  - Bash(git checkout *)
  - Read
  - Edit
  - Write
  - Agent
---

> ⚙️ **spec-wave skill v0.5.11** — esta skill é uma cópia estática. Se `npx @spec-wave/cli --version` indicar uma versão maior, ela está desatualizada: rode `npx @spec-wave/cli update` (atualiza só o que mudou) ou `npx @spec-wave/cli install-skill --force` (só a skill).

# spec-wave Skill

Este skill guia o usuário pelo fluxo spec-driven definido no RFC-001.

> **Antes de responder a qualquer sub-comando**, leia o arquivo `rfc/rfc-integrate-spec-kit-into-kanban.md` se ele existir no diretório atual, para embasar suas respostas no processo real da equipe.

> **Verifique se esta skill está atualizada:** logo no topo deste arquivo há um banner `spec-wave skill vX.Y.Z` (inserido na instalação). Compare com `npx @spec-wave/cli --version`. Se a CLI for **mais recente** (ou o banner estiver ausente = instalada por versão antiga), esta skill está desatualizada — avise o usuário e sugira `npx @spec-wave/cli update` (detecta e atualiza só o que mudou: skill, `.spec-wave.json` e workflows/labels do repo) ou, para atualizar só a skill, `npx @spec-wave/cli install-skill --force`. A skill é uma cópia estática e **não** acompanha o `npx` sozinha.

---

## Detecção de configuração (faça isto primeiro, sempre)

Antes de qualquer sub-comando, leia o arquivo `.spec-wave.json` na raiz do repositório atual (use o tool Read). Esse arquivo é gravado pelo `npx @spec-wave/cli init` e é a fonte de estado persistente entre sessões.

- **Se existir**, o spec-wave já foi configurado. Use seus campos para contextualizar as respostas, sem perguntar de novo:
  - `owner`/`repo` → repositório alvo dos comandos `gh`
  - `project.url` / `project.title` → o GitHub Project a referenciar
  - `version` → versão da CLI usada no `init` (compare com `npx @spec-wave/cli --version`; se divergir, sugira `npx @spec-wave/cli refresh --config` para atualizar o arquivo, ou re-rodar o `init` para atualizar workflows/labels)
  - `initializedAt` → quando foi configurado
  Não rode `/spec-wave setup` de novo a menos que o usuário peça explicitamente.
- **Se não existir**, o repositório provavelmente ainda não foi configurado. Sugira começar por `/spec-wave setup`.

Exemplo de `.spec-wave.json`:
```json
{
  "version": "0.1.0",
  "owner": "acme",
  "repo": "loja",
  "project": {
    "title": "loja — Spec Wave",
    "url": "https://github.com/users/acme/projects/5",
    "id": "PVT_..."
  },
  "initializedAt": "2026-06-18T13:40:00.000Z"
}
```

---

## Regra fundamental

**Nunca gere `spec.md` ou `plan.md` diretamente.** Sempre acione a label correspondente e deixe o GitHub Action gerar o arquivo. Isso garante que o arquivo seja commitado no repositório e referenciado na issue.

Exceção: se o usuário pedir explicitamente para revisar ou melhorar um documento já gerado, use o Write tool para editar o arquivo local.

---

## Fluxo Kanban

```
📥 Backlog → 🎯 Priorizado → 📋 Spec → 📋 Plan → ✅ Ready
→ 📋 Backlog Técnico → 🚧 Desenvolvimento → 👀 Code Review
→ 🧪 QA → 📋 Homologação → 🚀 Deploy → 🎉 Done
```

Labels de gatilho:
- `spec-wave:spec` → dispara `generate-spec.yml` → gera `spec.md` (especificação funcional, primeiro)
- `spec-wave:plan` → dispara `generate-plan.yml` → gera `plan.md` (plano técnico, a partir da spec)
- `spec-wave:ready` → dispara `validate.yml` → valida ambos os arquivos
- `spec-wave:decompose` → dispara `decompose.yml` → gera Stories e Tasks

A etapa **🚧 Desenvolvimento** é coberta pelo comando **local** `npx @spec-wave/cli implement <número>` (não é uma label/Action): lê uma Story ou Task e aciona o spec-kit para implementar. Veja `/spec-wave implement`.

---

## Referência da CLI (conheça os parâmetros ANTES de executar)

Esta skill é um **wrapper** da CLI `@spec-wave/cli`, sempre invocada como `npx @spec-wave/cli <comando>`. Regra de ouro: **nunca rode um comando sem os parâmetros que ele aceita** esperando que ele pergunte — colete os valores com o usuário e passe via flags. Em especial, **`init` sem `--repo` abre um wizard interativo (@clack/prompts) que a skill NÃO consegue dirigir** — sempre passe `--repo`.

### `@spec-wave/cli init` — configura o repositório
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--repo <owner/repo>` | string | Repositório alvo. **Passe SEMPRE** para evitar o wizard interativo. |
| `--project-title <title>` | string | Nome do GitHub Project. Padrão: `<repo> — Spec Wave`. |
| `--skip-project` | flag | Pula a criação do Project (use ao re-rodar se já existe). |
| `--skip-labels` | flag | Pula a criação das labels. |
| `--skip-files` | flag | Pula a criação dos workflows + issue templates. |
| `--dry-run` | flag | Simula a configuração sem alterar nada. |

### `@spec-wave/cli issue` — cria um work item tipado, opcionalmente como sub-issue, e adiciona ao board
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--title <title>` | string (obrigatório) | Título, **sem** o prefixo de tipo (a CLI adiciona, ex.: `[STORY]`). |
| `--type <type>` | string | `initiative`, `epic`, `feature`, `story`, `task`, `bug`, `spike` ou `rfc`. Default: `feature`. |
| `--parent <n>` | string | Número da issue pai — cria como **sub-issue** dela (relação nativa do GitHub). |
| `--body <text>` | string | Descrição. |
| `--priority <p>` | string | **Opcional.** `P0`, `P1`, `P2` ou `P3`. Omita se o usuário não pediu — a prioridade fica `null` (sem prioridade). Nunca atribua por conta própria. |
| `--area <area>` | string | `Frontend`, `Backend`, `Mobile`, `Infra`, `DevOps` ou `Data`. |

> Faz tudo: cria a issue (label de tipo — e de prioridade **apenas se `--priority` for informado**), vincula ao parent como sub-issue, adiciona ao Project e define os campos **Etapa = 📥 Backlog**, **Work Item Type**, **Area** e, **só se informada, Priority**. Grava `Parent: #N` no corpo. Lê o Project do `.spec-wave.json`. **Não use `gh issue create` direto** — ele não adiciona ao board nem vincula o parent.

### `@spec-wave/cli initiative` — atalho de `issue --type initiative`
Cria o nó raiz da hierarquia (agrupa Epics). Mesmas flags do `issue` exceto `--type` (fixo em `initiative`) e `--parent` (Initiative é raiz, não tem pai).

### `@spec-wave/cli feature` — atalho de `issue --type feature`
Mesmas flags do `issue` (exceto `--type`, fixo em `feature`). Mantido para o fluxo do RFC-001.

### `@spec-wave/cli uninstall` — remove a configuração (mantém o Project)
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--repo <owner/repo>` | string | Repositório (default: lê do `.spec-wave.json`). |
| `--skip-labels` | flag | Não remove as labels. |
| `--skip-files` | flag | Não remove os arquivos `.github`. |
| `--keep-config` | flag | Mantém o `.spec-wave.json` local. |
| `--dry-run` | flag | Mostra o que seria removido sem alterar nada. |
| `--yes` | flag | Não pede confirmação. |

> Remove labels + arquivos `.github` + `.spec-wave.json`. **NUNCA apaga o GitHub Project** (preserva o histórico do board) — o usuário deve excluí-lo manualmente se quiser.

### `@spec-wave/cli info` — status de configuração do repo atual
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--json` | flag | Saída JSON (`{"initialized":bool, ...}`) para parsing programático. |

### `@spec-wave/cli refresh` — atualiza o `.spec-wave.json` local
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--config` | flag | Re-consulta o GitHub Project e reescreve o `.spec-wave.json` (IDs do campo Etapa, opções, number, versão da CLI). |

> Use quando o `.spec-wave.json` estiver desatualizado: repos inicializados por uma versão antiga (sem `etapaFieldId`/`stageOptions`), Project renomeado, ou versão da CLI divergente. Escreve no arquivo **local** — faça commit depois.

### `@spec-wave/cli update` — atualiza tudo que ficou para trás (só o que mudou)
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--global` | flag | Verifica a skill no escopo do usuário (padrão: projeto). |
| `--skip-skill` / `--skip-config` / `--skip-repo` | flag | Pula a categoria correspondente. |
| `--dry-run` | flag | Mostra o que seria atualizado sem alterar nada. |
| `--yes` | flag | Aplica sem pedir confirmação. |

> Detecta e atualiza **somente o que divergiu** da versão atual da CLI: a **skill** instalada (por agente), o **`.spec-wave.json`** local (se versão/formato divergir) e os **workflows/labels** do repo (compara com os templates empacotados). Interativo por padrão (mostra o plano e confirma). É o atalho recomendado após atualizar a CLI.

### `@spec-wave/cli generate-plan` · `generate-spec` · `validate` · `decompose`
| Flag | Tipo | Descrição |
|------|------|-----------|
| `--issue-number <n>` | string (obrigatório) | Número da issue no GitHub. |

> ⚠️ Esses quatro comandos são executados pelos **GitHub Actions** (disparados por labels), **não** pela skill diretamente. Veja a *Regra fundamental*: para gerar plan/spec/decompor, adicione a **label** correspondente — não rode o comando à mão (a não ser para debug local).

### `@spec-wave/cli implement` — aciona o spec-kit para uma Story ou Task (comando LOCAL)
| Flag/Arg | Tipo | Descrição |
|----------|------|-----------|
| `<issue>` | string (obrigatório) | Número da issue (Story ou Task), ex.: `12` ou `#12`. Argumento posicional. |
| `--feature-dir <path>` | string | Caminho `docs/features/<slug>` para anexar `spec.md`/`plan.md` como contexto (sobrescreve a resolução automática). |
| `--dry-run` | flag | Monta o contexto e imprime o comando do spec-kit **sem executar**. |

> Diferente dos quatro acima, `implement` roda **localmente** (lê `.spec-wave.json`, como `issue`), não por Action. Detecta o tipo da issue: **Story** → coleta todas as Tasks (sub-issues) e aciona o spec-kit uma única vez; **Task** → só aquela task. Monta o contexto em `.spec-wave/implement-<n>.md` e chama o comando configurado em `specKit.command` (no `.spec-wave.json`) ou na env `SPEC_WAVE_IMPLEMENT_CMD`. Placeholders disponíveis no template: `{tasksFile} {specFile} {planFile} {issue} {type} {title}`. Se nada estiver configurado, ele apenas monta o contexto e mostra como configurar (não executa). O contexto inclui instruções para o agente implementar as Tasks **sequencialmente, uma por vez**, usando o campo **Status** (Todo → In Progress → Done) para o progresso *dentro* da Etapa 🚧 Desenvolvimento — sem trocar a Etapa das tasks (nunca duas com Status "In Progress" ao mesmo tempo). **Ao concluir toda a Story**: fazer o commit, abrir o PR e **avançar a Etapa** da **Story e de todas as suas Tasks** para **👀 Code Review** (Status → Todo). A **Feature só avança** para Code Review quando **TODAS as suas Stories** já estiverem em Code Review — enquanto houver Story pendente, a Feature fica em 🚧 Desenvolvimento. Etapa só avança (nunca volta); Status mede o progresso dentro da etapa.

---

## Sub-comandos

### `/spec-wave info`

Mostra se o repositório atual já foi configurado com o spec-wave.

**Passos:**
1. Execute: `npx @spec-wave/cli info`
2. **Se o repositório estiver inicializado**, o comando mostra os dados do `.spec-wave.json` (owner/repo, project, versão da CLI, data). Apresente essas informações ao usuário.
3. **Se NÃO estiver inicializado**, pergunte ao usuário: "Este repositório ainda não foi configurado com o spec-wave. Quer rodar o `init` agora?"
   - Se sim → siga o fluxo de `/spec-wave setup`.
   - Se não → encerre sem alterar nada.

---

### `/spec-wave update`

Traz tudo para a versão atual da CLI, atualizando **só o que mudou**: a skill instalada, o `.spec-wave.json` local e os workflows/labels do repo.

**Passos:**
1. **Sempre comece com `--dry-run`** para inspecionar o que está desatualizado sem alterar nada:
   ```bash
   npx @spec-wave/cli update --dry-run
   ```
2. Mostre ao usuário o resumo (skill / config / arquivos do repo / labels que divergiram). Se **nada** estiver desatualizado, informe que já está tudo na versão atual e encerre.
3. Se o usuário aprovar, aplique:
   ```bash
   npx @spec-wave/cli update --yes
   ```
   - Escopos podem ser limitados com `--skip-skill`, `--skip-config`, `--skip-repo`.
   - Atualizações de **arquivos do repo** são commitadas no remoto; o **`.spec-wave.json`** é local (lembre o usuário de commitá-lo).
4. Se a skill foi atualizada, oriente recarregar/reiniciar o agente para pegar a nova versão.

---

### `/spec-wave setup`

Configura o spec-wave no repositório. Você dirige o `init` com flags — **nunca rode `npx @spec-wave/cli init` sem `--repo`** (abre o wizard interativo que você não controla).

**Passos:**
1. **Já configurado?** Leia `.spec-wave.json` (ou rode `npx @spec-wave/cli info`). Se existir, avise (mostre `project.url` e `version`) e confirme com o usuário antes de reconfigurar.
2. **Descubra o repositório alvo** (parâmetro `--repo`): rode `gh repo view --json nameWithOwner -q .nameWithOwner` para obter `owner/repo` do repo atual. Confirme com o usuário; se não houver remote, pergunte o `owner/repo`.
3. **Pergunte o título do Project** (parâmetro `--project-title`). Ofereça o default `<repo> — Spec Wave` e aceite-o se o usuário não tiver preferência.
4. **Cheque o auth:** `gh auth status`. Se faltarem os escopos `project,repo,workflow`, oriente o usuário a rodar ele mesmo `gh auth refresh --scopes project,repo,workflow` (comando interativo — o usuário executa, não você).
5. **(Opcional) Pré-visualize** antes de aplicar: `npx @spec-wave/cli init --repo <owner/repo> --dry-run`.
6. **Execute com os parâmetros coletados:**
   ```bash
   npx @spec-wave/cli init --repo <owner/repo> --project-title "<título>"
   ```
   Use `--skip-project` / `--skip-labels` / `--skip-files` **apenas** para re-rodar uma fase específica que falhou antes.
7. O `init` cria o Project, as labels, os workflows, um **scaffold de `.github/config/tech_context.yml`** (só se ainda não existir) e grava `.spec-wave.json`. Oriente o usuário a fazer `git pull` para trazer os arquivos ao checkout local.
8. **Adapte o `tech_context.yml`**: o scaffold vem com dados de exemplo. Ofereça ajustá-lo à stack real do repo seguindo a seção **Tech Context** (perto do comando `/spec-wave plan`) — isso melhora muito a qualidade do `plan.md`.
9. Instrua o usuário a adicionar a chave de IA como secret no repositório (Settings → Secrets → Actions): `ANTHROPIC_API_KEY` (Anthropic) ou `OPENROUTER_API_KEY` (OpenRouter), conforme o provider escolhido no `init`.

---

### `/spec-wave issue <tipo> <descrição>` · `/spec-wave initiative <descrição>` · `/spec-wave feature <descrição>`

Crie um work item tipado (Initiative/Epic/Feature/Story/Task/...) já adicionado ao board em **📥 Backlog**, opcionalmente como sub-issue de um parent.

**Hierarquia típica:** Initiative → Epic → Feature → Story → Task. A **Initiative** é o nó raiz e agrupa Epics. Use `--parent <n>` para criar como sub-issue do nível acima (ex.: um Epic filho de uma Initiative, ou uma Story filha de uma Feature). O GitHub mostra o parent na issue filha e vice-versa; a CLI ainda grava `Parent: #N` no corpo.

**Passos:**
1. Pergunte ao usuário: tipo (initiative/epic/feature/story/task/...), título (sem prefixo), descrição e se há uma issue **pai** (número). **Prioridade e área são opcionais**: só as inclua se o usuário pedir explicitamente. **Nunca atribua uma prioridade por conta própria** — se o usuário não informou, **omita `--priority`** e a prioridade fica `null` (sem prioridade) no board.
2. Execute o comando com os parâmetros coletados (inclua **apenas** as flags que o usuário forneceu):
   ```bash
   npx @spec-wave/cli issue \
     --type "<tipo>" \
     --title "<título>" \
     --body "<descrição>" \
     --area "<área>" \            # opcional — omita se o usuário não informou
     --priority "<prioridade>" \  # opcional — só se o usuário pediu; caso contrário OMITA (prioridade fica null)
     --parent "<número-do-pai>"   # opcional
   ```
   Para Features, pode usar o atalho `npx @spec-wave/cli feature --title ...` (equivale a `--type feature`).
   A CLI cria a issue (label de tipo — e de prioridade **apenas se `--priority` for informado**), vincula como sub-issue do parent, adiciona ao Project e define Etapa = 📥 Backlog + Work Item Type + Area (+ Priority só se informada). **Não use `gh issue create`** (não adiciona ao board nem vincula o parent).
3. Informe o número criado e o vínculo com o pai (se houver).
4. Para Features: "Quando quiser iniciar, mova para **📋 Spec** e use `/spec-wave spec <número>` para gerar a especificação funcional (o plano técnico vem depois)".

---

### `/spec-wave uninstall`

Remove a configuração do spec-wave do repositório (labels, arquivos `.github`, `.spec-wave.json`). **Não apaga o GitHub Project.**

**Passos:**
1. Confirme com o usuário que ele quer remover (a ação remove labels e faz commits removendo os workflows).
2. Mostre antes o que será removido com `npx @spec-wave/cli uninstall --dry-run`.
3. Execute `npx @spec-wave/cli uninstall` (a CLI pede confirmação; use `--yes` só se o usuário já confirmou).
4. Lembre o usuário de excluir o **GitHub Project** manualmente, se desejar — a CLI não o apaga de propósito.

---

### `/spec-wave spec <número-da-issue>`

Inicia a geração da **especificação funcional** para uma Feature. É o **primeiro** passo do ciclo de documentos (antes do plano técnico).

**Passos:**
1. Adicione a label de gatilho:
   ```bash
   gh issue edit <número> --add-label "spec-wave:spec"
   ```
2. Informe: "Label `spec-wave:spec` adicionada. O GitHub Action `generate-spec.yml` irá gerar o `spec.md` automaticamente."
3. Após a conclusão, ofereça revisar o spec.md gerado em `docs/features/<slug>/spec.md`.
4. Próximo passo: gerar o plano técnico — mova para **📋 Plan** e use `/spec-wave plan <número>`.

---

### `/spec-wave plan <número-da-issue>`

Inicia a geração do **plano técnico** para uma Feature, derivado da especificação. É o **segundo** passo (a spec deve existir antes).

O plano técnico segue o schema do RFC-002 §3.2: **Estratégia Técnica** (com Matriz de Rastreabilidade), **Detalhamento da Implementação**, **Segurança e Conformidade**, **Estratégia de Testes** e **Rollback e Monitoramento**. O agente usa o `tech_context` do repositório (`.github/config/tech_context.yml` + versões de pacote e migrations recentes) para embasar o plano e usar APENAS as tecnologias declaradas. Para desvios pontuais, adicione uma seção `## Tech Override` no corpo da issue (RFC-002 §4.3).

**Passos:**
1. Verifique se `spec.md` já existe em `docs/features/<slug>/` (o plano usa a especificação funcional como contexto). Se não existir, gere a spec primeiro com `/spec-wave spec <número>`.
2. **Garanta o `tech_context`** (a qualidade do plano depende disso). Verifique se `.github/config/tech_context.yml` existe no repo (use Read). **Se não existir, ajude a criar AGORA** seguindo a seção **Tech Context** abaixo (logo após este comando) — e garanta que esteja **commitado e pushado** antes de adicionar a label (o Action lê o arquivo do repositório, não do seu disco local).
3. Adicione a label de gatilho:
   ```bash
   gh issue edit <número> --add-label "spec-wave:plan"
   ```
4. Informe: "Label `spec-wave:plan` adicionada. O GitHub Action `generate-plan.yml` irá gerar o `plan.md` automaticamente. Acompanhe em: Actions → Generate Plan."
5. Após a conclusão (cheque comentários na issue ou aguarde confirmação do usuário), ofereça revisar o plan.md gerado em `docs/features/<slug>/plan.md`.
6. Próximo passo: validar a Feature — mova para **✅ Ready** e use `/spec-wave ready <número>`.

---

### Tech Context (`.github/config/tech_context.yml`)

Fonte de verdade estática da stack do sistema (RFC-002 §4). O `generate-plan` lê este arquivo para embasar o plano técnico e usar **APENAS** as tecnologias/serviços nele declarados — sem ele, o plano fica genérico e pode inventar APIs inexistentes. O `npx @spec-wave/cli init` gera um **scaffold de exemplo** que **deve ser adaptado** à stack real. Use este fluxo quando o arquivo estiver ausente ou desatualizado.

**Como ajudar a criar (quando não existir):**

1. **Confirme a ausência:** tente `Read .github/config/tech_context.yml`. Se já existir, apenas confirme com o usuário se reflete a stack atual e pule para o fim.
2. **Detecte a stack** lendo os arquivos do repositório (use Read; não invente):
   - `package.json` → backend/frontend e libs (ex.: `@nestjs/core`, `next`, `react`, `@prisma/client`, `express`).
   - `pom.xml` / `build.gradle` (Java), `requirements.txt` / `pyproject.toml` (Python), `go.mod` (Go).
   - `prisma/schema.prisma` ou pasta `migrations/` → tabelas e colunas para `database_schemas`.
   - `Dockerfile` / `docker-compose.yml` / charts Helm → `infra`.
   - Procure papéis/roles (enum de RBAC) no código para `security.rbac_roles`.
3. **Rascunhe** o YAML seguindo EXATAMENTE este schema (preencha só o que conseguir confirmar; deixe `# TODO` no que faltar — não invente):
   ```yaml
   system_info:
     name: "<nome do sistema>"
     stack:
       backend: "<ex.: Node.js (NestJS v11)>"
       frontend: "<ex.: Next.js 16 (React 19)>"
       database: "<ex.: PostgreSQL (Prisma 5)>"
       infra: "<ex.: Docker / Kubernetes>"
     architecture: "<ex.: Monorepo Nx / Microservices>"
   security:
     auth_protocol: "<ex.: JWT>"
     rbac_roles: ["ADMIN", "..."]
   database_schemas:
     - table: "<tabela>"
       columns: "<col1, col2, ...>"
   existing_services:
     - name: "<serviço>"
       endpoint: "<caminho>"
       auth: "<ex.: JWT, mTLS>"
   internal_libraries:
     - "<lib interna>"
   ```
4. **Mostre o rascunho ao usuário e peça confirmação/ajustes** antes de gravar (ele conhece serviços internos e roles que o código pode não revelar).
5. **Grave** com Write em `.github/config/tech_context.yml`.
6. **Oriente a commitar e pushar** antes de seguir (o Action lê do repo). Sugira ao usuário rodar, via prefixo `!`:
   ```bash
   !git add .github/config/tech_context.yml && git commit -m "chore: tech_context.yml [spec-wave]" && git push
   ```

**Desvios pontuais:** para uma Feature específica usar algo fora do padrão (ex.: "usar DynamoDB só aqui"), oriente a adicionar uma seção `## Tech Override` no corpo da issue, com um bloco YAML que será mesclado (deep-merge) sobre o `tech_context.yml`:

````markdown
## Tech Override
```yaml
system_info:
  stack:
    database: "DynamoDB"
```
````

---

### `/spec-wave ready <número-da-issue>`

Valida que spec.md e plan.md estão completos e a Feature pode avançar.

**Passos:**
1. Adicione a label de validação:
   ```bash
   gh issue edit <número> --add-label "spec-wave:ready"
   ```
2. Informe: "Validação iniciada. O workflow verificará se spec.md e plan.md contêm todas as seções obrigatórias."
3. Se a validação falhar, o workflow comentará os problemas na issue e adicionará automaticamente `spec-wave:spec`. Informe o usuário para corrigir e tentar novamente.
4. Se passar, oriente: "Feature validada! Mova o card para **✅ Ready** e depois para **📋 Backlog Técnico** para iniciar a decomposição."

---

### `/spec-wave decompose <número-da-issue>`

Decompõe uma Feature em Stories e Tasks automaticamente.

**Passos:**
1. Confirme que a Feature está em **✅ Ready** (spec.md e plan.md validados)
2. Adicione a label de decomposição:
   ```bash
   gh issue edit <número> --add-label "spec-wave:decompose"
   ```
3. Informe: "Decomposição iniciada. O workflow gerará Stories e Tasks baseados em spec.md e plan.md."
4. Após a conclusão, as issues filhas aparecerão como comentário na Feature pai.

---

### `/spec-wave implement <número-da-issue>`

Aciona o spec-kit para implementar uma **Story** (todas as suas Tasks) ou uma **Task** isolada. Comando **local** (etapa 🚧 Desenvolvimento) — não usa label/Action.

**Pré-requisitos:** o repositório atual precisa estar inicializado (`.spec-wave.json` presente) e a issue deve ser do tipo Story ou Task. Para executar de fato (fora do `--dry-run`), o spec-kit precisa estar configurado via `specKit.command` no `.spec-wave.json` ou a env `SPEC_WAVE_IMPLEMENT_CMD`.

**Passos:**
1. Confirme que há `.spec-wave.json` no repo (senão, oriente `/spec-wave setup`).
2. **Sempre comece com `--dry-run`** para inspecionar o que será feito — detecção do tipo, lista de Tasks coletadas (no caso de Story) e o comando do spec-kit que seria executado:
   ```bash
   npx @spec-wave/cli implement <número> --dry-run
   ```
3. Mostre ao usuário o contexto montado em `.spec-wave/implement-<número>.md` e o comando. Esse arquivo contém as **instruções de execução sequencial**: implemente as Tasks **uma por vez** — mova a task para **🚧 Desenvolvimento** só ao iniciá-la e para **🎉 Done** ao concluí-la, antes de passar para a próxima. **Nunca** coloque várias tasks em "in progress" ao mesmo tempo.
4. **Se você (agente) for implementar diretamente** (sem `specKit.command`): siga o contexto task por task. Para cada task, use o campo **Status** (In Progress ao começar → Done ao concluir) *dentro* da Etapa 🚧 Desenvolvimento — não troque a Etapa da task. Atualize os campos via `gh`. **Ao concluir toda a Story**: faça o commit, abra o PR e **avance a Etapa** da **Story e de todas as suas Tasks** para **👀 Code Review** (Status → Todo). A **Feature só avança** quando **TODAS as suas Stories** já estiverem em Code Review — se houver Story pendente, deixe a Feature em 🚧 Desenvolvimento. Lembre: Etapa só avança (nunca volta); Status é o progresso dentro da etapa.
5. Se o usuário aprovar e o spec-kit estiver configurado, rode sem `--dry-run`:
   ```bash
   npx @spec-wave/cli implement <número>
   ```
   - Se o spec-kit **não** estiver configurado, o comando só monta o contexto e mostra como configurar (`specKit.command` / `SPEC_WAVE_IMPLEMENT_CMD`). Ajude o usuário a definir o template (placeholders: `{tasksFile} {specFile} {planFile} {issue} {type} {title}`).
   - Use `--feature-dir docs/features/<slug>` se a resolução automática da Feature falhar (a skill avisa com warning) e você quiser anexar `spec.md`/`plan.md` como contexto.
6. Se a issue **não** for Story nem Task (ex.: Feature, Bug), o comando recusa — oriente o usuário: Features se decompõem (`/spec-wave decompose`); implemente as Stories/Tasks resultantes.
7. Ao final (Story + Tasks em **👀 Code Review**; a Feature só vai para Code Review quando a última Story concluir): confirme o resultado com o usuário e oriente a revisão do PR.

---

### `/spec-wave rfc <tópico>`

Crie um documento RFC seguindo a estrutura do RFC-001.

**Passos:**
1. Entreviste o usuário sobre: objetivo, problema atual, solução proposta, princípios, stakeholders afetados
2. Escreva o RFC em português com as seções:
   - 1. Objetivo
   - 2. Princípios
   - 3. Papéis e Responsabilidades
   - 4. Estrutura de Trabalho
   - 5. Fluxo de Trabalho
   - 6. Automação
   - 7. Métricas
   - 8. Riscos e Mitigações
3. Salve em `rfc/rfc-<slug-do-tópico>.md` usando o Write tool
4. Crie uma issue de RFC:
   ```bash
   gh issue create --title "[RFC] <título>" --label "[RFC]"
   ```

---

### `/spec-wave fix-pr <número-do-pr>`

Audita um Pull Request e corrige automaticamente os problemas encontrados — segurança, arquitetura, infraestrutura e qualidade de código. Cada fix vira um commit separado no branch do PR. Cada review comment recebe uma resposta com o hash do commit.

**Pré-requisitos:** `.spec-wave.json` deve existir (para resolver `owner/repo`). Token com permissão de push no branch do PR.

**Passos:**

1. **Resolver contexto**
   - Leia `.spec-wave.json` para obter `owner` e `repo`.
   - Confirme o número do PR com o usuário se não vier como argumento.

2. **Coletar dados do PR**
   ```bash
   gh pr view <número> --json number,title,headRefName,body,changedFiles
   gh pr diff <número>
   gh api repos/<owner>/<repo>/pulls/<número>/comments
   gh api repos/<owner>/<repo>/pulls/<número>/reviews
   ```
   - Liste todos os arquivos alterados.
   - Colete todos os review comments (inline) e reviews gerais.

3. **Fazer checkout no branch do PR**
   ```bash
   gh pr checkout <número>
   ```

4. **Varredura de problemas** — para cada categoria abaixo, leia os arquivos alterados e identifique issues:

   | Categoria | O que procurar |
   |-----------|----------------|
   | **Segurança** | Credenciais hardcoded, secrets/API keys expostas, configs inseguras, injeção SQL/XSS |
   | **Arquitetura** | Dependências circulares, exports faltando, wiring incompleto, violações de camada |
   | **Infraestrutura** | OIDC mal configurado, IAM permissivo demais, Dockerfile sem usuário não-root, state remoto ausente |
   | **Qualidade** | sync-over-async, validação ausente, operações não idempotentes, error handling ausente |

   Se não houver review comments manuais, use o agente `caveman:cavecrew-reviewer` para detecção automatizada:
   ```
   Agent(caveman:cavecrew-reviewer) → diff do PR + arquivos alterados
   ```

5. **Para cada problema encontrado:**
   a. Leia o(s) arquivo(s) afetado(s) com Read
   b. Aplique o fix com Edit
   c. Faça commit separado:
      ```bash
      git add <arquivo>
      git commit -m "fix: <problema> (issue #<N>)

      <causa raiz>

      Solution: <descrição do fix>"
      ```
   d. Push ao branch do PR:
      ```bash
      git push
      ```

6. **Responder aos review comments** — para cada comment inline do PR:
   ```bash
   gh api repos/<owner>/<repo>/pulls/<número>/comments/<comment-id>/replies \
     -f body="✅ **FIXED** — commit **<HASH>**

   \`\`\`<linguagem>
   <trecho corrigido>
   \`\`\`

   <explicação do fix>"
   ```

7. **Comentário de sumário no PR**
   ```bash
   gh pr comment <número> --body "<sumário>"
   ```
   Formato do sumário:
   ```
   ## 🔍 PR Audit — Spec Wave

   ### Problemas encontrados e corrigidos

   | # | Severidade | Categoria | Problema | Commit |
   |---|-----------|-----------|---------|--------|
   | 1 | 🔴 Critical | Segurança | Credencial hardcoded em config.js | abc1234 |
   | 2 | 🟡 Medium | Qualidade | Operação não idempotente em createOrder | def5678 |

   ### Commits criados
   - `abc1234` fix: credencial hardcoded removida (issue #1)
   - `def5678` fix: idempotency key adicionada em createOrder (issue #2)

   **Total:** <N> problema(s) encontrado(s) e corrigido(s).
   ```

**Output esperado:**
- Lista de issues (severidade + impacto)
- Lista de commits criados (hash + mensagem)
- Confirmação de replies postadas nos review comments
- Estado final do PR

**Severidade:**
- 🔴 Critical — segurança, dados expostos, falha em produção
- 🟠 High — bug que afeta usuários, arquitetura quebrada
- 🟡 Medium — qualidade, manutenibilidade, performance
- 🔵 Low — estilo, naming, comentários

---

## Estrutura de arquivos gerados

```
docs/
  features/
    <slug-da-feature>/
      spec.md    ← gerado pelo GitHub Action quando spec-wave:spec é adicionado (1º)
      plan.md    ← gerado pelo GitHub Action quando spec-wave:plan é adicionado (2º, usa a spec)
```

O slug é gerado a partir do título da issue: `[FEATURE] Cadastro de Pedidos com PIX` → `cadastro-de-pedidos-com-pix`
