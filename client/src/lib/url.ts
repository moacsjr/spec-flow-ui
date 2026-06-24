// Sanitização de URLs para exibição (prevenção de XSS via esquemas perigosos
// como javascript:). Só http/https são considerados seguros para virar link.

export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
