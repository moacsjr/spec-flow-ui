// Serviço de work item — orquestra a busca no GitHub + adaptação para
// WorkItemView. Sempre live (sem fixture). A identidade do repo vem da config
// recebida (montada a partir da linha do SQLite); o token vive só no servidor.

import type {
  CreatedWorkItem,
  CreateFeatureRequest,
  CreateWorkItemRequest,
  EpicSummary,
  Level,
  Priority,
  RepositoryEpics,
  StageName,
  WorkItemPatch,
  WorkItemType,
  WorkItemView,
} from '@spec-flow/shared';
import { isAllowedParent, PRIORITIES, WORK_ITEM_TYPES } from '@spec-flow/shared';
import {
  addLabel,
  addProjectItem,
  addSubIssue,
  createIssue,
  setSubIssueParent,
  fetchEpicPayload,
  fetchEpicSummaries,
  fetchFileContent,
  fetchIssueComments,
  fetchIssueRef,
  fetchIssueTitle,
  fetchIssueTree,
  fetchProjectItemId,
  fetchSingleSelectField,
  moveProjectStage,
  removeLabel,
  updateIssue,
  updateIssueState,
  type GitHubConfig,
} from '../github/client.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../lib/errors.ts';
import { normalizeStage } from '../lib/status.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { loadSnapshotForRepository } from './snapshotService.ts';
import {
  adaptEpic,
  adaptFeature,
  adaptStory,
  codeOf,
  parentFromBody,
  stripTypePrefix,
  teamOf,
  typePrefixOf,
} from '../github/adapter.ts';
import type { AdaptContext } from '../github/adapter.ts';
import { slugify } from '../lib/slugify.ts';
import { stripWrappingCodeFence } from '../lib/markdown.ts';
import {
  configForRepository,
  getRepositoryOr404,
  toRepositoryDTO,
} from './repositoryService.ts';

// Localiza spec.md/plan.md de forma resiliente a renomeações do título.
// O spec-wave comenta na issue o caminho `docs/features/<slug>/spec.md` (e plan)
// ao gerar os arquivos — o slug ali é congelado na geração. Lemos esse caminho
// dos comentários (o último vence, p/ o caso de regeração); sem comentário,
// caímos no slug derivado do título atual. spec e plan são resolvidos
// independentemente (podem ter sido gerados sob títulos diferentes).
export async function resolveFeaturePaths(
  config: GitHubConfig,
  number: number,
  title: string,
): Promise<{ specPath: string; planPath: string }> {
  const fallback = slugify(title);

  let comments: string[] = [];
  try {
    comments = await fetchIssueComments(config, number);
  } catch {
    /* comentários inacessíveis → usa o slug do título */
  }

  const slugOf = (file: 'spec' | 'plan'): string => {
    const re = new RegExp(`docs/features/([a-z0-9-]+)/${file}\\.md`, 'g');
    let slug = fallback;
    for (const body of comments) {
      for (const m of body.matchAll(re)) slug = m[1]; // último match (mais recente) vence
    }
    return slug;
  };

  return {
    specPath: `docs/features/${slugOf('spec')}/spec.md`,
    planPath: `docs/features/${slugOf('plan')}/plan.md`,
  };
}

// Carrega um work item a partir de uma config de repositório já resolvida.
export async function loadWorkItem(
  config: GitHubConfig,
  level: Level,
  number: number,
): Promise<WorkItemView> {
  if (level === 'epic') {
    return adaptEpic(await fetchEpicPayload({ ...config, issueNumber: number }), { team: config.team });
  }

  const issue = await fetchIssueTree(config, number);
  const ctx: AdaptContext = { team: config.team };

  // Pai (best-effort): o fetch de issue única não traz o pai pela API; tentamos
  // extrair do corpo (spec-flow escreve "_… pai: <url>_"). Sem isso, o breadcrumb
  // do ancestral fica sem link (degradação graciosa).
  const parentNum = parentFromBody(issue.body);
  if (parentNum) {
    const parentLevel: Level = level === 'feature' ? 'epic' : 'feature';
    ctx.parent = { level: parentLevel, number: parentNum, code: `#${parentNum}` };
  }

  if (level === 'feature') {
    const { specPath, planPath } = await resolveFeaturePaths(config, number, issue.title);
    const [spec, plan] = await Promise.all([
      fetchFileContent(config, specPath).catch(() => null),
      fetchFileContent(config, planPath).catch(() => null),
    ]);
    // Geradores às vezes embrulham o doc inteiro em ```markdown — desfaz p/ exibir.
    ctx.spec = stripWrappingCodeFence(spec);
    ctx.plan = stripWrappingCodeFence(plan);
    return adaptFeature(issue, ctx);
  }
  return adaptStory(issue, ctx);
}

// Resolve o repositório do tenant pelo id e carrega o work item naquele repo.
export async function loadWorkItemForRepository(
  tenantId: string,
  id: string,
  level: Level,
  number: number,
): Promise<WorkItemView> {
  const record = await getRepositoryOr404(tenantId, id);
  return loadWorkItem(await configForRepository(record), level, number);
}

// Aplica uma edição parcial (título/corpo) na issue e devolve o WorkItemView
// recarregado — assim o client substitui a view inteira com campos derivados
// recalculados. `descriptionMdx` mapeia para o `body` da issue no GitHub.
export async function updateWorkItem(
  config: GitHubConfig,
  level: Level,
  number: number,
  patch: WorkItemPatch,
): Promise<WorkItemView> {
  const gh: { title?: string; body?: string } = {};
  if (patch.title !== undefined) {
    // O título exibido (e editado) vem sem o prefixo de tipo (stripTypePrefix).
    // Reanexamos o prefixo original ("[FEATURE]" etc.) para não corrompê-lo no
    // GitHub — ele alimenta o spec-flow e o código do item.
    const prefix = typePrefixOf(await fetchIssueTitle(config, number));
    gh.title = prefix + patch.title;
  }
  if (patch.descriptionMdx !== undefined) gh.body = patch.descriptionMdx;

  await updateIssue(config, number, gh);
  return loadWorkItem(config, level, number);
}

// Resolve o repositório do tenant pelo id e edita o work item naquele repo.
export async function updateWorkItemForRepository(
  tenantId: string,
  id: string,
  level: Level,
  number: number,
  patch: WorkItemPatch,
): Promise<WorkItemView> {
  const record = await getRepositoryOr404(tenantId, id);
  const view = await updateWorkItem(await configForRepository(record), level, number, patch);
  invalidateSnapshot(tenantId, id);
  return view;
}

// Monta o corpo da Feature, espelhando o `spec-wave issue`: referência ao pai
// (que o parentFromBody do adapter reconhece para o breadcrumb) + descrição +
// bloco de metadados. Nunca vazio (o GitHub aceita, mas mantemos o padrão do CLI).
function buildFeatureBody(
  input: CreateFeatureRequest,
  parent: { number: number; title: string },
): string {
  const parts = [`**Parent:** #${parent.number} — ${parent.title}`];
  const desc = (input.descriptionMdx ?? '').trim();
  if (desc) parts.push(desc);
  const meta: string[] = [];
  if (input.area) meta.push(`- **Área:** ${input.area}`);
  if (input.priority) meta.push(`- **Prioridade:** ${input.priority}`);
  if (meta.length) parts.push(`## Metadados\n${meta.join('\n')}`);
  return parts.join('\n\n');
}

// Seta um campo single-select do board pelo nome (Work Item Type / Priority /
// Area), resolvendo o campo em runtime (não é persistido no SQLite). Best-effort:
// campo/opção ausente apenas loga.
async function setBoardSingleSelect(
  config: GitHubConfig,
  projectId: string,
  itemId: string,
  fieldName: string,
  optionName: string,
): Promise<void> {
  const field = await fetchSingleSelectField(config, projectId, fieldName);
  const optionId = field?.options[optionName];
  if (field && optionId) {
    await moveProjectStage(config, projectId, itemId, field.id, optionId);
  } else {
    logger.warn(
      `Projeto ${config.owner}/${config.repo}: campo "${fieldName}" ou opção "${optionName}" ausente — pulando.`,
    );
  }
}

// Adiciona a Feature ao Projects v2 e define Etapa (📥 Backlog), Work Item Type
// (Feature) e, quando informados, Priority/Area. Best-effort por completo: a
// ausência de projeto ou de campos não impede a criação da feature.
async function addFeatureToBoard(
  config: GitHubConfig,
  contentNodeId: string,
  input: CreateFeatureRequest,
): Promise<void> {
  const project = config.project;
  if (!project) return; // repositório sem Projects v2 configurado
  const itemId = await addProjectItem(config, project.projectId, contentNodeId);

  // Etapa inicial = 📥 Backlog (a partir das opções já persistidas no cadastro).
  const backlog = Object.entries(project.stageOptions).find(([name]) => /backlog/i.test(name));
  if (backlog) {
    await moveProjectStage(config, project.projectId, itemId, project.etapaFieldId, backlog[1]);
  } else {
    logger.warn(`Projeto ${config.owner}/${config.repo} sem etapa "Backlog" para a nova feature.`);
  }

  await setBoardSingleSelect(config, project.projectId, itemId, 'Work Item Type', 'Feature');
  if (input.priority) {
    await setBoardSingleSelect(config, project.projectId, itemId, 'Priority', input.priority);
  }
  if (input.area) {
    await setBoardSingleSelect(config, project.projectId, itemId, 'Area', input.area);
  }
}

// Cria uma Feature sob um Épico: cria a issue [FEATURE] (label + prefixo no
// título), a vincula como sub-issue do épico (vínculo essencial — é o que a faz
// aparecer na lista) e adiciona ao Projects v2 (best-effort). Devolve o
// WorkItemView do épico recarregado, já com a nova feature entre os filhos.
export async function createFeatureForRepository(
  tenantId: string,
  id: string,
  epicNumber: number,
  input: CreateFeatureRequest,
): Promise<WorkItemView> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));

  // Node id + título do épico (para o vínculo e a referência ao pai no corpo).
  const epic = await fetchIssueRef(config, epicNumber);

  const labels = ['[FEATURE]'];
  if (input.priority) labels.push(input.priority);
  if (input.area) labels.push(input.area);

  const created = await createIssue(config, {
    title: `[FEATURE] ${input.title.trim()}`,
    body: buildFeatureBody(input, { number: epicNumber, title: stripTypePrefix(epic.title) }),
    labels,
  });

  // Vínculo nativo de sub-issue: sem ele a feature não aparece sob o épico.
  await addSubIssue(config, epic.nodeId, created.nodeId);

  // Board: best-effort (não derruba a criação se falhar).
  await addFeatureToBoard(config, created.nodeId, input).catch((err) => {
    logger.warn(
      `Feature #${created.number} criada, mas falhou ao configurar o board: ${(err as Error).message}`,
    );
  });

  invalidateSnapshot(tenantId, id);
  return loadWorkItem(config, 'epic', epicNumber);
}

// --- Criação genérica de work item (tela Project do PM) ---

// Tipo → label de tipo do spec-wave e opção do campo "Work Item Type" no board.
const TYPE_LABEL: Record<WorkItemType, string> = {
  initiative: '[INITIATIVE]',
  epic: '[EPIC]',
  feature: '[FEATURE]',
  story: '[STORY]',
  task: '[TASK]',
  bug: '[BUG]',
  spike: '[SPIKE]',
};
const TYPE_BOARD_OPTION: Record<WorkItemType, string> = {
  initiative: 'Initiative',
  epic: 'Epic',
  feature: 'Feature',
  story: 'Story',
  task: 'Task',
  bug: 'Bug',
  spike: 'Spike',
};

// Corpo padrão (mesmo shape do CLI): referência ao pai (que o parentFromBody
// reconhece p/ o breadcrumb) + descrição + bloco de metadados. Pode ser vazio.
function buildWorkItemBody(
  input: CreateWorkItemRequest,
  parent: { number: number; title: string } | null,
): string {
  const parts: string[] = [];
  if (parent) parts.push(`**Parent:** #${parent.number} — ${parent.title}`);
  const desc = (input.descriptionMdx ?? '').trim();
  if (desc) parts.push(desc);
  const meta: string[] = [];
  if (input.area) meta.push(`- **Área:** ${input.area}`);
  if (input.priority) meta.push(`- **Prioridade:** ${input.priority}`);
  if (meta.length) parts.push(`## Metadados\n${meta.join('\n')}`);
  return parts.join('\n\n');
}

// Board: adiciona ao Projects v2 e define Etapa (📥 Backlog), Work Item Type e,
// quando informados, Priority/Area. Best-effort (não derruba a criação).
async function addWorkItemToBoard(
  config: GitHubConfig,
  contentNodeId: string,
  type: WorkItemType,
  input: CreateWorkItemRequest,
): Promise<void> {
  const project = config.project;
  if (!project) return; // repositório sem Projects v2 configurado
  const itemId = await addProjectItem(config, project.projectId, contentNodeId);

  const backlog = Object.entries(project.stageOptions).find(([name]) => /backlog/i.test(name));
  if (backlog) {
    await moveProjectStage(config, project.projectId, itemId, project.etapaFieldId, backlog[1]);
  } else {
    logger.warn(`Projeto ${config.owner}/${config.repo} sem etapa "Backlog" para o novo item.`);
  }

  await setBoardSingleSelect(config, project.projectId, itemId, 'Work Item Type', TYPE_BOARD_OPTION[type]);
  if (input.priority) {
    await setBoardSingleSelect(config, project.projectId, itemId, 'Priority', input.priority);
  }
  if (input.area) {
    await setBoardSingleSelect(config, project.projectId, itemId, 'Area', input.area);
  }
}

// Cria um work item de QUALQUER tipo: issue com label de tipo (+ prefixo no
// título), vínculo nativo de sub-issue quando há parentNumber e adição ao
// Projects v2 (best-effort). Invalida o snapshot; devolve número + URL.
export async function createWorkItemForRepository(
  tenantId: string,
  id: string,
  input: CreateWorkItemRequest,
): Promise<CreatedWorkItem> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  const type = input.type;

  const labels = [TYPE_LABEL[type]];
  if (input.priority) labels.push(input.priority);
  if (input.area) labels.push(input.area);

  // Node id + título do pai (para o vínculo e a referência no corpo).
  let parent: { number: number; title: string; nodeId: string } | null = null;
  if (input.parentNumber) {
    const ref = await fetchIssueRef(config, input.parentNumber);
    parent = { number: input.parentNumber, title: stripTypePrefix(ref.title), nodeId: ref.nodeId };
  }

  const created = await createIssue(config, {
    title: `${TYPE_LABEL[type]} ${input.title.trim()}`,
    body: buildWorkItemBody(input, parent),
    labels,
  });

  // Vínculo nativo de sub-issue: sem ele o filho não aparece sob o pai.
  if (parent) {
    await addSubIssue(config, parent.nodeId, created.nodeId);
  }

  await addWorkItemToBoard(config, created.nodeId, type, input).catch((err) => {
    logger.warn(
      `Issue #${created.number} criada, mas falhou ao configurar o board: ${(err as Error).message}`,
    );
  });

  invalidateSnapshot(tenantId, id);
  return {
    number: created.number,
    url: `https://github.com/${config.owner}/${config.repo}/issues/${created.number}`,
  };
}

// Tipo do work item a partir do prefixo do título ("[TASK] …" → 'task').
function typeFromTitle(title: string): WorkItemType | null {
  const m = title.match(/^\s*\[([A-Z]+)\]/);
  const t = m?.[1]?.toLowerCase();
  return t && (WORK_ITEM_TYPES as string[]).includes(t) ? (t as WorkItemType) : null;
}

// Reparent (drag-and-drop da árvore): define `parentNumber` como pai de
// `childNumber` via sub-issue nativa, validando a hierarquia permitida. Os tipos
// vêm do prefixo do título das issues. O GitHub rejeita ciclos.
export async function setWorkItemParentForRepository(
  tenantId: string,
  id: string,
  childNumber: number,
  parentNumber: number,
): Promise<void> {
  if (childNumber === parentNumber) {
    throw new HttpError(400, 'Um item não pode ser pai de si mesmo.');
  }
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));

  const [child, parent] = await Promise.all([
    fetchIssueRef(config, childNumber),
    fetchIssueRef(config, parentNumber),
  ]);
  const childType = typeFromTitle(child.title);
  const parentType = typeFromTitle(parent.title);
  if (!childType || !parentType) {
    throw new HttpError(400, 'Não foi possível determinar o tipo dos itens (prefixo ausente).');
  }
  if (!isAllowedParent(parentType, childType)) {
    throw new HttpError(
      422,
      `Hierarquia não permitida: ${parentType} não pode ser pai de ${childType}.`,
    );
  }

  await setSubIssueParent(config, parent.nodeId, child.nodeId);
  invalidateSnapshot(tenantId, id);
}

// --- Mutações de workspace (RFC-003) ---

// Define/remove a prioridade de um work item: swap dos labels P0–P3 (fonte de
// verdade) + best-effort no campo "Priority" do board. Invalida o snapshot.
export async function setPriorityForRepository(
  tenantId: string,
  id: string,
  number: number,
  priority: Priority | null,
): Promise<void> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));

  // Remove os demais P-labels (idempotente: ausente = no-op) e aplica o novo.
  for (const p of PRIORITIES) {
    if (p !== priority) await removeLabel(config, number, p);
  }
  if (priority) await addLabel(config, number, priority);

  // Board (best-effort): espelha no campo single-select "Priority" se existir.
  if (priority && config.project) {
    try {
      const itemId = await fetchProjectItemId(config, number, config.project.projectId);
      if (itemId) {
        const field = await fetchSingleSelectField(config, config.project.projectId, 'Priority');
        const optionId = field?.options[priority];
        if (field && optionId) {
          await moveProjectStage(config, config.project.projectId, itemId, field.id, optionId);
        }
      }
    } catch (err) {
      logger.warn(
        `Issue #${number}: prioridade aplicada nos labels, mas falhou no board: ${(err as Error).message}`,
      );
    }
  }

  invalidateSnapshot(tenantId, id);
}

// Label que sinaliza ao agente de IA que a Story deve entrar em desenvolvimento.
const DEV_AGENT_LABEL = 'spec-wave:dev-agent';

// "Iniciar Desenvolvimento" (Story View): aplica o label spec-wave:dev-agent na
// Story — o agente de IA observa esse label e assume o desenvolvimento. Idempotente
// (addLabel não duplica). Devolve o WorkItemView recarregado (já com
// devAgentRequested=true) para a UI trocar o CTA por "Aguardando Agente IA".
export async function startDevelopmentForRepository(
  tenantId: string,
  id: string,
  number: number,
): Promise<WorkItemView> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  await addLabel(config, number, DEV_AGENT_LABEL);
  invalidateSnapshot(tenantId, id);
  return loadWorkItem(config, 'story', number);
}

// "Delete" do Backlog (RFC-003): fecha a issue (a API do GitHub não deleta
// issues). Invalida o snapshot.
export async function deleteWorkItemForRepository(
  tenantId: string,
  id: string,
  number: number,
): Promise<void> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  await updateIssueState(config, number, 'closed');
  invalidateSnapshot(tenantId, id);
}

// Arquiva (fecha) um work item e TODOS os seus descendentes (Backlog do PM).
// Usado para arquivar uma Initiative/Epic/Feature junto com filhos. Fecha só os
// itens ainda abertos; devolve quantos foram arquivados. Fecha sequencialmente
// para respeitar o rate limit de mutações do GitHub.
export async function archiveWorkItemSubtreeForRepository(
  tenantId: string,
  id: string,
  rootNumber: number,
): Promise<{ archived: number }> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  const snapshot = await loadSnapshotForRepository(tenantId, id);

  const childrenByParent = new Map<number, number[]>();
  for (const item of snapshot.items) {
    if (item.parentNumber != null) {
      const bucket = childrenByParent.get(item.parentNumber);
      if (bucket) bucket.push(item.number);
      else childrenByParent.set(item.parentNumber, [item.number]);
    }
  }
  const byNumber = new Map(snapshot.items.map((i) => [i.number, i]));

  // BFS pela subárvore a partir da raiz.
  const subtree: number[] = [];
  const seen = new Set<number>();
  const stack = [rootNumber];
  while (stack.length) {
    const n = stack.pop() as number;
    if (seen.has(n)) continue;
    seen.add(n);
    subtree.push(n);
    for (const child of childrenByParent.get(n) ?? []) stack.push(child);
  }

  // Fecha só o que está aberto (a raiz pode não estar no snapshot → fecha mesmo assim).
  const toClose = subtree.filter((n) => {
    const item = byNumber.get(n);
    return !item || item.state === 'open';
  });

  // Fecha em paralelo com concorrência limitada — sequencial estoura o teto de
  // ~29 s do API Gateway em subárvores grandes; concorrência baixa evita os
  // secondary rate limits do GitHub para mutações.
  const CONCURRENCY = 5;
  let cursor = 0;
  const worker = async () => {
    while (cursor < toClose.length) {
      const n = toClose[cursor++];
      await updateIssueState(config, n, 'closed');
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, toClose.length) }, () => worker()),
  );

  invalidateSnapshot(tenantId, id);
  return { archived: toClose.length };
}

// Move a etapa canônica de um work item no board (Start Story, aprovar/devolver
// UAT, mover no Technical Backlog). Resolve a opção crua do board cujo nome
// normaliza para a StageName pedida; issue fora do board é adicionada antes.
export async function setStageForRepository(
  tenantId: string,
  id: string,
  number: number,
  stage: StageName,
): Promise<void> {
  const record = await getRepositoryOr404(tenantId, id);
  const config = await configForRepository(record);
  const project = config.project;
  if (!project) {
    throw new HttpError(
      409,
      'Este repositório não tem um Projects v2 vinculado — vincule um board na edição do repositório para mover etapas.',
    );
  }

  const option = Object.entries(project.stageOptions).find(
    ([name]) => normalizeStage(name) === stage,
  );
  if (!option) {
    throw new HttpError(
      422,
      `O board deste repositório não tem uma coluna correspondente à etapa "${stage}".`,
    );
  }

  let itemId = await fetchProjectItemId(config, number, project.projectId);
  if (!itemId) {
    // Issue ainda fora do board → adiciona (precisa do node id do conteúdo).
    const ref = await fetchIssueRef(config, number);
    itemId = await addProjectItem(config, project.projectId, ref.nodeId);
  }

  await moveProjectStage(config, project.projectId, itemId, project.etapaFieldId, option[1]);
  invalidateSnapshot(tenantId, id);
}

// Lista os épicos (issues [EPIC]) de um repositório do tenant.
export async function loadEpicSummaries(tenantId: string, id: string): Promise<RepositoryEpics> {
  const record = await getRepositoryOr404(tenantId, id);
  const config = await configForRepository(record);
  const issues = await fetchEpicSummaries(config);

  const epics: EpicSummary[] = issues.map((issue) => {
    const team = teamOf(issue, config.team);
    return {
      number: issue.number,
      title: stripTypePrefix(issue.title),
      code: codeOf(issue, team),
      state: String(issue.state).toUpperCase() === 'CLOSED' ? 'closed' : 'open',
      url: issue.url ?? '',
    };
  });

  return { repository: toRepositoryDTO(record), epics };
}
