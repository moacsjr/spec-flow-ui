// Fixture: um payload cru de GitHub (mesma forma de github/types.ts) descrevendo
// o épico "CHK-204 — Reformulação do fluxo de Checkout". Permite rodar o app sem
// token. O adapter trata estes dados exatamente como trataria a resposta real da
// API — provando o pipeline GitHub → modelo de domínio.

import type { GhEpicPayload, GhIssue } from '../github/types';

// Helpers para montar sub-issues (Stories/Tasks) de forma concisa.
const task = (number: number, title: string, closed: boolean): GhIssue => ({
  number,
  title: `[TASK] ${title}`,
  body: '',
  state: closed ? 'closed' : 'open',
  labels: [{ name: '[TASK]' }],
  assignees: [],
});

const story = (number: number, title: string, tasks: GhIssue[]): GhIssue => ({
  number,
  title: `[STORY] ${title}`,
  body: '',
  state: tasks.every((t) => t.state === 'closed') ? 'closed' : 'open',
  labels: [{ name: '[STORY]' }],
  assignees: [],
  subIssues: tasks,
});

const EPIC_BODY = `Reformular ponta a ponta a experiência de **checkout** para reduzir o abandono de carrinho e suportar os novos meios de pagamento (PIX e carteira digital). O foco é diminuir a fricção nas etapas finais da compra, mantendo a conformidade com as regras antifraude.

> **Contexto.** A taxa de abandono no checkout atual está em 38%. A meta desta iniciativa é reduzi-la para abaixo de 25% até o fim do trimestre.

### Objetivos

- Unificar o fluxo em uma única página de revisão e pagamento
- Habilitar **PIX** como meio de pagamento nativo, com QR Code e copia-e-cola
- Persistir o carrinho entre sessões para usuários autenticados
- Instrumentar cada etapa com eventos de telemetria

### Regras de negócio

O cálculo de frete deve ocorrer *antes* da seleção de pagamento. Cupons promocionais são validados no servidor e nunca confiados ao cliente. Pagamentos via PIX expiram em \`30min\` e liberam o estoque reservado ao expirar.

### Critérios de aceite

- [x] Página única de revisão e pagamento publicada
- [x] PIX disponível com QR Code e copia-e-cola
- [ ] Carrinho persistente entre sessões
- [ ] Telemetria completa das 4 etapas do funil

### Notas de implementação

O serviço de pagamentos expõe um endpoint idempotente para evitar cobrança duplicada:

\`\`\`http
POST /api/v2/checkout/pay
Idempotency-Key: <uuid>
\`\`\`
`;

const epic: GhIssue = {
  number: 204,
  title: '[EPIC] Reformulação do fluxo de Checkout',
  body: EPIC_BODY,
  state: 'open',
  url: 'https://github.com/acme/loja/issues/204',
  createdAt: '2026-05-12T09:00:00Z',
  labels: [{ name: '[EPIC]' }, { name: 'P1' }, { name: 'team:Squad Checkout' }],
  assignees: [{ login: 'vcardoso', name: 'Vinícius Cardoso' }],
  milestone: { title: 'Q2 2026', dueOn: '2026-06-30T00:00:00Z' },
};

const features: GhIssue[] = [
  {
    number: 210,
    title: '[FEATURE] Página única de revisão e pagamento',
    body: '',
    state: 'closed',
    labels: [{ name: '[FEATURE]' }, { name: 'Frontend' }, { name: 'v2.0' }],
    assignees: [{ login: 'amartins', name: 'Ana Martins' }],
    subIssues: [
      story(211, 'Revisar itens do carrinho', [
        task(212, 'Componente de resumo do carrinho', true),
        task(213, 'Edição inline de quantidade', true),
      ]),
      story(214, 'Selecionar pagamento na mesma página', [
        task(215, 'Acordeão de meios de pagamento', true),
        task(216, 'Validação client-side de cartão', true),
      ]),
    ],
  },
  {
    number: 220,
    title: '[FEATURE] Pagamento via PIX',
    body: '',
    state: 'open',
    labels: [{ name: '[FEATURE]' }, { name: 'Backend' }, { name: 'v2.0' }],
    assignees: [{ login: 'rsouza', name: 'Rafael Souza' }],
    subIssues: [
      story(221, 'Gerar cobrança PIX', [
        task(222, 'Integração com PSP', true),
        task(223, 'Geração de QR Code', true),
        task(224, 'Copia-e-cola', true),
      ]),
      story(225, 'Conciliar pagamento', [
        task(226, 'Webhook de confirmação', false),
        task(227, 'Liberar estoque ao expirar', false),
      ]),
    ],
  },
  {
    number: 230,
    title: '[FEATURE] Carrinho persistente',
    body: '',
    state: 'open',
    labels: [{ name: '[FEATURE]' }, { name: 'Backend' }, { name: 'Data' }],
    assignees: [{ login: 'pdias', name: 'Paula Dias' }],
    subIssues: [
      story(231, 'Persistir carrinho do usuário', [
        task(232, 'Modelo de dados do carrinho', true),
        task(233, 'Sincronização entre dispositivos', false),
        task(234, 'Expiração e limpeza', false),
      ]),
    ],
  },
  {
    number: 240,
    title: '[FEATURE] Telemetria do funil de checkout',
    body: '',
    state: 'open',
    labels: [{ name: '[FEATURE]' }, { name: 'Frontend' }, { name: 'Data' }],
    assignees: [{ login: 'lgomes', name: 'Lucas Gomes' }],
    subIssues: [
      story(241, 'Instrumentar etapas do funil', [
        task(242, 'Evento de início de checkout', false),
        task(243, 'Eventos por etapa', false),
        task(244, 'Dashboard de conversão', false),
      ]),
    ],
  },
  {
    number: 250,
    title: '[FEATURE] Antifraude no pagamento',
    body: '',
    state: 'open',
    labels: [{ name: '[FEATURE]' }, { name: 'Backend' }, { name: 'Infra' }],
    assignees: [{ login: 'rsouza', name: 'Rafael Souza' }],
    subIssues: [
      story(251, 'Avaliar risco da transação', [
        task(252, 'Integração com provedor de score', true),
        task(253, 'Regras de bloqueio', false),
        task(254, 'Fila de revisão manual', false),
        task(255, 'Auditoria de decisões', false),
      ]),
    ],
  },
];

export const fixturePayload: GhEpicPayload = {
  epic,
  features,
  team: 'Squad Checkout',
};
