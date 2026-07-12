// Identidade visual do tipo de work item (estilo Jira/Linear: um ícone com a
// inicial do tipo, colado ao identificador do item). A COR de cada tipo mora no
// CSS (`.type-badge--<tipo>` em app.css); aqui ficam só a letra e o rótulo.
//
// Cores (ver app.css): Initiative roxo · Epic violeta · Feature verde ·
// Story azul · Task cinza (Bug/Spike caem em tons próprios, fora da hierarquia).

import type { WorkItemType } from '@spec-flow/shared';

export interface TypeBadgeInfo {
  letter: string; // glifo no ícone (inicial do tipo)
  label: string; // nome do tipo (title/aria-label)
}

export const TYPE_BADGE: Record<WorkItemType, TypeBadgeInfo> = {
  initiative: { letter: 'I', label: 'Initiative' },
  epic: { letter: 'E', label: 'Epic' },
  feature: { letter: 'F', label: 'Feature' },
  story: { letter: 'S', label: 'Story' },
  task: { letter: 'T', label: 'Task' },
  bug: { letter: 'B', label: 'Bug' },
  spike: { letter: 'K', label: 'Spike' },
};
