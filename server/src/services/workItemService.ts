// Serviço de work item — orquestra a busca no GitHub + adaptação para
// WorkItemView. Sempre live (sem fixture). A identidade do repo vem da config
// recebida (montada a partir da linha do SQLite); o token vive só no servidor.

import type {
  CreateFeatureRequest,
  EpicSummary,
  Level,
  RepositoryEpics,
  WorkItemPatch,
  WorkItemView,
} from '@spec-flow/shared';
import {
  addProjectItem,
  addSubIssue,
  createIssue,
  fetchEpicPayload,
  fetchEpicSummaries,
  fetchFileContent,
  fetchIssueComments,
  fetchIssueRef,
  fetchIssueTitle,
  fetchIssueTree,
  fetchSingleSelectField,
  moveProjectStage,
  updateIssue,
  type GitHubConfig,
} from '../github/client.ts';
import { logger } from '../lib/logger.ts';
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

// Resolve o repositório pelo id (SQLite) e carrega o work item naquele repo.
export async function loadWorkItemForRepository(
  id: number,
  level: Level,
  number: number,
): Promise<WorkItemView> {
  const row = await getRepositoryOr404(id);
  return loadWorkItem(configForRepository(row), level, number);
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

// Resolve o repositório pelo id (SQLite) e edita o work item naquele repo.
export async function updateWorkItemForRepository(
  id: number,
  level: Level,
  number: number,
  patch: WorkItemPatch,
): Promise<WorkItemView> {
  const row = await getRepositoryOr404(id);
  return updateWorkItem(configForRepository(row), level, number, patch);
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
  id: number,
  epicNumber: number,
  input: CreateFeatureRequest,
): Promise<WorkItemView> {
  const config = configForRepository(await getRepositoryOr404(id));

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

  return loadWorkItem(config, 'epic', epicNumber);
}

// Lista os épicos (issues [EPIC]) de um repositório.
export async function loadEpicSummaries(id: number): Promise<RepositoryEpics> {
  const row = await getRepositoryOr404(id);
  const config = configForRepository(row);
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

  return { repository: toRepositoryDTO(row), epics };
}
