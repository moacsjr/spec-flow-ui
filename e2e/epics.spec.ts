import { test, expect } from '@playwright/test';

const REPO = process.env.E2E_REPO_ID ?? '1';

test.describe('Épicos do repositório (navegação dashboard → épicos → work item)', () => {
  test('validação: id inválido → 400', async ({ request }) => {
    const res = await request.get('/api/repositories/abc/epics');
    expect(res.status()).toBe(400);
  });

  test('repositório inexistente → 404', async ({ request }) => {
    const res = await request.get('/api/repositories/999999/epics');
    // 404 (não encontrado) ou 503 (sem token) são ambos aceitáveis aqui.
    expect([404, 503]).toContain(res.status());
  });

  test('clicar no repo abre a lista de épicos e o épico abre o work item', async ({ page, request }) => {
    const probe = await request.get(`/api/repositories/${REPO}/epics`);
    test.skip(probe.status() === 503, 'GITHUB_TOKEN não configurado no servidor — teste live ignorado');
    expect(probe.status()).toBe(200);

    // Dashboard → clica no primeiro card de repositório (na área do nome, fora
    // do link externo do GitHub, que abre em nova aba).
    await page.goto('/');
    await page.waitForSelector('.repo-card');
    await page.locator('.repo-card__name').first().click();

    // Foi para a tela de épicos do repo.
    await expect(page).toHaveURL(/#\/repos\/\d+\/epics/);
    await expect(page.locator('.dashboard__title')).toHaveText('Épicos');

    // Lista de épicos (ou vazio). Se houver épicos, abre o primeiro → work item.
    await page.waitForSelector('.feature-card-link, .repo-empty');
    const epics = page.locator('a.feature-card-link');
    const count = await epics.count();
    test.skip(count === 0, 'repositório sem épicos [EPIC] — nada para abrir');

    await epics.first().click();
    await expect(page).toHaveURL(/#\/repos\/\d+\/epic\/\d+/);
    await expect(page.locator('.state-msg--error')).toHaveCount(0);
    await expect(page.locator('.breadcrumb__seg').first()).toBeVisible();
  });
});
