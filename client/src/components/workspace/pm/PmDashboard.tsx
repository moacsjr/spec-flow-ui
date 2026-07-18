// Dashboard do PM (spec "Homologação e Dashboard" parte 2): a primeira tela do
// dia, em duas metades — MINHAS FILAS (cards navegáveis com limiares) e SAÚDE
// DO PROJETO (releases, funil de features, entregas D4, velocidade). 100%
// leitura, tudo derivado do snapshot + endpoints existentes; a faixa de insight
// agrega as condições já especificadas nas telas de origem, com precedência.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MilestoneSummary, SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { AiSummary } from '../AiSummary';
import { hrefForWorkspace } from '../../../lib/router';
import { isOpen } from '../../../lib/workspaceSelectors';
import { parseMilestoneMeta } from '../../../lib/milestoneMeta';
import { typeSlug } from '../../../lib/workItemType';
import { fetchSpecStatus } from '../../../data/workspace';
import { daysFrom, useStageAges } from '../tech/executionShared';

const DAY = 86_400_000;
const CHANGES_REQUESTED_LABEL = 'spec:changes-requested';
// Limiares (reuso das specs de origem): triagem 30d, WIP de specs 4/8,
// devolvidas paradas 3d, homologação 5d.
const BACKLOG_AGE_DAYS = 30;
const WIP_WARN = 4;
const WIP_DANGER = 8;
const RETURNED_STALL_DAYS = 3;
const UAT_AGE_DAYS = 5;

type Level = 'neutral' | 'warning' | 'danger';

const isExec = (i: SnapshotItem): boolean => typeSlug(i) === 'story' || typeSlug(i) === 'bug';

interface ReleaseRow {
  m: MilestoneSummary;
  donePts: number;
  totalPts: number;
  status: 'planejada' | 'andamento' | 'atrasada';
  delayDays: number | null; // projeção: dias além da ETA; null = sem dados
}

// Projeção de risco (reuso do cálculo da spec Milestones §4.1): ritmo = pontos
// entregues desde o início ÷ dias corridos; atraso projetado = quanto o
// restante, nesse ritmo, passa da ETA.
function projectDelay(m: MilestoneSummary, donePts: number, totalPts: number): number | null {
  const meta = parseMilestoneMeta(m.description);
  if (!meta.start || !m.dueOn || donePts <= 0 || totalPts <= donePts) return null;
  const elapsed = (Date.now() - Date.parse(`${meta.start}T00:00:00Z`)) / DAY;
  if (elapsed <= 0) return null;
  const pace = donePts / elapsed;
  const projectedEnd = Date.now() + ((totalPts - donePts) / pace) * DAY;
  const delay = Math.ceil((projectedEnd - Date.parse(m.dueOn)) / DAY);
  return delay > 0 ? delay : null;
}

export function PmDashboard({ repoId, snapshot }: WorkspacePageProps) {
  const items = snapshot.items;
  const features = useMemo(() => items.filter((i) => typeSlug(i) === 'feature'), [items]);
  const openFeatures = useMemo(() => features.filter(isOpen), [features]);
  const uatAges = useStageAges(repoId, 'UAT', snapshot.generatedAt);
  const specAges = useStageAges(repoId, 'Spec', snapshot.generatedAt);

  // ---- fila de specs (com spec.md — mesma checagem da Prioritization) ----
  const [specReady, setSpecReady] = useState<Map<number, boolean>>(new Map());
  const specCheckDone = useRef<Set<number>>(new Set());
  const specStageFeatures = useMemo(
    () =>
      openFeatures.filter(
        (i) => i.stage === 'Spec' && !i.labels.includes(CHANGES_REQUESTED_LABEL),
      ),
    [openFeatures],
  );
  useEffect(() => {
    for (const item of specStageFeatures) {
      if (specCheckDone.current.has(item.number)) continue;
      specCheckDone.current.add(item.number);
      fetchSpecStatus(repoId, item.number)
        .then((st) => setSpecReady((m) => new Map(m).set(item.number, st.hasSpec)))
        .catch(() => undefined);
    }
  }, [specStageFeatures, repoId]);

  // ---- Linha 1: minhas filas ----
  const backlogInbox = openFeatures.filter((i) => i.stage === 'Backlog' || i.stage === null);
  const backlogAging = backlogInbox.filter((i) => daysFrom(i.createdAt) > BACKLOG_AGE_DAYS).length;
  const reviewQueue = specStageFeatures.filter((i) => specReady.get(i.number) === true).length;
  const wipLevel: Level =
    reviewQueue >= WIP_DANGER ? 'danger' : reviewQueue >= WIP_WARN ? 'warning' : 'neutral';
  const returned = openFeatures.filter((i) => i.labels.includes(CHANGES_REQUESTED_LABEL));
  const inUat = items.filter((i) => typeSlug(i) === 'story' && isOpen(i) && i.stage === 'UAT');
  const uatAging = inUat.filter((i) => {
    const a = uatAges.get(i.number);
    return a && daysFrom(a.at) > UAT_AGE_DAYS;
  }).length;

  const queueCards: { label: string; value: number; page: string; level: Level; hint?: string }[] = [
    {
      label: 'Backlog a triar',
      value: backlogInbox.length,
      page: 'backlog',
      level: backlogAging > 0 ? 'warning' : 'neutral',
      hint: backlogAging > 0 ? `${backlogAging} há mais de 30d` : undefined,
    },
    {
      label: 'Specs a revisar',
      value: reviewQueue,
      page: 'specification',
      level: wipLevel,
      hint: wipLevel !== 'neutral' ? `limite saudável: ${WIP_WARN}` : undefined,
    },
    {
      label: 'Devolvidas',
      value: returned.length,
      page: 'specification',
      level: returned.length > 0 ? 'danger' : 'neutral',
    },
    {
      label: 'Homologações',
      value: inUat.length,
      page: 'homologation',
      level: uatAging > 0 ? 'warning' : 'neutral',
      hint: uatAging > 0 ? `${uatAging} há mais de 5d` : undefined,
    },
  ];

  // ---- Linha 2: saúde do projeto ----

  const releases = useMemo((): ReleaseRow[] => {
    const today = Date.now();
    return snapshot.milestones
      .filter((m) => m.state === 'open')
      .sort((a, b) => ((a.dueOn ?? '9999') < (b.dueOn ?? '9999') ? -1 : 1))
      .map((m) => {
        const scoped = items.filter((i) => isExec(i) && i.milestone?.number === m.number);
        const totalPts = scoped.reduce((s, i) => s + (i.points ?? 0), 0);
        const donePts = scoped
          .filter((i) => i.state === 'closed' || i.stage === 'Done')
          .reduce((s, i) => s + (i.points ?? 0), 0);
        const status =
          m.dueOn && Date.parse(m.dueOn) < today
            ? ('atrasada' as const)
            : m.closedCount > 0
              ? ('andamento' as const)
              : ('planejada' as const);
        return { m, donePts, totalPts, status, delayDays: projectDelay(m, donePts, totalPts) };
      });
  }, [snapshot.milestones, items]);

  // Funil de Features por etapa (gargalos num relance).
  const funnel: { label: string; count: number; page: string }[] = [
    { label: 'Backlog', count: backlogInbox.length, page: 'backlog' },
    {
      label: 'Priorizado',
      count: openFeatures.filter((i) => i.stage === 'Priorizado').length,
      page: 'prioritization',
    },
    {
      label: 'Spec',
      count: openFeatures.filter((i) => i.stage === 'Spec').length,
      page: 'specification',
    },
    {
      label: 'Plan',
      count: openFeatures.filter((i) => i.stage === 'Plan').length,
      page: 'planning',
    },
    {
      label: 'Ready / Em execução',
      count: openFeatures.filter(
        (i) =>
          i.stage != null && ['Ready', 'Development', 'Code Review', 'QA', 'UAT'].includes(i.stage),
      ).length,
      page: 'progress',
    },
  ];
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));

  // Entregas: Features fechadas (D4) nos últimos 30 dias.
  const delivered = useMemo(
    () =>
      features
        .filter(
          (i) =>
            i.state === 'closed' &&
            i.closedAt != null &&
            Date.now() - Date.parse(i.closedAt) <= 30 * DAY,
        )
        .sort((a, b) => ((a.closedAt ?? '') > (b.closedAt ?? '') ? -1 : 1)),
    [features],
  );

  // Velocidade: pts/release média histórica (milestones fechados, mínimo 2).
  const velocity = useMemo((): number | null => {
    const closed = snapshot.milestones.filter((m) => m.state === 'closed');
    if (closed.length < 2) return null;
    const ptsOf = (m: MilestoneSummary) =>
      items
        .filter((i) => isExec(i) && i.milestone?.number === m.number)
        .reduce((s, i) => s + (i.points ?? 0), 0);
    return Math.round(closed.reduce((s, m) => s + ptsOf(m), 0) / closed.length);
  }, [snapshot.milestones, items]);

  // ---- faixa de insight (precedência; máx. 1) ----
  const insight = useMemo((): { text: string; danger: boolean } | null => {
    const risky = releases.find((r) => r.delayDays != null);
    if (risky) {
      return {
        text: `Release ${risky.m.title} projeta +${risky.delayDays}d além da ETA no ritmo atual.`,
        danger: true,
      };
    }
    if (wipLevel === 'danger') {
      return {
        text: `A fila de specs está em ${reviewQueue} — revisar antes de priorizar mais.`,
        danger: true,
      };
    }
    const stalled = returned.filter((i) => {
      const a = specAges.get(i.number);
      return a && daysFrom(a.at) > RETURNED_STALL_DAYS;
    }).length;
    if (stalled > 0) {
      return {
        text: `${stalled} ${stalled === 1 ? 'spec devolvida está' : 'specs devolvidas estão'} sem retrabalho há mais de ${RETURNED_STALL_DAYS} dias.`,
        danger: false,
      };
    }
    if (backlogAging > 0) {
      return {
        text: `${backlogAging} ${backlogAging === 1 ? 'feature está' : 'features estão'} há mais de 30 dias sem triagem.`,
        danger: false,
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releases, wipLevel, reviewQueue, returned, specAges, backlogAging]);

  const freshProject = features.length === 0;

  return (
    <div className="ws-page">
      {/* Linha 1 — minhas filas */}
      <div className="widgets">
        {queueCards.map((c) => (
          <a
            key={c.label}
            className={`widget dv-card${c.level !== 'neutral' ? ` pm-card--${c.level}` : ''}`}
            href={hrefForWorkspace('pm', c.page)}
          >
            <span className="widget__value">{c.value}</span>
            <span className="widget__label">{c.label}</span>
            {c.hint && <span className="widget__hint">{c.hint}</span>}
          </a>
        ))}
      </div>

      {insight && (
        <div className={`bl-insights${insight.danger ? ' pr-insights--danger' : ''}`}>
          💡 {insight.text}
        </div>
      )}

      {freshProject ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">🌱</span>
          <p>Projeto recém-configurado.</p>
          <a className="btn btn--accent btn--sm" href={hrefForWorkspace('pm', 'backlog')}>
            Comece criando features no Backlog
          </a>
        </div>
      ) : (
        <div className="pm-health">
          {/* Releases */}
          <section className="pm-block">
            <h3 className="pm-block__title">Releases</h3>
            {releases.length === 0 ? (
              <div className="pm-block__empty">
                Sem milestones abertos.{' '}
                <a href={hrefForWorkspace('pm', 'planning')}>Planejar release →</a>
              </div>
            ) : (
              <ul className="pm-releases">
                {releases.map((r) => {
                  const pct =
                    r.totalPts > 0 ? Math.round((r.donePts / r.totalPts) * 100) : 0;
                  return (
                    <li key={r.m.number}>
                      <a className="pm-release" href={hrefForWorkspace('pm', 'milestones')}>
                        <span className="pm-release__name" title={r.m.title}>
                          {r.m.title}
                        </span>
                        <span className="pm-release__bar">
                          <span className="pm-release__fill" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="mono pm-release__pts">
                          {r.donePts}/{r.totalPts} pts
                        </span>
                        <span className={`pm-release__status pm-release__status--${r.status}`}>
                          {r.status === 'andamento' ? 'em execução' : r.status}
                        </span>
                        {r.delayDays != null && (
                          <span className="pm-release__risk">+{r.delayDays}d</span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Funil de Features */}
          <section className="pm-block">
            <h3 className="pm-block__title">Funil de Features</h3>
            <ul className="pm-funnel">
              {funnel.map((f) => (
                <li key={f.label}>
                  <a className="pm-funnel__row" href={hrefForWorkspace('pm', f.page)}>
                    <span className="pm-funnel__label">{f.label}</span>
                    <span className="pm-funnel__track">
                      <span
                        className="pm-funnel__bar"
                        style={{ width: `${Math.round((f.count / funnelMax) * 100)}%` }}
                      />
                    </span>
                    <span className="mono pm-funnel__count">{f.count}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* Entregas (D4, 30 dias) */}
          <section className="pm-block">
            <h3 className="pm-block__title">
              Entregas <span className="pm-block__sub">últimos 30 dias</span>
            </h3>
            <p className="pm-big">{delivered.length}</p>
            {delivered.length > 0 ? (
              <ul className="pm-delivered">
                {delivered.slice(0, 5).map((f) => (
                  <li key={f.number}>
                    <a href={f.url} target="_blank" rel="noreferrer" title={f.title}>
                      <span className="mono">#{f.number}</span> {f.title}
                    </a>
                    <span className="pm-delivered__date">{f.closedAt?.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pm-block__empty">Nenhuma feature concluída no período.</p>
            )}
          </section>

          {/* Velocidade */}
          <section className="pm-block">
            <h3 className="pm-block__title">
              Velocidade <span className="pm-block__sub">pts/release (média)</span>
            </h3>
            <p className="pm-big">{velocity ?? '—'}</p>
            {velocity == null && (
              <p className="pm-block__empty">Sem histórico mínimo (2 releases fechadas).</p>
            )}
          </section>
        </div>
      )}

      <AiSummary repoId={repoId} scope="pm-progress" title="Resumo do projeto" />
    </div>
  );
}
