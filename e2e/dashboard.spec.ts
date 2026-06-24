import { test, expect } from '@playwright/test';

// Dashboard é servido pelo SQLite (sem GitHub) — sempre roda, inclusive em CI.
test.describe('Dashboard', () => {
  test('lista repositórios conectados (GET /api/repositories)', async ({ page }) => {
    const resP = page.waitForResponse((r) => r.url().includes('/api/repositories'));
    await page.goto('/');
    const res = await resP;
    expect(res.status()).toBe(200);

    await expect(page.locator('.dashboard__title')).toHaveText('Repositórios Conectados');
    await expect(page.locator('.repo-card').first()).toBeVisible();
    expect(await page.locator('.repo-card').count()).toBeGreaterThan(0);
  });

  test('filtro client-side por nome', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.repo-card');
    const total = await page.locator('.repo-card').count();

    const firstName = (await page.locator('.repo-card__name').first().textContent()) ?? '';
    const frag = firstName.trim().slice(0, 4);
    test.skip(frag.length < 2, 'nome do primeiro repo é muito curto para filtrar');

    await page.fill('.dashboard__search', frag);
    const names = await page.locator('.repo-card__name').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(total);
    for (const n of names) {
      expect(n.toLowerCase()).toContain(frag.toLowerCase());
    }
  });

  test('botão "Conectar novo repositório" visível', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /conectar novo reposit/i })).toBeVisible();
  });
});
