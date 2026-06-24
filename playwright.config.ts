import { defineConfig } from '@playwright/test';

// E2E da app unificada (processo único): o webServer builda o client e sobe o
// Express servindo client/dist + API. Carrega server/.env, então o fluxo live do
// GitHub é testado quando GITHUB_* estiver configurado; sem token, os testes que
// dependem do GitHub se auto-pulam (skip), não falham.
//
// Usa uma porta dedicada (3100) para não colidir com um dev server na 3001, e a
// checagem de readiness aponta para `/` (o shell SPA, só servido com SERVE_STATIC),
// evitando reusar acidentalmente um servidor sem o static.

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm start',
    url: `${baseURL}/`,
    env: { PORT: String(PORT), SERVE_STATIC: 'true' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
