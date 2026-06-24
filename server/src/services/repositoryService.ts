// Repo-awareness: resolve a identidade do repositório (owner/repo) a partir da
// linha do SQLite (parseando a url) e monta a GitHubConfig usando o token do env.
// O token vive só no servidor; nunca é exposto ao cliente.

import type { Repository } from '@spec-flow/shared';
import { db } from '../db/index.ts';
import { config } from '../config.ts';
import type { GitHubConfig } from '../github/client.ts';
import { isValidHttpUrl } from '../lib/validation.ts';
import { NotConfiguredError, NotFoundError } from '../lib/errors.ts';

export interface RepositoryRow {
  id: number;
  name: string;
  url: string;
  created_at: string;
}

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

// SQLite guarda CURRENT_TIMESTAMP como "YYYY-MM-DD HH:MM:SS" em UTC, sem fuso.
function toIso(raw: string): string {
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString();
}

export function toRepositoryDTO(row: RepositoryRow): Repository {
  return { id: row.id, name: row.name, url: row.url, createdAt: toIso(row.created_at) };
}

// Busca o repositório por id; ausente → 404.
export async function getRepositoryOr404(id: number): Promise<RepositoryRow> {
  const row = await db<RepositoryRow>('repositories').where({ id }).first();
  if (!row) throw new NotFoundError(`Repositório #${id} não encontrado.`);
  return row;
}

// Monta a GitHubConfig de um repositório: owner/repo da url, token/team do env.
export function configForRepository(row: RepositoryRow): GitHubConfig {
  const parsed = parseGitHubUrl(row.url);
  if (!parsed) {
    throw new NotFoundError(`Repositório #${row.id} não tem uma URL de GitHub válida: ${row.url}`);
  }
  if (!config.github.token) {
    throw new NotConfiguredError('Configure GITHUB_TOKEN no servidor.');
  }
  return {
    token: config.github.token,
    owner: parsed.owner,
    repo: parsed.repo,
    issueNumber: 0, // sobrescrito por chamada (epic view)
    team: config.github.team || undefined,
  };
}
