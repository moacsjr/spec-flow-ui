// Props comuns das páginas de workspace (RFC-003). Cada página é um filtro/
// agrupamento client-side sobre o mesmo ProjectSnapshot; mutações chamam a API
// e depois `refresh()` (releitura fresh em background).

import type { ProjectSnapshot, WorkspaceRole } from '@spec-flow/shared';

export interface WorkspacePageProps {
  role: WorkspaceRole;
  repoId: string;
  snapshot: ProjectSnapshot;
  milestoneNumber: number | null; // milestone corrente (papel dev); null = todos
  query?: Record<string, string>; // filtros vindos do hash (ex.: ?milestone=3)
  refresh: () => void;
}
