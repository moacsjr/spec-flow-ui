// Discussão integrada ("chat-about-this"): um canal Slack por Feature, criado
// sob demanda no primeiro "Discutir no chat". O ciclo formal (devolução →
// triagem → aplicação) decide; o chat discute — o sistema abre a porta, cita o
// contexto e sai do caminho (não sincroniza, não espelha, não modera).
//
// Idempotência (spec §4.1): canal criado + mapeamento persistido primeiro; os
// passos seguintes (abertura, comentário de rastreabilidade) ficam em flags no
// registro e são retomados no próximo clique se falharem. A corrida de criação
// é resolvida pelo condition de unicidade — o perdedor usa o canal do vencedor.

import { config } from '../config.ts';
import {
  getDiscussionChannel,
  getUserPref,
  putDiscussionChannel,
  putDiscussionChannelIfAbsent,
  putDiscussionCitationIfAbsent,
  queryDiscussionChannels,
  type DiscussionChannelRecord,
} from '../db/dynamo.ts';
import { HttpError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { actorLogin } from '../lib/actor.ts';
import { createComment, fetchIssueRef, type GitHubConfig } from '../github/client.ts';
import { stripTypePrefix } from '../github/adapter.ts';
import {
  archiveChannel,
  channelLink,
  createChannel,
  inviteUser,
  postMessage,
  SlackError,
  unarchiveChannel,
} from '../chat/slackProvider.ts';
import { decryptSlackToken } from '../chat/chatSettings.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { listReviewComments, type ReviewComment } from './specReviewService.ts';
import { resolveFeaturePaths } from './workItemService.ts';

const TRACE_MARKER = '<!-- discussion-channel -->';
const CITATION_MAX_CHARS = 500;
const NAME_MAX = 80; // limite do Slack

interface CommentAnchor {
  startLine?: number | null;
  endLine?: number | null;
  specSha?: string | null;
}

// `feat-{n}-{slug}` normalizado (minúsculas, hífens), truncado ao limite.
export function channelNameFor(number: number, title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `feat-${number}-${slug}`.slice(0, NAME_MAX).replace(/-+$/, '');
}

async function slackTokenFor(tenantId: string, repoId: string): Promise<string> {
  const record = await getRepositoryOr404(tenantId, repoId);
  const token = await decryptSlackToken(tenantId, record.slackTokenCiphertext);
  if (!token) {
    throw new HttpError(409, 'Este repositório não tem o Slack configurado (edição do repositório).');
  }
  return token;
}

// Blocos Slack da citação (spec §4.3): autor + citação truncada + links.
function citationBlocks(opts: {
  comment: ReviewComment;
  featureNumber: number;
  featureTitle: string;
  config: GitHubConfig;
  specPath: string;
  opening: boolean;
}): { text: string; blocks: unknown[] } {
  const { comment, featureNumber, featureTitle, config: gh, specPath, opening } = opts;
  const anchor = (comment.anchor ?? null) as CommentAnchor | null;
  const ref = anchor?.specSha ?? 'HEAD';
  const fragment =
    anchor?.startLine != null
      ? `#L${anchor.startLine}${anchor.endLine != null && anchor.endLine !== anchor.startLine ? `-L${anchor.endLine}` : ''}`
      : '';
  const blobUrl = `https://github.com/${gh.owner}/${gh.repo}/blob/${ref}/${specPath}${fragment}`;
  const blobLabel = fragment ? 'Ver trecho no GitHub' : 'Ver documento no GitHub';
  const appUrl = `${config.appUrl.replace(/\/+$/, '')}/#/ws/pm/specification?feature=${featureNumber}`;

  const quote = comment.body.length > CITATION_MAX_CHARS
    ? `${comment.body.slice(0, CITATION_MAX_CHARS)}…`
    : comment.body;

  const blocks: unknown[] = [];
  if (opening) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Canal de discussão da feature #${featureNumber}. Convide quem precisar.`,
        },
      ],
    });
  }
  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${comment.author}* comentou em *#${featureNumber} ${featureTitle}*`,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: quote.split('\n').map((l) => `> ${l}`).join('\n') },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<${blobUrl}|${blobLabel}> · <${appUrl}|Abrir no spec-flow-ui>` },
      ],
    },
  );
  const text = `${comment.author} comentou em #${featureNumber} ${featureTitle}: ${quote.slice(0, 120)}`;
  return { text, blocks };
}

// POST .../discussion — §4.1 (criação) ou §4.2 (reuso), idempotente.
export async function openDiscussion(
  tenantId: string,
  sub: string,
  repoId: string,
  featureNumber: number,
  commentId: number,
): Promise<{ channelLink: string; created: boolean }> {
  const token = await slackTokenFor(tenantId, repoId);
  const gh = await configForRepository(await getRepositoryOr404(tenantId, repoId));

  // O comentário clicado (publicado, com marcador spec-review) e o contexto.
  const comments = await listReviewComments(tenantId, repoId, featureNumber);
  const comment = comments.find((c) => c.id === commentId);
  if (!comment) {
    throw new HttpError(404, `Comentário ${commentId} não é um comentário de revisão publicado.`);
  }
  const ref = await fetchIssueRef(gh, featureNumber);
  const featureTitle = stripTypePrefix(ref.title);
  const { specPath } = await resolveFeaturePaths(gh, featureNumber, ref.title);

  // Canal: existente ou criado agora (corrida resolvida pelo condition).
  let rec = await getDiscussionChannel(tenantId, repoId, featureNumber);
  let created = false;
  if (!rec) {
    const base = channelNameFor(featureNumber, featureTitle);
    let channel: { id: string; name: string } | null = null;
    for (let suffix = 0; suffix < 5 && !channel; suffix += 1) {
      const name = suffix === 0 ? base : `${base.slice(0, NAME_MAX - 3)}-${suffix + 1}`;
      try {
        channel = await createChannel(token, name);
      } catch (err) {
        if (!(err instanceof SlackError) || err.code !== 'name_taken') throw err;
      }
    }
    if (!channel) throw new HttpError(502, 'Slack: não foi possível criar o canal (nomes em uso).');

    rec = {
      tenantId,
      repoId,
      itemNumber: featureNumber,
      provider: 'slack',
      channelId: channel.id,
      channelName: channel.name,
      createdBy: sub,
      createdAt: new Date().toISOString(),
      archivedAt: null,
      openingPosted: false,
      tracePosted: false,
    };
    const won = await putDiscussionChannelIfAbsent(rec);
    if (!won) {
      // Perdeu a corrida: usa o canal do vencedor e arquiva o duplicado.
      await archiveChannel(token, channel.id).catch(() => undefined);
      rec = (await getDiscussionChannel(tenantId, repoId, featureNumber)) as DiscussionChannelRecord;
    } else {
      created = true;
      const pref = await getUserPref(tenantId, sub).catch(() => null);
      if (pref?.slackUserId) {
        await inviteUser(token, channel.id, pref.slackUserId).catch((err: Error) =>
          logger.warn(`Discussão #${featureNumber}: convite ao criador falhou: ${err.message}`),
        );
      }
    }
  }

  // Canal arquivado (Feature fechada ou arquivamento manual): desarquiva.
  if (rec.archivedAt) {
    await unarchiveChannel(token, rec.channelId);
    rec = { ...rec, archivedAt: null };
    await putDiscussionChannel(rec);
  }

  // Abertura (uma vez) ou citação nova (dedupe por comentário).
  if (!rec.openingPosted) {
    const msg = citationBlocks({ comment, featureNumber, featureTitle, config: gh, specPath, opening: true });
    await postMessage(token, rec.channelId, msg.text, msg.blocks);
    rec = { ...rec, openingPosted: true };
    await putDiscussionChannel(rec);
    await putDiscussionCitationIfAbsent({
      tenantId,
      channelId: rec.channelId,
      commentId,
      postedAt: new Date().toISOString(),
    }).catch(() => undefined);
  } else {
    const fresh = await putDiscussionCitationIfAbsent({
      tenantId,
      channelId: rec.channelId,
      commentId,
      postedAt: new Date().toISOString(),
    });
    if (fresh) {
      const msg = citationBlocks({ comment, featureNumber, featureTitle, config: gh, specPath, opening: false });
      await postMessage(token, rec.channelId, msg.text, msg.blocks);
    }
  }

  // Rastreabilidade na issue — exatamente uma vez por canal, com autoria.
  if (!rec.tracePosted) {
    const author = await actorLogin(tenantId);
    const marker = author
      ? `<!-- discussion-channel ${JSON.stringify({ author })} -->`
      : TRACE_MARKER;
    await createComment(
      gh,
      featureNumber,
      `${marker}\n\n💬 Discussão aberta${author ? ` por @${author}` : ''} no canal #${rec.channelName} · ${channelLink(rec.channelId)}`,
    );
    rec = { ...rec, tracePosted: true };
    await putDiscussionChannel(rec);
  }

  return { channelLink: channelLink(rec.channelId), created };
}

// GET /discussions — canais ativos do repositório (indicadores 💬 das filas).
export async function listActiveDiscussions(
  tenantId: string,
  repoId: string,
): Promise<{ itemNumber: number; channelName: string; channelLink: string }[]> {
  const all = await queryDiscussionChannels(tenantId, repoId);
  return all
    .filter((r) => !r.archivedAt)
    .map((r) => ({
      itemNumber: r.itemNumber,
      channelName: r.channelName,
      channelLink: channelLink(r.channelId),
    }));
}

// Arquivamento no fechamento D4 (falha não bloqueia — retry no polling).
export async function archiveDiscussionForFeature(
  tenantId: string,
  repoId: string,
  featureNumber: number,
): Promise<void> {
  const rec = await getDiscussionChannel(tenantId, repoId, featureNumber);
  if (!rec || rec.archivedAt) return;
  const token = await decryptSlackToken(
    tenantId,
    (await getRepositoryOr404(tenantId, repoId)).slackTokenCiphertext,
  );
  if (!token) return;
  await archiveChannel(token, rec.channelId);
  await putDiscussionChannel({ ...rec, archivedAt: new Date().toISOString() });
}

// Rede de segurança no polling: Features fechadas com canal ainda ativo.
export async function archiveClosedFeatureDiscussions(
  tenantId: string,
  repoId: string,
  closedFeatureNumbers: Set<number>,
): Promise<void> {
  const all = await queryDiscussionChannels(tenantId, repoId).catch(() => []);
  for (const rec of all) {
    if (rec.archivedAt || !closedFeatureNumbers.has(rec.itemNumber)) continue;
    try {
      await archiveDiscussionForFeature(tenantId, repoId, rec.itemNumber);
      logger.info(`Discussão: canal #${rec.channelName} arquivado (feature #${rec.itemNumber} fechada).`);
    } catch (err) {
      logger.warn(`Discussão: falha ao arquivar #${rec.channelName}: ${(err as Error).message}`);
    }
  }
}
