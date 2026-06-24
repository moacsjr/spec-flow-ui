// Erros de domínio com status HTTP, para o controller mapear sem inspecionar
// mensagens. O handler central usa `status` quando presente.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

// GitHub não configurado no servidor (sem token/repo/issue). Sem fixture de fallback.
export class NotConfiguredError extends HttpError {
  constructor(message = 'Integração com o GitHub não configurada no servidor.') {
    super(503, message);
  }
}

// Item não encontrado no GitHub.
export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
  }
}

// Falha na própria API do GitHub (rede, auth, rate limit, erros GraphQL).
export class UpstreamError extends HttpError {
  constructor(message: string) {
    super(502, message);
  }
}
