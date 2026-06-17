# Epic View — Especificação de Implementação

Tela de visualização de um Épico (dark UI). Esta spec descreve layout, design system, tokens, componentes, modelo de dados e estados para implementação fiel. Referência viva: `Epic View HiFi.dc.html`.

---

## 1. Visão geral

Tela de leitura de um épico, com 4 blocos de informação:

1. **Top bar** — navegação (breadcrumb) + ações globais.
2. **Hero** — identidade do épico (título, status, metadados) + painel de **progresso do épico**.
3. **Descrição (MDX)** — conteúdo longo renderizado de MDX. É o foco principal da tela.
4. **Features** — lista de cards, cada um com progresso próprio, tarefas, tags e responsável.

Princípios: dark UI quente, tipografia geométrica, densidade média, hierarquia clara entre "ler o épico" (esquerda) e "acompanhar features" (direita). Apenas visualização + ações leves (Editar, Comentar, Adicionar feature).

---

## 2. Design tokens

### 2.1 Cores

Tema escuro, base neutra quente (levemente alaranjada para casar com o accent terracota). Use como variáveis CSS.

```css
:root {
  /* Base / superfícies */
  --bg:            #14110e;   /* fundo da página */
  --bg-glow:       rgba(217,119,87,0.10); /* glow radial no topo */
  --surface:       #1a1613;   /* cards, painel de descrição */
  --surface-raised:#211c18;   /* topo do gradiente do hero, chips */
  --surface-hero-a:#211c18;   /* hero gradient início */
  --surface-hero-b:#1a1613;   /* hero gradient fim */
  --well:          #19150f;   /* painel de progresso (inset) */
  --topbar:        rgba(20,17,14,0.7); /* top bar com blur */

  /* Bordas */
  --border:        #2a2420;   /* borda padrão */
  --border-strong: #322b25;   /* borda de painéis/hero */
  --border-hover:  #43392f;   /* card em hover */
  --track:         #2a2420;   /* trilho de barras de progresso */

  /* Texto (do mais forte ao mais fraco) */
  --text:          #f2ede6;   /* títulos, valores */
  --text-2:        #cbc2b6;   /* corpo, descrição */
  --text-3:        #b3aa9e;   /* secundário */
  --text-muted:    #8a8178;   /* labels, metadados */
  --text-faint:    #7d746a;
  --text-dim:      #6f675d;   /* micro-labels */
  --text-ghost:    #4d463f;   /* separadores "/", checkbox vazio */

  /* Accent (terracota) */
  --accent:        #d97757;
  --accent-light:  #e6a484;   /* fim do gradiente da barra do épico */
  --accent-soft:   rgba(217,119,87,0.13); /* fundo de pills/callout */
  --accent-border: rgba(217,119,87,0.30);
  --selection:     rgba(217,119,87,0.30);

  /* Semântica de status */
  --done:          #7bbf9e;   --done-bg: rgba(123,191,158,0.13);
  --progress:      var(--accent); --progress-bg: var(--accent-soft);
  --todo:          #8a8178;   --todo-bg: rgba(138,129,120,0.14);
}
```

**Cores de avatar** (initials), saturação baixa, todas com texto escuro `#1a1410`:
`--av-blue #6f9bd1` · `--av-purple #b08ad1` · `--av-green #7bbf9e` · `--av-terracota #d97757`.

> O accent é o único token de marca configurável (tweakable). Tudo o mais deriva da base neutra quente. Não introduzir novas matizes sem necessidade.

### 2.2 Tipografia

Três famílias (Google Fonts):

| Papel | Família | Pesos | Uso |
|---|---|---|---|
| Display | **Space Grotesk** | 600, 700 | Título h1, h2/h3 de seção, números de % grandes |
| Corpo | **Manrope** | 400, 500, 600, 700 | Texto de descrição, metadados, labels, botões |
| Mono | **JetBrains Mono** | 400, 500 | Código do épico (`CHK-204`), tags, contagem de tarefas, label "MDX", blocos de código |

Escala (px / line-height):

| Token | Tamanho | LH | Peso | Família | Aplicação |
|---|---|---|---|---|---|
| `title` | 34 | 1.15 | 600 | Space Grotesk | Título do épico (letter-spacing −0.5px) |
| `pct-xl` | 36 | 1 | 700 | Space Grotesk | % do épico |
| `h2` | 17 | — | 600 | Space Grotesk | "Descrição", "Features" |
| `h3` | 16 | — | 600 | Space Grotesk | Subtítulos da descrição |
| `body` | 15.5 | 1.72 | 400 | Manrope | Parágrafos da descrição |
| `feat-name` | 15.5 | — | 600 | Manrope | Nome da feature |
| `meta` | 14 | — | 400/500 | Manrope | Metadados, % da feature |
| `label` | 13 | — | 400/600 | Manrope | Labels, botões, breadcrumb |
| `micro` | 12 | — | 600 | Manrope | Micro-labels de meta |
| `mono-sm` | 11–12 | — | 400/500 | JetBrains Mono | Tags, contagem, código |

### 2.3 Espaçamento, raio e sombra

- **Raios:** painéis `18px`; cards e insets `14px`; botões/callout `9–10px`; pills `20px`; chips pequenos `6–7px`; avatares/dots `50%`.
- **Padding:** painéis `30–34px`; painel de progresso `20–22px`; cards de feature `17–19px`; botões `6–7px / 13px`; pills `5px / 12px`.
- **Gaps:** grid do corpo `22px`; lista de cards `12px`; metadados do hero `22px`; itens internos `9–14px`.
- **Sombra de painel:** `0 24px 48px -28px rgba(0,0,0,0.7)` (apenas no hero).
- **Top bar:** `backdrop-filter: blur(8px)` sobre `--topbar`.
- **Glow do fundo:** `radial-gradient(1200px 480px at 70% -10%, var(--bg-glow), transparent 60%)` sobre `--bg`.

---

## 3. Layout

```
┌───────────────────────────────────────────────────────────┐
│ TOP BAR (sticky)   Épicos / Time / CHK-204     ✎ 💬  (VC)   │
├───────────────────────────────────────────────────────────┤
│  ┌─── HERO ───────────────────────────────────────────┐    │
│  │  [status] CHK-204                  ┌─ PROGRESSO ──┐ │    │
│  │  Título do épico (34px)            │ 49%          │ │    │
│  │  Prioridade · Prazo · Resp · Time  │ ▓▓▓▓░░░░      │ │    │
│  │                                    │ legenda x3   │ │    │
│  │                                    └──────────────┘ │    │
│  └────────────────────────────────────────────────────┘    │
│  ┌── DESCRIÇÃO (MDX) ───────────┐ ┌── FEATURES ─────────┐  │
│  │ 1.45fr                       │ │ 1fr                 │  │
│  │ parágrafos, h3, lista,       │ │ [card feature]      │  │
│  │ callout, critérios de aceite │ │ [card feature]      │  │
│  │                              │ │ ...                 │  │
│  └──────────────────────────────┘ └─────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

- Container central: `max-width: 1240px`, `margin: 0 auto`, padding `34px 30px 70px`.
- Top bar: `position: sticky; top: 0`, padding `14px 30px`, borda inferior `--border`.
- Corpo: `display: grid; grid-template-columns: 1.45fr 1fr; gap: 22px; align-items: start`.
- Hero: `display: flex; justify-content: space-between; gap: 30px; flex-wrap: wrap`. Coluna do título `flex: 1; min-width: 300px`; painel de progresso `width: 280px; flex-shrink: 0`.

---

## 4. Componentes

### 4.1 Top bar
- **Esquerda:** marca (quadrado `24px`, raio `7px`, `--accent`, glow `0 0 16px rgba(217,119,87,0.5)`) + breadcrumb `Épicos / {team} / {code}`. Separadores `/` em `--text-ghost`; segmentos em `--text-faint`, último (`code`) em `--text-2`.
- **Direita:** botões `Editar` e `Comentar` (borda `--border-strong`, fundo `--surface-raised`, texto `--text-muted`) + avatar do usuário (`30px`, círculo, `#3a322b`, initials).

### 4.2 Hero — bloco de identidade
- Fundo: `linear-gradient(180deg, --surface-hero-a, --surface-hero-b)`, borda `--border-strong`, raio `18px`, sombra de painel.
- **Status pill:** dot `7px` + label; texto/`--accent`, fundo `--accent-soft`, borda `--accent-border`, raio `20px`.
- **Código** ao lado, em mono, `--text-muted`.
- **Título:** `title` token.
- **Metadados** (linha de até 4): cada item é `label micro (--text-dim)` sobre `valor (14px)`. Campos: Prioridade (com `▲` accent), Prazo, Responsável (avatar `20px` + nome), Time.

### 4.3 Painel de progresso do épico
- Inset: fundo `--well`, borda `--border-strong`, raio `14px`, padding `20–22px`.
- **Cabeçalho:** "Progresso do épico" (`label`, `--text-muted`) + valor `pct-xl` em `--accent`.
- **Barra:** trilho `height: 9px`, raio `6px`, `--track`; preenchimento `width: {epicPct}%` com `linear-gradient(90deg, --accent, --accent-light)`.
- **Legenda** (3 linhas): dot quadrado `8px` (raio 2) na cor do status + label (`--text-3`) à esquerda; contagem (mono, `--text-muted`) à direita. Categorias: Concluídas / Em andamento / A fazer.

### 4.4 Descrição (MDX)
- Painel: fundo `--surface`, borda `--border`, raio `18px`, padding `30px 34px`.
- Cabeçalho: "Descrição" (`h2`) + badge `MDX` (mono `11px`, borda `--border`, raio `5px`, `--text-dim`).
- **Mapa de elementos MDX → estilo:**

| Elemento | Estilo |
|---|---|
| `p` | `body` token, cor `--text-2`, margin-bottom `20px` |
| `strong` | cor `--text`, peso 600 |
| `em` | cor `--text`, itálico |
| `h3` | `h3` token, cor `--text`, margin `26px 0 10px` |
| `ul` (lista) | `list-style: none`; cada `li` = `flex` com marcador `›` em `--accent` + texto |
| Callout/nota | flex; fundo `--accent-soft`, borda `--accent-border`, **borda-esquerda `3px --accent`**, raio `10px`, padding `15px 17px`; ícone + texto |
| Checklist (critérios) | cada item = checkbox `18px` (raio 5) + label. Marcado: borda/texto `--done`, fundo `--done-bg`, `✓`. Vazio: borda `--text-ghost`, sem marca, label `--text-2` |
| Bloco de código | mono, fundo `#211c18`, borda `--border`, raio `8px`, padding `16px`, `--text-muted` |

### 4.5 Card de feature
Fundo `--surface`, borda `--border`, raio `14px`, padding `17px 19px`. **Hover:** `border-color: --border-hover; transform: translateY(-1px)` (transição `.15s`).

Estrutura (3 linhas):
1. **Topo:** dot `8px` na cor do status + nome (`feat-name`, `--text`) à esquerda; avatar do responsável (`26px`, círculo, cor do avatar, initials, texto `#1a1410`) à direita.
2. **Progresso:** trilho `7px` raio `5px` `--track` + preenchimento `width: {pct}%` na **cor do status**; à direita % em Space Grotesk `14px` `--text-2` (largura fixa `38px`, alinhado à direita).
3. **Rodapé:** tags à esquerda (chips mono `11px`, fundo `--surface-raised`, borda `--border`, raio `6px`, `--text-muted`); à direita contagem `{done}/{total}` (mono, `--text-faint`) + badge de status (texto/cor do status, fundo `bg` do status, raio `6px`, `11px` peso 600).

**Cabeçalho da seção Features:** "Features {n}" (`h2`, contagem em `--text-dim`) + botão "+ Adicionar" (texto `--accent`, fundo `--accent-soft`, borda `--accent-border`, raio `9px`).

---

## 5. Modelo de dados

```ts
type Status = 'done' | 'prog' | 'todo';

interface Epic {
  code: string;          // "CHK-204"
  title: string;
  team: string;          // "Squad Checkout"
  status: string;        // "Em andamento"
  priority: string;      // "Alta"
  dates: string;         // "12 mai – 30 jun"
  owner: { name: string; initials: string; avatarColor: string };
  descriptionMdx: string; // fonte MDX renderizada no painel de descrição
  features: Feature[];
}

interface Feature {
  name: string;
  status: Status;
  pct: number;           // 0–100 (progresso próprio)
  doneTasks: number;
  totalTasks: number;
  tags: string[];
  assignee: { initials: string; avatarColor: string };
}
```

### Valores derivados (computar no cliente)
- `epicPct = round( mean(features.map(f => f.pct)) )` — média simples dos % das features.
- `legend = { done: count(pct>=100), prog: count(0<pct<100), todo: count(pct===0) }`.
- Mapa de status → `{ color, bg, label }`:
  - `done` → `--done` / `--done-bg` / "Concluída"
  - `prog` → `--accent` / `--accent-soft` / "Em andamento"
  - `todo` → `--todo` / `--todo-bg` / "A fazer"

> A cor do dot, da barra e do badge de uma feature derivam **todas** do seu `status`. O badge de status do épico no hero usa sempre o estilo `prog` (accent).

---

## 6. Estados

- **Hover** em card de feature: borda `--border-hover` + leve elevação.
- **Loading:** skeletons com fundo `--track`, raio `4px`, larguras variadas (linhas de descrição) e blocos para cards. Sem shimmer obrigatório.
- **Vazio (sem features):** card pontilhado com texto `--text-muted` "Nenhuma feature ainda" + botão "+ Adicionar feature".
- **Épico 100%:** barra cheia; legenda mostra todas em Concluídas.

> **Não** usar animações de entrada com `animation-fill-mode: both` que deixem elementos em `opacity:0`/`scaleX(0)` por padrão — se a timeline não avançar, o conteúdo fica invisível. Estado base deve ser sempre visível; animação é só enriquecimento (ou disparada via JS no mount).

---

## 7. Acessibilidade

- Contraste: `--text` sobre `--surface` ≈ 12:1; `--text-2` ≈ 8:1. Evitar usar `--text-faint`/`--text-dim` para conteúdo essencial.
- Status nunca por cor isolada: sempre acompanhar de **label** textual (badge) e contagem.
- Barras de progresso: `role="progressbar"` com `aria-valuenow/min/max`.
- Hit targets de botões/ações ≥ 32px de altura.
- Foco visível em todos os interativos (anel `--accent` 2px).

---

## 8. Responsivo (referência: desktop)

- **≥ 1100px:** layout descrito (grid 1.45fr / 1fr).
- **768–1099px:** corpo em coluna única; painel de progresso do hero passa a largura total abaixo dos metadados.
- **< 768px:** top bar colapsa ações em menu; cards de feature em largura total; padding lateral `16–20px`.

---

## 9. Implementação

- Fontes via Google Fonts: `Space Grotesk` (600,700), `Manrope` (400,500,600,700), `JetBrains Mono` (400,500).
- Renderizar MDX com um pipeline MDX/Markdown e aplicar o mapa de estilos da seção 4.4 (não confiar em CSS de tags cru — estilizar por componentes).
- Único token de marca configurável: `--accent` (e seus derivados `--accent-light/soft/border`). Trocar o accent não deve exigir mudar nada mais.
- Referência pixel: `Epic View HiFi.dc.html` neste projeto.

