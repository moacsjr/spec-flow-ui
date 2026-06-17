// Fonte de dados da Epic View: tenta o GitHub ao vivo (se houver config no env),
// senão cai no fixture local. Em ambos os casos o resultado passa pelo adapter.

import type { Epic } from '../types';
import { adaptEpic } from '../github/adapter';
import { configFromEnv, fetchEpicPayload } from '../github/client';
import { fixturePayload } from './fixture';

export interface LoadResult {
  epic: Epic;
  source: 'github' | 'fixture';
}

export async function loadEpic(): Promise<LoadResult> {
  const config = configFromEnv();
  if (config) {
    const payload = await fetchEpicPayload(config);
    return { epic: adaptEpic(payload), source: 'github' };
  }
  return { epic: adaptEpic(fixturePayload), source: 'fixture' };
}
