// Helpers de status PUROS usados pelo adapter (sem CSS/DOM — isso fica no client).

import type { ChildItem, StageName, Status } from '@spec-flow/shared';

// Rótulos legíveis por status (RFC seção 5). O client tem seu próprio STATUS_MAP
// com cores; aqui só precisamos do texto para o hero.
export const STATUS_LABELS: Record<Status, string> = {
  done: 'Concluída',
  prog: 'Em andamento',
  todo: 'A fazer',
};

// Deriva o status de um item a partir do seu percentual.
export function statusFromPct(pct: number): Status {
  if (pct >= 100) return 'done';
  if (pct > 0) return 'prog';
  return 'todo';
}

// Média simples dos % dos filhos, arredondada. Regra do épico (RFC seção 5).
export function meanPct(items: ChildItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, it) => acc + it.pct, 0);
  return Math.round(sum / items.length);
}

// Normaliza o nome cru de uma opção do campo de etapa do Projects v2 (com emoji,
// PT/EN — ex.: "📋 Spec", "Em Desenvolvimento", "Backlog Técnico") para o enum
// canônico StageName do RFC-003. Sem correspondência → null. A ordem dos testes
// importa: "code review" antes de "review"/"dev", "uat" antes de "qa" etc.
export function normalizeStage(raw: string | null | undefined): StageName | null {
  if (!raw) return null;
  const s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos ("homologação" → "homologacao")
    .replace(/[^a-zA-Z ]/g, ' ') // remove emoji/pontuação
    .toLowerCase()
    .trim();

  if (/code\s*review|revisao de codigo|\bpr\b/.test(s)) return 'Code Review';
  if (/\buat\b|homologacao|acceptance|aceitacao/.test(s)) return 'UAT';
  if (/\bqa\b|quality|teste/.test(s)) return 'QA';
  if (/done|conclu|finaliz|complete|shipped|entregue/.test(s)) return 'Done';
  if (/prioriz|priorit/.test(s)) return 'Priorizado';
  if (/ready|pronto/.test(s)) return 'Ready';
  if (/dev|progress|andamento|doing|execucao|wip/.test(s)) return 'Development';
  if (/spec|especificacao/.test(s)) return 'Spec';
  if (/plan|planej/.test(s)) return 'Plan';
  if (/backlog|todo|a fazer|triage|ideia|idea/.test(s)) return 'Backlog';
  return null;
}
