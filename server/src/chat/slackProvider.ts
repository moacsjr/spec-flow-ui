// Provider de chat — MVP: Slack (spec "Discussão integrada" §2). O contrato é
// deliberadamente mínimo (criar canal, postar, arquivar/desarquivar, convidar,
// link) para acomodar outros providers no futuro sem tocar o discussionService.
//
// Todas as chamadas usam a Web API com o bot token do repositório (escopos:
// channels:manage, chat:write, channels:read). Rate limit (HTTP 429): um retry
// com o Retry-After sugerido; persistindo, o erro sobe amigável.

import { UpstreamError } from '../lib/errors.ts';

const API = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  channel?: { id: string; name: string };
  [k: string]: unknown;
}

export class SlackError extends UpstreamError {
  constructor(public readonly code: string) {
    super(`Slack: ${code}`);
  }
}

async function slackCall(
  token: string,
  method: string,
  payload: Record<string, unknown>,
  retried = false,
): Promise<SlackResponse> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 429 && !retried) {
    const wait = Math.min(Number(res.headers.get('Retry-After') ?? 2), 10);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return slackCall(token, method, payload, true);
  }
  if (!res.ok) throw new UpstreamError(`Slack API ${method} HTTP ${res.status}`);
  const json = (await res.json()) as SlackResponse;
  if (!json.ok) throw new SlackError(json.error ?? 'unknown_error');
  return json;
}

// Cria um canal público. Colisão de nome sobe SlackError('name_taken') — o
// caller decide o sufixo incremental.
export async function createChannel(
  token: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const json = await slackCall(token, 'conversations.create', { name });
  const ch = json.channel as { id: string; name: string };
  return { id: ch.id, name: ch.name };
}

export async function postMessage(
  token: string,
  channelId: string,
  text: string,
  blocks?: unknown[],
): Promise<void> {
  await slackCall(token, 'chat.postMessage', {
    channel: channelId,
    text,
    ...(blocks ? { blocks } : {}),
  });
}

export async function archiveChannel(token: string, channelId: string): Promise<void> {
  try {
    await slackCall(token, 'conversations.archive', { channel: channelId });
  } catch (err) {
    if (err instanceof SlackError && err.code === 'already_archived') return; // idempotente
    throw err;
  }
}

export async function unarchiveChannel(token: string, channelId: string): Promise<void> {
  try {
    await slackCall(token, 'conversations.unarchive', { channel: channelId });
  } catch (err) {
    if (err instanceof SlackError && err.code === 'not_archived') return; // idempotente
    throw err;
  }
}

// Convida um usuário (mapeamento GitHub↔Slack opcional). Best-effort no caller.
export async function inviteUser(
  token: string,
  channelId: string,
  userId: string,
): Promise<void> {
  try {
    await slackCall(token, 'conversations.invite', { channel: channelId, users: userId });
  } catch (err) {
    if (err instanceof SlackError && err.code === 'already_in_channel') return;
    throw err;
  }
}

// Deep link oficial que abre o canal no workspace do usuário autenticado.
export function channelLink(channelId: string): string {
  return `https://slack.com/app_redirect?channel=${channelId}`;
}
