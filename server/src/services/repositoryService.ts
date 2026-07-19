// Repo-awareness multi-tenant: resolve a identidade do repositório (owner/repo)
// a partir do registro no DynamoDB — SEMPRE escopado pelo tenantId — e monta a
// GitHubConfig com o installation token do GitHub App do tenant. Não existe
// token global: cada tenant só alcança repositórios cobertos pela SUA instalação.

import type { Repository } from '@spec-flow/shared';
import {
  createRepositoryRecord,
  getInstallation,
  getRepositoryRecord,
  queryRepositoryRecords,
  replaceRepositoryRecord,
  type RepositoryRecord,
} from '../db/dynamo.ts';
import { config } from '../config.ts';
import { ulid } from '../lib/ulid.ts';
import { findRepoInstallation, installationToken } from '../github/appAuth.ts';
import {
  fetchProjectFields,
  parseProjectUrl,
  type GitHubConfig,
  type ProjectConfig,
} from '../github/client.ts';
import { isValidHttpUrl } from '../lib/validation.ts';
import { HttpError, NotFoundError } from '../lib/errors.ts';
import { assertRepoQuota } from './quotaService.ts';
import { encryptSlackToken } from '../chat/chatSettings.ts';

export type { RepositoryRecord };

// "https://github.com/owner/name(.git)(/issues/1)" → { owner, repo }. Não-GitHub
// ou não parseável → null.
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  if (!isValidHttpUrl(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
  const [owner, repoRaw] = parsed.pathname.replace(/^\/+/, '').split('/');
  if (!owner || !repoRaw) return null;
  const repo = repoRaw.replace(/\.git$/i, '');
  return repo ? { owner, repo } : null;
}

export function toRepositoryDTO(record: RepositoryRecord): Repository {
  return {
    id: record.id,
    name: record.name,
    url: record.url,
    createdAt: record.createdAt,
    projectUrl: record.projectUrl ?? null,
    wipThreshold: record.wipThreshold ?? null,
    slackConfigured: Boolean(record.slackTokenCiphertext),
  };
}

// Reconstrói o ProjectConfig a partir do registro. Só retorna config quando os
// campos essenciais existem (projeto introspectado no cadastro); caso contrário
// undefined → o fluxo segue sem mover etapa.
function projectConfigFromRecord(record: RepositoryRecord): ProjectConfig | undefined {
  if (!record.projectId || !record.etapaFieldId || record.projectNumber == null) return undefined;
  return {
    projectId: record.projectId,
    projectNumber: record.projectNumber,
    etapaFieldId: record.etapaFieldId,
    stageOptions: record.stageOptions ?? {},
  };
}

// Valida que o GitHub App está instalado no repo E que a instalação pertence ao
// tenant — o coração do isolamento entre clientes no acesso ao GitHub.
async function resolveInstallationForRepo(
  tenantId: string,
  owner: string,
  repo: string,
): Promise<number> {
  const installation = await findRepoInstallation(owner, repo);
  if (!installation) {
    throw new HttpError(
      422,
      `O GitHub App não está instalado em ${owner}/${repo}. Instale o App nesse repositório antes de conectá-lo.`,
    );
  }
  const mapped = await getInstallation(installation.id);
  if (!mapped || mapped.tenantId !== tenantId || mapped.status !== 'active') {
    throw new HttpError(
      403,
      `A instalação do GitHub App em ${owner}/${repo} não está vinculada à sua conta. Refaça a instalação pelo onboarding.`,
    );
  }
  return installation.id;
}

// Introspecta o Projects v2 informado (campo de etapa + opções), validando a URL.
async function introspectProject(
  token: string,
  owner: string,
  repo: string,
  projectUrl: string,
): Promise<ProjectConfig> {
  const ref = parseProjectUrl(projectUrl);
  if (!ref) {
    throw new HttpError(
      400,
      `URL de Projects v2 inválida: "${projectUrl}". Use https://github.com/orgs/<org>/projects/<n> ou .../users/<user>/projects/<n>.`,
    );
  }
  const ghConfig: GitHubConfig = { token, owner, repo, issueNumber: 0 };
  return fetchProjectFields(ghConfig, ref);
}

// Campos de projeto correspondentes a um ProjectConfig (ou tudo null = limpo).
function projectFields(
  projectUrl: string | null,
  project: ProjectConfig | null,
): Pick<
  RepositoryRecord,
  'projectUrl' | 'projectId' | 'projectNumber' | 'etapaFieldId' | 'stageOptions'
> {
  return {
    projectUrl,
    projectId: project?.projectId ?? null,
    projectNumber: project?.projectNumber ?? null,
    etapaFieldId: project?.etapaFieldId ?? null,
    stageOptions: project?.stageOptions ?? null,
  };
}

// Lista os repositórios do tenant (Dashboard).
export async function listRepositories(tenantId: string): Promise<Repository[]> {
  const records = await queryRepositoryRecords(tenantId);
  return records.map(toRepositoryDTO);
}

// Cadastra um repositório do tenant. Valida que a instalação do GitHub App do
// tenant cobre o repo; quando `projectUrl` é informado, introspecta o Projects v2
// (campo de etapa + opções) e persiste os ids — habilitando mover etapa pela UI.
export async function createRepository(
  tenantId: string,
  input: { url: string; projectUrl?: string },
): Promise<Repository> {
  const url = input.url.trim();
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    throw new HttpError(400, `URL de repositório do GitHub inválida: "${input.url}".`);
  }

  await assertRepoQuota(tenantId); // teto do plano (fase 3) — 402 se atingido

  const installationId = await resolveInstallationForRepo(tenantId, parsed.owner, parsed.repo);

  // Introspecção do Projects v2 (opcional) — com o token da instalação do tenant.
  const projectUrl = input.projectUrl?.trim() || undefined;
  const project = projectUrl
    ? await introspectProject(
        await installationToken(installationId),
        parsed.owner,
        parsed.repo,
        projectUrl,
      )
    : null;

  const record: RepositoryRecord = {
    id: ulid(),
    tenantId,
    name: `${parsed.owner}/${parsed.repo}`,
    url,
    installationId,
    createdAt: new Date().toISOString(),
    ...projectFields(projectUrl ?? null, project),
  };
  await createRepositoryRecord(record); // 409 se a url já existe no tenant
  return toRepositoryDTO(record);
}

// Edita um repositório do tenant. `url` e `projectUrl` são opcionais (omitido =
// mantém): url nova revalida a instalação; projectUrl '' desvincula o Projects v2.
export async function updateRepository(
  tenantId: string,
  id: string,
  input: {
    url?: string;
    projectUrl?: string;
    wipThreshold?: number | null;
    slackBotToken?: string;
  },
): Promise<Repository> {
  const record = await getRepositoryOr404(tenantId, id);
  const previousUrl = record.url;
  const updated: RepositoryRecord = { ...record };

  let owner: string;
  let repo: string;
  if (input.url !== undefined) {
    const url = input.url.trim();
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      throw new HttpError(400, `URL de repositório do GitHub inválida: "${input.url}".`);
    }
    updated.url = url;
    updated.name = `${parsed.owner}/${parsed.repo}`;
    updated.installationId = await resolveInstallationForRepo(tenantId, parsed.owner, parsed.repo);
    owner = parsed.owner;
    repo = parsed.repo;
  } else {
    const parsed = parseGitHubUrl(record.url);
    owner = parsed?.owner ?? '';
    repo = parsed?.repo ?? '';
  }

  if (input.projectUrl !== undefined) {
    const projectUrl = input.projectUrl.trim();
    if (projectUrl === '') {
      Object.assign(updated, projectFields(null, null)); // desvincula
    } else if (projectUrl !== (record.projectUrl ?? '') || !record.projectId) {
      const project = await introspectProject(
        await installationToken(updated.installationId),
        owner,
        repo,
        projectUrl,
      );
      Object.assign(updated, projectFields(projectUrl, project));
    }
  }

  if (input.slackBotToken !== undefined) {
    const token = input.slackBotToken.trim();
    updated.slackTokenCiphertext = token ? await encryptSlackToken(tenantId, token) : null;
  }

  if (input.wipThreshold !== undefined) {
    if (
      input.wipThreshold !== null &&
      (!Number.isInteger(input.wipThreshold) || input.wipThreshold < 1)
    ) {
      throw new HttpError(400, 'wipThreshold deve ser um inteiro ≥ 1 (ou null para o default).');
    }
    updated.wipThreshold = input.wipThreshold;
  }

  await replaceRepositoryRecord(updated, previousUrl);
  return toRepositoryDTO(updated);
}

// Busca um repositório do tenant pelo id (DTO). Ausente → 404.
export async function getRepository(tenantId: string, id: string): Promise<Repository> {
  return toRepositoryDTO(await getRepositoryOr404(tenantId, id));
}

// Busca o repositório do tenant por id; ausente (ou de outro tenant) → 404.
export async function getRepositoryOr404(tenantId: string, id: string): Promise<RepositoryRecord> {
  const record = await getRepositoryRecord(tenantId, id);
  if (!record) throw new NotFoundError(`Repositório "${id}" não encontrado.`);
  return record;
}

// Monta a GitHubConfig de um repositório: owner/repo da url, token da instalação
// do GitHub App do tenant (curto, cacheado — ver appAuth.ts).
export async function configForRepository(record: RepositoryRecord): Promise<GitHubConfig> {
  const parsed = parseGitHubUrl(record.url);
  if (!parsed) {
    throw new NotFoundError(
      `Repositório "${record.id}" não tem uma URL de GitHub válida: ${record.url}`,
    );
  }
  return {
    token: await installationToken(record.installationId),
    owner: parsed.owner,
    repo: parsed.repo,
    issueNumber: 0, // sobrescrito por chamada (epic view)
    team: config.github.team || undefined,
    project: projectConfigFromRecord(record),
  };
}
