// Shell dos workspaces (RFC-003): sidebar por papel + topbar compartilhado +
// página corrente. Carrega o snapshot do repositório selecionado UMA vez e
// injeta em todas as páginas (que filtram client-side). Papel vem da URL;
// repositório/milestone vivem no WorkspaceContext (localStorage).

import { useEffect } from 'react';
import type { ComponentType } from 'react';
import type { WorkspaceRole } from '@spec-flow/shared';
import { useRepositories } from '../../hooks/useRepositories';
import { useProjectSnapshot } from '../../hooks/useProjectSnapshot';
import {
  rememberWorkspaceRole,
  useWorkspace,
  WorkspaceProvider,
} from '../../state/WorkspaceContext';
import { isWorkspacePage, WORKSPACE_NAV } from '../../lib/workspaceNav';
import { hrefForWorkspace, REPO_NEW_HREF } from '../../lib/router';
import { useMe } from '../../hooks/useMe';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceTopbar } from './WorkspaceTopbar';
import type { WorkspacePageProps } from './types';

import { PmDashboard } from './pm/PmDashboard';
import { ProjectPage } from './pm/ProjectPage';
import { BacklogPage } from './pm/BacklogPage';
import { PrioritizationPage } from './pm/PrioritizationPage';
import { SpecificationPage as PmSpecificationPage } from './pm/SpecificationPage';
import { PlanningPage } from './pm/PlanningPage';
import { MilestonesTimelinePage } from './pm/MilestonesTimelinePage';
import { HomologationPage } from './pm/HomologationPage';
import { PmProgressPage } from './pm/ProgressPage';
import { TechDashboard } from './tech/TechDashboard';
import { SpecificationPage } from './tech/SpecificationPage';
import { TechnicalReviewPage } from './tech/TechnicalReviewPage';
import { TechnicalBacklogPage } from './tech/TechnicalBacklogPage';
import { DevelopmentPage } from './tech/DevelopmentPage';
import { TechCodeReviewPage } from './tech/CodeReviewPage';
import { TechQaPage } from './tech/QaPage';
import { UatPage } from './tech/UatPage';
import { TechProgressPage } from './tech/ProgressPage';
import { autoPickMilestone } from './dev/devShared';
import { DevDashboard } from './dev/DevDashboard';
import { PendingPage } from './dev/PendingPage';
import { InProgressPage } from './dev/InProgressPage';
import { DevCodeReviewPage } from './dev/CodeReviewPage';
import { DevQaPage } from './dev/QaPage';
import { DevProgressPage } from './dev/ProgressPage';

const PAGES: Record<WorkspaceRole, Record<string, ComponentType<WorkspacePageProps>>> = {
  pm: {
    dashboard: PmDashboard,
    project: ProjectPage,
    backlog: BacklogPage,
    prioritization: PrioritizationPage,
    specification: PmSpecificationPage,
    planning: PlanningPage,
    milestones: MilestonesTimelinePage,
    homologation: HomologationPage,
    progress: PmProgressPage,
  },
  tech: {
    dashboard: TechDashboard,
    specification: SpecificationPage,
    'technical-review': TechnicalReviewPage,
    'technical-backlog': TechnicalBacklogPage,
    development: DevelopmentPage,
    'code-review': TechCodeReviewPage,
    qa: TechQaPage,
    uat: UatPage,
    progress: TechProgressPage,
  },
  dev: {
    dashboard: DevDashboard,
    pending: PendingPage,
    'in-progress': InProgressPage,
    'code-review': DevCodeReviewPage,
    qa: DevQaPage,
    progress: DevProgressPage,
  },
};

interface WorkspaceLayoutProps {
  role: WorkspaceRole;
  page: string;
  query?: Record<string, string>;
}

function WorkspaceShell({ role, page: rawPage, query }: WorkspaceLayoutProps) {
  const page = isWorkspacePage(role, rawPage) ? rawPage : 'dashboard';
  const { repoId, setRepoId, milestoneNumber, setMilestoneNumber } = useWorkspace();
  const repos = useRepositories();
  const { me } = useMe();

  // Papéis reais (spec Gestão de usuários §4.1): com enforcement ativo, o
  // switcher/URL só pode assumir papéis possuídos no repositório corrente —
  // papel não possuído redireciona para o primeiro possuído (root vê todos).
  const myRepoRoles =
    me?.enforced && !me.isRoot && repoId
      ? (me.roles.find((r) => r.repoId === repoId)?.roles ?? [])
      : null; // null = sem restrição
  useEffect(() => {
    if (myRepoRoles && myRepoRoles.length > 0 && !myRepoRoles.includes(role)) {
      window.location.hash = hrefForWorkspace(myRepoRoles[0] as WorkspaceRole, 'dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRepoRoles?.join(','), role]);

  // Lembra o papel para o link "Abrir workspace" das outras telas.
  useEffect(() => rememberWorkspaceRole(role), [role]);

  // Sem repositório escolhido (ou escolhido não existe mais) → primeiro da lista.
  const repositories = repos.state.phase === 'ready' ? repos.state.repositories : [];
  const validRepoId = repositories.some((r) => r.id === repoId) ? repoId : null;
  useEffect(() => {
    if (repos.state.phase === 'ready' && !validRepoId && repositories[0]) {
      setRepoId(repositories[0].id);
    }
  }, [repos.state.phase, validRepoId, repositories, setRepoId]);

  const { state, retry, refresh } = useProjectSnapshot(validRepoId);
  const snapshot = state.phase === 'ready' ? state.snapshot : null;

  // Auto-seleção do milestone corrente (papel dev): sem seleção válida, escolhe
  // o Em execução de ETA mais próxima (senão o Planejada de início mais próximo).
  useEffect(() => {
    if (role !== 'dev' || !snapshot) return;
    const openOk = snapshot.milestones.some(
      (m) => m.state === 'open' && m.number === milestoneNumber,
    );
    if (openOk) return;
    const pick = autoPickMilestone(snapshot.milestones);
    if (pick != null && pick !== milestoneNumber) setMilestoneNumber(pick);
  }, [role, snapshot, milestoneNumber, setMilestoneNumber]);

  const label = WORKSPACE_NAV[role].find((n) => n.page === page)?.label ?? page;
  const Page = PAGES[role][page];

  // Autenticado sem nenhum papel e não-root (spec §2): sem acesso.
  if (me?.enforced && !me.isRoot && me.roles.length === 0) {
    return (
      <div className="ws">
        <main className="ws-content" style={{ margin: 'auto' }}>
          <div className="repo-empty">
            <div className="repo-empty__art" aria-hidden="true">🔒</div>
            <p className="repo-empty__title">Sem acesso — peça a um administrador.</p>
            <p>
              Informe seu usuário: <code>{me.login ? `@${me.login}` : (me.email ?? '—')}</code>
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="ws">
      <WorkspaceSidebar role={role} page={page} />
      <div className="ws-main">
        {me && !me.enforced && me.isRoot && (
          <div className="ws-authbanner">
            🔓 Autenticação em modo de transição — papéis ainda não aplicados (AUTH_ENFORCED=false).
          </div>
        )}
        <WorkspaceTopbar
          role={role}
          page={page}
          repositories={repositories}
          repoId={validRepoId}
          onRepoChange={setRepoId}
          snapshot={snapshot}
          milestoneNumber={milestoneNumber}
          onMilestoneChange={setMilestoneNumber}
          refreshing={state.phase === 'ready' && state.refreshing}
          onRefresh={refresh}
        />

        <main className="ws-content">
          <h2 className="ws-content__title">{label}</h2>

          {repos.state.phase === 'error' && (
            <div className="repo-empty">
              <p className="repo-empty__title">Falha ao carregar repositórios</p>
              <button type="button" className="btn btn--accent" onClick={repos.retry}>
                Tentar novamente
              </button>
            </div>
          )}

          {repos.state.phase === 'ready' && repositories.length === 0 && (
            <div className="repo-empty">
              <div className="repo-empty__art" aria-hidden="true">📭</div>
              <p className="repo-empty__title">Conecte um repositório para usar o workspace</p>
              <a className="btn btn--accent" href={REPO_NEW_HREF}>
                Conectar repositório
              </a>
            </div>
          )}

          {validRepoId && state.phase === 'loading' && (
            <div className="ws-skeleton" aria-busy="true" aria-label="Carregando projeto">
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
              <div className="skeleton skeleton-card" />
            </div>
          )}

          {validRepoId && state.phase === 'error' && (
            <div className="repo-empty">
              <div className="repo-empty__art" aria-hidden="true">⚠️</div>
              <p className="repo-empty__title">{state.message}</p>
              <button type="button" className="btn btn--accent" onClick={retry}>
                Tentar novamente
              </button>
            </div>
          )}

          {validRepoId && snapshot && (
            <Page
              role={role}
              repoId={validRepoId}
              snapshot={snapshot}
              milestoneNumber={role === 'dev' ? milestoneNumber : null}
              query={query}
              refresh={refresh}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceShell {...props} />
    </WorkspaceProvider>
  );
}
