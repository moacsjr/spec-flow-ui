// Planos e limites (fase 3). O plano vive no item TENANT# (atualizado pelo
// webhook do Stripe); os limites são aplicados no código (cota de refine via
// contador atômico no Dynamo, cota de repositórios no cadastro).

export interface PlanLimits {
  maxRepos: number;
  refinesPerMonth: number;
  maxMembers: number;
}

export const PLANS: Record<string, PlanLimits> = {
  free: { maxRepos: 2, refinesPerMonth: 20, maxMembers: 10 },
  pro: { maxRepos: 25, refinesPerMonth: 500, maxMembers: 25 },
};

// Plano desconhecido/legado degrada para free (nunca libera mais do que pagou).
export function planLimits(plan: string | undefined): PlanLimits {
  return PLANS[plan ?? 'free'] ?? PLANS.free;
}

// Mês corrente em UTC ("2026-07") — chave do contador USAGE#<mês>.
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}
