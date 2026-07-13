import { useEffect, useState } from 'react';
import { DASHBOARD_HREF, parseHash, type Route } from './lib/router';
import { DashboardPage } from './components/DashboardPage';
import { RepositoryFormPage } from './components/RepositoryFormPage';
import { RepoEpicsScreen } from './components/RepoEpicsScreen';
import { WorkItemScreen } from './components/WorkItemScreen';
import { SettingsPage } from './components/SettingsPage';
import { InviteAcceptPage } from './components/InviteAcceptPage';
import { WorkspaceLayout } from './components/workspace/WorkspaceLayout';

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  // Canoniza a URL no primeiro mount (raiz → #/dashboard) e segue mudanças de hash.
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = DASHBOARD_HREF;
    }
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (route.view === 'dashboard') {
    return <DashboardPage />;
  }

  if (route.view === 'workspace') {
    // `key` por papel remonta o shell na troca de papel (reinicia página/estado).
    return (
      <WorkspaceLayout
        key={route.role}
        role={route.role}
        page={route.page}
        query={route.query}
      />
    );
  }

  if (route.view === 'settings') {
    return <SettingsPage />;
  }

  if (route.view === 'invite') {
    return <InviteAcceptPage key={route.code} code={route.code} />;
  }

  if (route.view === 'repo-new') {
    return <RepositoryFormPage />;
  }

  if (route.view === 'repo-edit') {
    return <RepositoryFormPage key={route.repoId} repoId={route.repoId} />;
  }

  if (route.view === 'repo-epics') {
    return <RepoEpicsScreen key={route.repoId} repoId={route.repoId} />;
  }

  // `key` força remontar a tela ao trocar de item (reinicia o estado de carga).
  return (
    <WorkItemScreen
      key={`${route.repoId}/${route.level}/${route.number}`}
      repoId={route.repoId}
      level={route.level}
      number={route.number}
    />
  );
}
