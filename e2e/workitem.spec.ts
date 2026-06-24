import { test, expect } from '@playwright/test';

// Repo + épico usados no teste live. REPO casa com um id do SQLite (seed: 1 =
// spec-flow-ui); EPIC é o número da issue [EPIC] (OnBoarding = 2).
const REPO = process.env.E2E_REPO_ID ?? '1';
const EPIC = process.env.E2E_EPIC ?? '2';

test.describe('Work item (GitHub via backend, repo-scoped)', () => {
  test('validação de rota: nível inválido → 400', async ({ request }) => {
    const res = await request.get(`/api/repositories/${REPO}/workitems/bogus/1`);
    expect(res.status()).toBe(400);
  });

  test('renderiza Epic e permite drill-down', async ({ page, request }) => {
    // Sem GITHUB_TOKEN o backend responde 503 — pula o teste live (não falha em CI).
    const probe = await request.get(`/api/repositories/${REPO}/workitems/epic/${EPIC}`);
    test.skip(probe.status() === 503, 'GITHUB_TOKEN não configurado no servidor — teste live ignorado');
    expect(probe.status()).toBe(200);

    const url = `/api/repositories/${REPO}/workitems/epic/${EPIC}`;
    const respP = page.waitForResponse((r) => r.url().includes(url));
    await page.goto(`/#/repos/${REPO}/epic/${EPIC}`);
    const resp = await respP;
    expect(resp.status()).toBe(200);

    // Renderizou a tela (TopBar com breadcrumb) e não caiu no estado de erro.
    await expect(page.locator('.state-msg--error')).toHaveCount(0);
    await expect(page.locator('.breadcrumb__seg').first()).toBeVisible();

    // Drill-down: se houver cards de filho clicáveis, navega para o nível abaixo
    // (mantendo o escopo do repositório).
    const childLinks = page.locator('a.feature-card-link');
    if ((await childLinks.count()) > 0) {
      await childLinks.first().click();
      await expect(page).toHaveURL(new RegExp(`#/repos/${REPO}/(feature|story)/\\d+`));
    }
  });
});
