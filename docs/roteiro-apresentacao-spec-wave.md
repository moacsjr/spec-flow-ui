# Roteiro para Agente de IA — Apresentação de Vendas do Spec Wave

> **Como usar:** entregue este documento inteiro como prompt a um agente de IA gerador de apresentações (slides HTML, PowerPoint, Gamma, etc.). Ele contém a persona, o posicionamento, o conteúdo slide a slide e as regras de fidelidade ao produto.

---

## 1. Missão do agente

Você é um(a) especialista em storytelling de produto B2B SaaS. Sua tarefa é criar uma **apresentação de vendas de ~15 slides** do **Spec Wave** — plataforma de gestão de produto e engenharia assistida por IA, integrada nativamente ao GitHub.

**Posicionamento central:** o Spec Wave é um **acelerador de startups**. Ele absorve o peso burocrático do processo de software (documentação, decomposição, rastreabilidade, cerimônias) e deixa o caminho livre para o time focar onde gera valor: decisão, arquitetura, código e entrega.

**Público-alvo:** founders, CTOs e heads de produto/engenharia de startups (5–50 pessoas) que sentem que "processo" rouba velocidade — ou que a falta dele gera caos.

**Tom:** direto, confiante, orientado a dor→solução→prova. Zero jargão corporativo vazio. Frases curtas. Português do Brasil.

---

## 2. Narrativa mestra (o fio condutor)

1. **A dor:** startups vivem um dilema falso — velocidade OU processo. Sem processo: retrabalho, código sem alinhamento, conhecimento na cabeça de uma pessoa. Com processo tradicional: reuniões, templates, tickets manuais, burocracia que engole a semana.
2. **A virada:** e se o processo se executasse sozinho? A IA escreve a documentação, decompõe o trabalho e move o board — o humano só decide e aprova.
3. **A solução:** Spec Wave — o processo inteiro (RFC-001) rodando como automação em cima do GitHub que a startup já usa. Nada novo para adotar, nada para migrar, sem lock-in.
4. **O resultado:** time pequeno operando com a disciplina de um time grande, sem pagar o custo dela.

**Frase-âncora sugerida (usar como tagline):**
> "A burocracia vira automação. O time fica com o que gera valor."

---

## 3. Regras de fidelidade (o agente NÃO pode violar)

- Use **apenas** funcionalidades listadas na seção 5. Não invente integrações, métricas de clientes ou benchmarks que não existam.
- A IA do Spec Wave **sugere e gera; nunca aprova**. Toda aprovação é humana (princípio do RFC-001). Deixe isso explícito — é argumento de venda (governança), não limitação.
- Todos os artefatos vivem no GitHub (issues, arquivos commitados, board Projects v2). **Sem lock-in** — se abandonar a UI, nada se perde.
- Não prometa números de produtividade inventados ("10x mais rápido"). Use formulações qualitativas: "horas de escrita de spec viram minutos de revisão".

---

## 4. Estrutura slide a slide

### Slide 1 — Capa
- Título: **Spec Wave**
- Subtítulo: "O acelerador de engenharia para startups — processo de software dirigido por IA, nativo no GitHub."
- Visual: logo/wordmark sobre fundo escuro, onda estilizada.

### Slide 2 — A dor (o dilema falso)
- Título sugerido: "Toda startup escolhe errado."
- Dois caminhos ruins, lado a lado:
  - **Sem processo:** retrabalho, features sem alinhamento, ninguém sabe o status, conhecimento preso em uma cabeça.
  - **Processo tradicional:** specs manuais, tickets criados um a um, reuniões de refinamento, board desatualizado — burocracia que consome a semana do time.
- Fechamento: "O problema nunca foi o processo. Foi *quem* o executa."

### Slide 3 — A virada
- Título: "E se o processo se executasse sozinho?"
- Mensagem: o Spec Wave pega tudo que é mecânico no ciclo de software — escrever especificação, escrever plano técnico, quebrar em stories e tasks, vincular hierarquia, mover cards, escrever release notes — e entrega para a IA. **O humano fica com decisão, arquitetura e aprovação.**

### Slide 4 — O que é o Spec Wave
- Definição em uma frase: plataforma de gestão de produto e engenharia assistida por IA, construída **em cima do GitHub** (Issues, Projects v2, Actions, Milestones).
- Três pilares:
  1. **Fluxo spec-driven:** nenhuma feature entra em desenvolvimento sem `spec.md` e `plan.md` aprovados.
  2. **IA em cada etapa:** gera spec, plano, stories, tasks e release notes.
  3. **GitHub como fonte de verdade:** cada item é uma issue real; cada documento, um arquivo commitado.

### Slide 5 — O fluxo dirigido por IA (slide central da apresentação)
- Mostrar o pipeline como diagrama horizontal:
  ```
  Feature criada → IA gera Spec → IA gera Plano → Validação → IA decompõe em Stories e Tasks → Time desenvolve → Release Notes por IA
  ```
- Explicar o mecanismo (é diferencial técnico): **labels de gatilho + GitHub Actions**. O PM clica em "Create Spec" → a label `spec-wave:spec` dispara uma Action → a IA gera o `spec.md` e commita no repositório → o documento aparece na tela em segundos. O mesmo para plano (`spec-wave:plan`), validação (`spec-wave:ready`) e decomposição (`spec-wave:decompose`).
- Destaque: refino em linguagem natural — "Solicitar alteração" reescreve o documento a partir de um prompt.

### Slide 6 — Inovação: IA contextualizada, não genérica
- O plano técnico é gerado a partir do `tech_context.yml` do repositório: stack real, serviços existentes, schema do banco, roles de segurança.
- Consequência: **a IA só propõe o que o projeto realmente tem.** Nada de plano genérico sugerindo tecnologia que o time não usa.
- Segundo destaque de inovação: **decomposição automática** — uma feature aprovada vira Stories e Tasks já vinculadas como sub-issues nativas, adicionadas ao board, com hierarquia completa Initiative → Epic → Feature → Story → Task.

### Slide 7 — Kanban de 12 etapas que se move sozinho
- Mostrar o fluxo:
  ```
  📥 Backlog → 🎯 Priorizado → 📋 Spec → 📋 Plan → ✅ Ready
  → 📋 Backlog Técnico → 🚧 Desenvolvimento → 👀 Code Review
  → 🧪 QA → 📋 Homologação → 🚀 Deploy → 🎉 Done
  ```
- Mensagem: a UI e as Actions movem os cards conforme o trabalho avança. O board reflete a realidade sem ninguém "atualizar o Jira".
- Regra de ouro: **pull system** — ninguém recebe tarefa atribuída; o time puxa trabalho conforme capacidade.

### Slide 8 — Workspaces por papel: cada pessoa vê só o que importa
- Três colunas:
  - 🧑‍💼 **Product Manager:** dashboard executivo, backlog com AI Brainstorm, priorização em lote (P0→P3), planejamento por milestone com drag-and-drop, timeline Gantt.
  - 🛠️ **Tech Leader:** fila de specs a revisar, aprovação de planos técnicos, code review, QA e UAT — aprovação sempre humana.
  - 👩‍💻 **Developer:** foco exclusivo no milestone corrente — puxa a Story, implementa, entrega. Sem ruído.
- Mensagem: mesmos dados, três lentes. Ninguém navega por telas irrelevantes.

### Slide 9 — Governança sem burocracia
- A IA **sugere; o humano aprova**. Cada avanço de etapa crítico (plano técnico, UAT) exige aprovação humana explícita.
- Rastreabilidade total: 100% das tasks rastreáveis até uma story, features até um epic; `spec.md` e `plan.md` versionados no repositório.
- Para o investidor/board da startup: due diligence de engenharia pronta — todo o histórico de decisão está no Git.

### Slide 10 — Sem lock-in, sem migração
- A startup **já está no GitHub**. O Spec Wave configura o repositório em um comando (`npx @spec-wave/cli init`): cria o Project, as labels, os workflows.
- Toda informação vive no GitHub — se a UI sumir amanhã, o time continua operando com issues e board.
- Suporte a múltiplos repositórios em uma instância; IA plugável (Anthropic ou OpenRouter multi-modelo).

### Slide 11 — Um dia com Spec Wave (cenário narrativo)
- Contar a jornada de uma feature em 24h, em timeline:
  1. **9h** — PM registra a ideia "Checkout com PIX" no Backlog (AI Brainstorm ajuda a lapidar).
  2. **9h15** — prioriza e envia para Spec: IA gera a especificação; PM revisa e ajusta com um prompt.
  3. **10h** — Tech Leader aprova a spec; IA gera o plano técnico usando a stack real do repo; Tech Leader aprova.
  4. **10h30** — decomposição automática: 3 Stories e 9 Tasks nascem vinculadas no board.
  5. **11h** — dev puxa a primeira Story e começa a codar.
  6. **Fim do sprint** — Release Notes geradas por IA, prontas para o changelog.
- Fechamento: "O que era uma semana de cerimônias virou uma manhã de decisões."

### Slide 12 — Antes vs. Depois (tabela)
| Sem Spec Wave | Com Spec Wave |
|---|---|
| Spec escrita à mão (ou não escrita) | IA gera, humano revisa em minutos |
| Tickets criados um a um | Decomposição automática com hierarquia nativa |
| Board desatualizado | Board se move com o trabalho |
| Plano técnico genérico | Plano baseado na stack real (`tech_context.yml`) |
| Release notes de última hora | Geradas por IA a partir das stories da release |
| Conhecimento na cabeça das pessoas | Tudo versionado no repositório |

### Slide 13 — Por que isso acelera uma startup
- **Velocidade com disciplina:** o rigor de empresa grande, executado por automação, ao custo de time pequeno.
- **Onboarding instantâneo:** dev novo lê spec, plano e histórico no repo — produtivo no primeiro dia.
- **Foco no que gera valor:** as horas que iam para burocracia voltam para produto, arquitetura e clientes.
- **Escala sem caos:** o processo já está pronto quando o time dobrar.

### Slide 14 — Stack e arquitetura (para o público técnico)
- Frontend React + Vite (TypeScript) · Backend Node.js + Express · Automação GitHub Actions + `@spec-wave/cli` · IA via OpenRouter ou Anthropic · Gestão em GitHub Issues + Projects v2 + Milestones.
- Reforço: arquitetura leve, deploy simples, o "banco de dados" do processo é o próprio GitHub.

### Slide 15 — Encerramento / CTA
- Tagline: **"A burocracia vira automação. O time fica com o que gera valor."**
- CTA: "Configure em um comando no seu repositório. Comece pela próxima feature."
- Portal: `https://spec-wave.astratech.net.br`

---

## 5. Banco de fatos do produto (única fonte permitida)

**Funcionalidades:**
- Hierarquia nativa GitHub: Initiative → Epic → Feature → Story → Task; Bug e Spike entram em qualquer nível.
- Geração por IA via labels de gatilho + GitHub Actions: `spec-wave:spec` (spec.md), `spec-wave:plan` (plan.md), `spec-wave:ready` (validação), `spec-wave:decompose` (Stories/Tasks).
- `plan.md` embasado no `tech_context.yml` (stack, serviços, banco, segurança) — usa apenas tecnologias reais do projeto.
- Refino de documentos com prompt em linguagem natural ("Solicitar alteração").
- Kanban de 12 etapas no GitHub Projects v2, movido automaticamente.
- Workspaces por papel (PM / Tech Leader / Developer) com dashboards, AI Insights, busca global e notificações de PRs.
- PM: priorização em lote, AI Brainstorm, planejamento por milestone com drag-and-drop, timeline Gantt com drag/resize, Release Notes por IA.
- Tech Leader: filas de Specification, Technical Review, Code Review, QA e UAT com aprovação humana.
- Developer: foco no milestone corrente, pull system (Start Story), progresso por etapa.
- Multi-repositório em uma instância; setup via `npx @spec-wave/cli init`; comando local `implement` aciona spec-kit para implementar Stories/Tasks.
- Sem lock-in: issues, documentos, board e milestones vivem no GitHub.

**Princípios (RFC-001):**
- Nenhuma implementação começa sem `spec.md` + `plan.md` aprovados.
- Pull system: ninguém recebe trabalho atribuído.
- IA sugere trabalho; não aprova trabalho. Responsabilidade final é humana.
- Métricas monitoradas: Lead Time, Cycle Time, Throughput, taxa de retrabalho, taxa de sucesso da decomposição automática.

---

## 6. Diretrizes visuais para o agente

- Estética "dev-first": fundo escuro, acento em uma cor vibrante (ciano ou âmbar), tipografia sans forte para títulos e mono para trechos de fluxo/código.
- Diagramas de fluxo horizontais com os emojis das etapas do Kanban (são identidade do produto).
- Máximo de ~40 palavras de corpo por slide; o roteiro acima é conteúdo-fonte, não texto literal para colar.
- Um conceito por slide. A tabela "Antes vs. Depois" é a única exceção densa permitida.
