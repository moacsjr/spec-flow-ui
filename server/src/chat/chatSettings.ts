// Bot token do Slack por repositório (spec "Discussão integrada" §5) — mesmo
// tratamento da chave OpenRouter do tenant: cifrado com KMS (encryption context
// = tenantId). Em dev local sem KMS (DEV_TENANT_ID), cai para armazenamento
// com prefixo "plain:" — nunca em produção.

import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { config } from '../config.ts';
import { NotConfiguredError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

const kms = new KMSClient({});
const PLAIN_PREFIX = 'plain:';

export async function encryptSlackToken(tenantId: string, token: string): Promise<string> {
  if (!config.tenantKmsKeyId) {
    if (config.devTenantId) return `${PLAIN_PREFIX}${Buffer.from(token, 'utf8').toString('base64')}`;
    throw new NotConfiguredError('KMS de segredos por tenant não configurado no servidor.');
  }
  const out = await kms.send(
    new EncryptCommand({
      KeyId: config.tenantKmsKeyId,
      Plaintext: Buffer.from(token, 'utf8'),
      EncryptionContext: { tenantId },
    }),
  );
  return Buffer.from(out.CiphertextBlob!).toString('base64');
}

export async function decryptSlackToken(
  tenantId: string,
  ciphertext: string | null | undefined,
): Promise<string | null> {
  if (!ciphertext) return null;
  if (ciphertext.startsWith(PLAIN_PREFIX)) {
    return Buffer.from(ciphertext.slice(PLAIN_PREFIX.length), 'base64').toString('utf8');
  }
  try {
    const out = await kms.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(ciphertext, 'base64'),
        EncryptionContext: { tenantId },
      }),
    );
    return Buffer.from(out.Plaintext!).toString('utf8');
  } catch (err) {
    logger.warn(`Falha ao decifrar o token Slack do tenant ${tenantId}: ${(err as Error).message}`);
    return null;
  }
}
