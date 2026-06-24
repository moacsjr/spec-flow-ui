// Servidor Express da app fullstack.
//
// Responsabilidades:
//   - API /api/* (repositories + workitems) — única via de acesso ao GitHub
//   - Middlewares de segurança: helmet, CORS restrito, rate limiting
//   - Em produção (serveStatic), serve o build do frontend (client/dist) + SPA fallback
// O schema do SQLite é garantido no boot (migrate) e populado em dev (seed).

import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.ts';
import { logger } from './lib/logger.ts';
import { db, runMigrations } from './db/index.ts';
import { repositoryRoutes } from './routes/repositoryRoutes.ts';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());
  app.use(rateLimit({ windowMs: 60_000, limit: 120 })); // 120 req/min por IP

  // Health check.
  app.get('/status', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api', repositoryRoutes);

  // 404 JSON — escopado em /api para não engolir as rotas SPA do fallback.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Produção: serve o frontend buildado e faz fallback de qualquer GET não-/api
  // para o index.html (hash-router do client resolve a rota no browser).
  if (config.serveStatic) {
    app.use(express.static(config.clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  // Handler de erros — responde com o status do HttpError (se houver) ou 500.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(err instanceof Error ? err : String(err));
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function bootstrap() {
  await runMigrations();
  // Seed básico em dev (idempotente — não sobrescreve dados existentes).
  await db.seed.run();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`API ouvindo em http://localhost:${config.port} (CORS: ${config.corsOrigin})`);
  });
}

bootstrap().catch((err) => {
  logger.error(err);
  process.exit(1);
});
