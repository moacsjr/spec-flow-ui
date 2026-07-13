// AI insights/summaries dos workspaces (RFC-003, fase 5). Compõe um contexto
// COMPACTO a partir do snapshot (cacheado) e pede um texto curto à LLM.
// Princípio do RFC: a AI apoia decisões, nunca aprova/escreve sozinha — o
// brainstorm devolve ideias; criar issues é sempre ação explícita do usuário.
//
// Atenção ao teto de 29 s do API Gateway: contexto enxuto + maxTokens baixo.

import type { ProjectSnapshot, SnapshotItem, StageName } from '@spec-flow/shared';
import { STAGE_NAMES } from '@spec-flow/shared';
import { generateText } from '../llm/openrouter.ts';
import { emitMetric } from '../lib/metrics.ts';
import { HttpError } from '../lib/errors.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { loadSnapshotForRepository } from './snapshotService.ts';

export type InsightScope = 'pm-progress' | 'tech-insights' | 'dev-daily' | 'brainstorm';

export const INSIGHT_SCOPES: InsightScope[] = [
  'pm-progress',
  'tech-insights',
  'dev-daily',
  'brainstorm',
];

// Linha compacta de um item para o contexto da LLM.
function itemLine(item: SnapshotItem): string {
  const bits = [
    `#${item.number} [${item.level}] ${item.title}`,
    item.stage ? `etapa=${item.stage}` : null,
    item.priority ? `prio=${item.priority}` : null,
    item.milestone ? `milestone=${item.milestone.title}` : null,
    item.assignees[0] ? `resp=${item.assignees[0].login}` : null,
    item.progress ? `progresso=${item.progress.completed}/${item.progress.total}` : null,
    item.prs.length ? `prs=${item.prs.map((p) => `#${p.number}(${p.state})`).join(',')}` : null,
  ];
  return bits.filter(Boolean).join(' | ');
}

// Contexto compacto: contagens por etapa + milestones + amostra de itens abertos.
// `maxItems` limita o tamanho do prompt (teto de 29 s / custo).
function contextOf(snapshot: ProjectSnapshot, maxItems = 60): string {
  const byStage = new Map<StageName, number>();
  for (const item of snapshot.items) {
    if (item.stage) byStage.set(item.stage, (byStage.get(item.stage) ?? 0) + 1);
  }
  const stageCounts = STAGE_NAMES.map((s) => `${s}: ${byStage.get(s) ?? 0}`).join(', ');

  const milestones = snapshot.milestones
    .map(
      (m) =>
        `- ${m.title} (${m.state}${m.dueOn ? `, alvo ${m.dueOn.slice(0, 10)}` : ''}): ` +
        `${m.closedCount} fechadas / ${m.openCount} abertas`,
    )
    .join('\n');

  const open = snapshot.items.filter((i) => i.state === 'open').slice(0, maxItems);

  return [
    `Repositório: ${snapshot.repository.name}`,
    `Itens por etapa: ${stageCounts}`,
    '',
    'Milestones:',
    milestones || '(nenhum)',
    '',
    `Itens abertos (amostra de ${open.length}):`,
    ...open.map(itemLine),
  ].join('\n');
}

const SYSTEM_BASE =
  'Você é o assistente do spec-flow (workflow spec-driven sobre GitHub). Responda em português, ' +
  'em markdown simples, curto e direto — sem preâmbulo, sem repetir os dados crus. ' +
  'Você NUNCA aprova, cria ou altera nada: apenas informa e recomenda.';

const SCOPE_PROMPTS: Record<InsightScope, { system: string; user: string; maxTokens: number }> = {
  'pm-progress': {
    system: SYSTEM_BASE,
    user:
      'Explique o status atual do projeto para um Product Manager: progresso geral, ' +
      'milestones em risco, gargalos por etapa e 3 recomendações de próximo passo.',
    maxTokens: 900,
  },
  'tech-insights': {
    system: SYSTEM_BASE,
    user:
      'Gere insights técnicos para um Tech Leader: features paradas em Spec/Plan, stories ' +
      'bloqueadas, PRs esperando review há mais tempo e riscos de execução. Termine com 3 ações sugeridas.',
    maxTokens: 900,
  },
  'dev-daily': {
    system: SYSTEM_BASE,
    user:
      'Escreva o resumo diário de um Developer: o que está em andamento, o que está esperando ' +
      'review/QA e qual a próxima story recomendada. Máximo de 10 linhas.',
    maxTokens: 500,
  },
  brainstorm: {
    system:
      SYSTEM_BASE +
      ' Para brainstorm: devolva uma lista numerada de ideias, cada uma com título (1 linha) e ' +
      'descrição (1-2 linhas). Não crie issues — o usuário decide o que aproveitar.',
    user: 'Sugira até 8 ideias de novas features/histórias coerentes com o backlog atual.',
    maxTokens: 900,
  },
};

// Gera o insight/summary de um escopo. `topic` (brainstorm) direciona o tema.
export async function generateInsight(
  tenantId: string,
  repoId: string,
  scope: InsightScope,
  topic?: string,
): Promise<string> {
  const prompt = SCOPE_PROMPTS[scope];
  if (!prompt) throw new HttpError(400, `Escopo de insight inválido: "${scope}".`);

  const snapshot = await loadSnapshotForRepository(tenantId, repoId);

  // Mesma política de cota do refine: tenant com chave própria não consome.
  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const user = [
    prompt.user,
    topic && scope === 'brainstorm' ? `\nTema/foco pedido pelo usuário: ${topic}` : '',
    '\n---\n## Dados do projeto\n',
    contextOf(snapshot),
  ].join('\n');

  const startedAt = Date.now();
  try {
    return await generateText({
      system: prompt.system,
      user,
      apiKeyOverride: tenantKey,
      maxTokens: prompt.maxTokens,
    });
  } finally {
    emitMetric('InsightDurationMs', Date.now() - startedAt, 'Milliseconds', { scope });
  }
}

// Gera um texto de Release Notes padronizado (markdown) para um milestone, a
// partir das Stories atribuídas a ele. Não persiste — o chamador salva.
export async function generateReleaseNotes(
  tenantId: string,
  repoId: string,
  milestoneNumber: number,
): Promise<string> {
  const snapshot = await loadSnapshotForRepository(tenantId, repoId);
  const milestone = snapshot.milestones.find((m) => m.number === milestoneNumber);
  if (!milestone) throw new HttpError(404, `Milestone #${milestoneNumber} não encontrado.`);

  const stories = snapshot.items.filter((i) => i.milestone?.number === milestoneNumber);

  // Mesma política de cota do refine/insights: tenant com chave própria não consome.
  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const storyLines =
    stories
      .map(
        (s) =>
          `- #${s.number} ${s.title}` +
          `${s.priority ? ` (prio ${s.priority})` : ''}` +
          `${s.state === 'closed' || s.stage === 'Done' ? ' [concluída]' : ''}`,
      )
      .join('\n') || '(sem stories atribuídas)';

  const user = [
    `Gere um texto de Release Notes padronizado, em português e em markdown, para a release "${milestone.title}".`,
    milestone.dueOn ? `Data-alvo: ${milestone.dueOn.slice(0, 10)}.` : '',
    'Estrutura obrigatória:',
    `1. Um título "# Release Notes — ${milestone.title}".`,
    '2. Um parágrafo de resumo executivo (o que esta release entrega, em linguagem de usuário).',
    '3. Seção "## ✨ Novidades" com bullets orientados ao usuário final (sem jargão de issue/número).',
    '4. Seção "## 📋 Escopo" com a contagem de stories entregues.',
    '5. Rodapé curto.',
    'Baseie-se SOMENTE nas stories listadas; não invente itens.',
    '\n## Stories da release\n',
    storyLines,
  ].join('\n');

  const startedAt = Date.now();
  try {
    return await generateText({
      system:
        SYSTEM_BASE +
        ' Aqui você redige Release Notes claras e padronizadas para usuários finais.',
      user,
      apiKeyOverride: tenantKey,
      maxTokens: 1000,
    });
  } finally {
    emitMetric('InsightDurationMs', Date.now() - startedAt, 'Milliseconds', {
      scope: 'release-notes',
    });
  }
}
