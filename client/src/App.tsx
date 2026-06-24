import { useEffect, useState } from 'react';
import { DASHBOARD_HREF, parseHash, type Route } from './lib/router';
import { DashboardPage } from './components/DashboardPage';
import { RepoEpicsScreen } from './components/RepoEpicsScreen';
import { WorkItemScreen } from './components/WorkItemScreen';

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
