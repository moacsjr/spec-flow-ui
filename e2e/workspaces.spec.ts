import { test, expect, type Page } from '@playwright/test';

// Workspaces por papel (RFC-003). As APIs de repositórios e snapshot são
// mockadas via route interception — o teste valida o shell (sidebar por papel,
// switcher, seletor de repo) e o filtro client-side das páginas, sem depender
// de GitHub/DynamoDB.

const REPO = {
  id: '01JTESTREPO0000000000000000',
  name: 'acme/checkout',
  url: 'https://github.com/acme/checkout',
  createdAt: '2026-07-01T00:00:00.000Z',
  projectUrl: null,
};

const SNAPSHOT = {
  repository: REPO,
  generatedAt: '2026-07-07T12:00:00.000Z',
  milestones: [
    { number: 1, title: 'v1.0', dueOn: '2026-08-01T00:00:00Z', state: 'open', openCount: 2, closedCount: 1 },
  ],
  items: [
    {
      number: 10,
      title: 'Nova ideia sem prioridade',
      url: 'https://github.com/acme/checkout/issues/10',
      state: 'open',
      level: 'feature',
      labels: ['[FEATURE]'],
      priority: null,
      area: 'Backend',
      stage: 'Backlog',
      stageRaw: '📥 Backlog',
      milestone: null,
      assignees: [],
      parentNumber: 1,
      createdAt: '2026-07-02T00:00:00.000Z',
      progress: null,
      prs: [],
    },
    {
      number: 11,
      title: 'Feature priorizada em spec',
      url: 'https://github.com/acme/checkout/issues/11',
      state: 'open',
      level: 'feature',
      labels: ['[FEATURE]', 'P1'],
      priority: 'P1',
      area: 'Frontend',
      stage: 'Spec',
      stageRaw: '📋 Spec',
      milestone: null,
      assignees: [],
      parentNumber: 1,
      createdAt: '2026-07-03T00:00:00.000Z',
      progress: null,
      prs: [],
    },
    {
      number: 12,
      title: 'Story pronta para começar',
      url: 'https://github.com/acme/checkout/issues/12',
      state: 'open',
      level: 'story',
      labels: ['[STORY]'],
      priority: null,
      area: null,
      stage: 'Ready',
      stageRaw: '✅ Ready',
      milestone: { number: 1, title: 'v1.0' },
      assignees: [{ login: 'moacir', name: 'Moacir' }],
      parentNumber: 11,
      createdAt: '2026-07-04T00:00:00.000Z',
      progress: { total: 3, completed: 0 },
      prs: [],
    },
    {
      number: 13,
      title: 'Story esperando review',
      url: 'https://github.com/acme/checkout/issues/13',
      state: 'open',
      level: 'story',
      labels: ['[STORY]'],
      priority: null,
      area: null,
      stage: 'Code Review',
      stageRaw: 'Code Review',
      milestone: { number: 1, title: 'v1.0' },
      assignees: [{ login: 'dev2', name: null }],
      parentNumber: 11,
      createdAt: '2026-07-05T00:00:00.000Z',
      progress: { total: 2, completed: 1 },
      prs: [
        {
          number: 99,
          title: 'feat: story',
          url: 'https://github.com/acme/checkout/pull/99',
          state: 'open',
          isDraft: false,
          reviewDecision: 'REVIEW_REQUIRED',
          reviewers: ['moacir'],
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
    },
  ],
  displayOrder: [],
};

async function mockApi(page: Page) {
  await page.route('**/api/repositories', (route) =>
    route.fulfill({ json: [REPO] }),
  );
  await page.route(`**/api/repositories/${REPO.id}/snapshot*`, (route) =>
    route.fulfill({ json: SNAPSHOT }),
  );
}

test.describe('Workspaces por papel (RFC-003)', () => {
  test('PM: dashboard com widgets e navegação própria', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/pm/dashboard');

    await expect(page.locator('.ws-sidebar__role')).toHaveText('Product Manager');
    await expect(page.locator('.ws-sidebar__link')).toHaveCount(6);
    await expect(page.locator('.widget').first()).toBeVisible();
    await expect(page.locator('.ws-topbar__repo')).toHaveValue(REPO.id);
  });

  test('PM: project mostra estrutura em tabela e árvore', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/pm/project');

    // Tabela (default): uma linha por item do snapshot, ordenada por número.
    await expect(page.locator('.proj-table tbody tr')).toHaveCount(4);
    await expect(page.locator('.proj-table__id a').first()).toHaveText('#10');

    // Árvore: #11 (com filhos #12/#13) + #10 sem pai → "Itens sem parent".
    await page.getByRole('tab', { name: 'Árvore' }).click();
    await expect(page.getByText('Itens sem parent')).toBeVisible();
    await expect(page.locator('.proj-tree__node')).toHaveCount(4);

    // Collapse: colapsar o nó raiz (#11) esconde os filhos (#12/#13).
    await page.getByRole('button', { name: 'Colapsar' }).click();
    await expect(page.locator('.proj-tree__node')).toHaveCount(2);

    // Criar item de qualquer tipo: o form revela o select de tipo.
    await page.getByRole('button', { name: '+ Novo item' }).click();
    await expect(page.locator('.idea-form select').first()).toBeVisible();
  });

  test('PM: backlog exibe só itens sem prioridade', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/pm/backlog');

    await expect(page.locator('.queue__row')).toHaveCount(1);
    await expect(page.locator('.queue__title')).toContainText('Nova ideia sem prioridade');
  });

  test('PM: prioritization exibe só itens priorizados', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/pm/prioritization');

    await expect(page.locator('.queue__row')).toHaveCount(1);
    await expect(page.locator('.queue__title')).toContainText('Feature priorizada em spec');
  });

  test('troca de papel via switcher muda a navegação', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/pm/dashboard');
    await page.locator('.ws-topbar__role').selectOption('tech');

    await expect(page).toHaveURL(/#\/ws\/tech\/dashboard/);
    await expect(page.locator('.ws-sidebar__role')).toHaveText('Tech Leader');
    await expect(page.locator('.ws-sidebar__link')).toHaveCount(9);
  });

  test('Tech: specification lista features na etapa Spec', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/tech/specification');

    await expect(page.locator('.queue__row')).toHaveCount(1);
    await expect(page.locator('.queue__title')).toContainText('Feature priorizada em spec');
    await expect(page.getByRole('button', { name: 'Approve Spec' })).toBeVisible();
  });

  test('Tech: code review mostra PR, reviewer e espera', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/tech/code-review');

    await expect(page.locator('.queue__row')).toHaveCount(1);
    await expect(page.locator('.prchip')).toContainText('PR #99');
    await expect(page.locator('.prchip')).toContainText('rev: moacir');
  });

  test('Dev: pending filtra pelo milestone corrente e tem Start Story', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/dev/pending');

    await expect(page.locator('.queue__row')).toHaveCount(1);
    await expect(page.locator('.queue__title')).toContainText('Story pronta para começar');
    await expect(page.getByRole('button', { name: 'Start Story' })).toBeVisible();

    // Seletor de milestone só existe no papel dev.
    await expect(page.locator('.ws-topbar__milestone')).toBeVisible();
  });

  test('página desconhecida cai no dashboard do papel', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/ws/dev/nao-existe');

    await expect(page.locator('.ws-content__title')).toHaveText('Dashboard');
  });
});
