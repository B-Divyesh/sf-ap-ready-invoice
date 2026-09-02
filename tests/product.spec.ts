import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('landing explains the job and meets the page baseline', async ({ page }) => {
  const consoleErrors:string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/');
  await expect(page).toHaveTitle('AP-Ready Invoice — Send invoices finance can accept');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Send invoices corporate AP can accept');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('link', {name:'Try it with sample data'})).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(v => ['serious','critical'].includes(v.impact || ''))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('@claim:demo-isolated creates separate disposable workspaces', async ({ browser }) => {
  const first = await browser.newContext();
  const pageA = await first.newPage();
  await pageA.goto('/demo');
  await expect(pageA.getByText('Demo — sample data, nothing is saved.')).toBeVisible();
  await expect(pageA.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const tokenA = await pageA.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  const demoResponse = await pageA.request.get('/api/dashboard', {headers:{'x-workspace-token':String(tokenA)}});
  const demoBody = await demoResponse.json();
  const hoursToExpiry = (Date.parse(`${demoBody.expires_at}Z`) - Date.now()) / 3_600_000;
  expect(hoursToExpiry).toBeGreaterThan(23.9);
  expect(hoursToExpiry).toBeLessThanOrEqual(24.1);
  await pageA.getByRole('button', {name:'Reset demo'}).click();
  await expect(pageA.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const resetToken = await pageA.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  expect(resetToken).not.toBe(tokenA);
  const second = await browser.newContext();
  const pageB = await second.newPage();
  await pageB.goto('/demo');
  await expect(pageB.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const tokenB = await pageB.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  expect(tokenB).not.toBe(resetToken);
  await first.close(); await second.close();
});

test('@claim:preflight flags a required missing PO number', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', {name:'Edit invoice'}).click();
  await page.getByLabel('PO number').fill('');
  await page.getByRole('button', {name:'Run preflight again'}).click();
  await expect(page.getByText('Preflight finished. Review every marked item.')).toBeVisible();
  const row = page.locator('.preflight li').filter({hasText:'Purchase order'});
  await expect(row).toContainText('Fix');
  await expect(page.locator('.next-action')).toContainText('You fix the missing invoice details');
});

test('creates another invoice and opens it from the invoice index', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  await page.getByRole('button', {name:'Add invoice'}).click();
  await page.getByLabel('Invoice number').fill('MVS-1043');
  await page.getByLabel('Amount').fill('1250');
  await page.getByLabel('PO number').fill('PO-74002');
  await page.getByLabel('Work description').fill('Production design support — September milestone');
  await page.getByLabel('Tax identifier').fill('GB 123 4567 89');
  await page.getByLabel('Payment instructions').fill('Account ending 1842');
  await page.getByRole('button', {name:'Save and run preflight'}).click();
  await expect(page.getByText('Preflight finished. Review every marked item.')).toBeVisible();
  await page.getByRole('button', {name:/MVS-1043/}).click();
  await expect(page.getByRole('heading', {name:'Invoice MVS-1043'})).toBeVisible();
});

test('@claim:audit-export exports a receipt row as CSV', async ({ page }) => {
  await page.goto('/demo');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export receipt CSV'}).click();
  const download = await downloadPromise;
  const content = await (await import('node:fs/promises')).readFile(await download.path()!, 'utf8');
  expect(content).toContain('timestamp,event,actor,detail');
  expect(content).toContain('created');
  expect(content.trim().split('\n').length).toBeGreaterThan(1);
});

test('@claim:invoice-packet opens a styled printable invoice and prepares email copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const consoleErrors:string[] = [];
  context.on('page', opened => opened.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  }));
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', {name:'Open invoice packet'}).click();
  const packet = await popupPromise;
  await expect(packet).toHaveURL(/\/packet\/[^?]+\?workspace=demo$/);
  await expect(packet.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  await expect(packet.getByText('Account ending 1842')).toBeVisible();
  await expect(packet.getByRole('link', {name:/\/status\//})).toHaveAttribute('href', /\/status\//);
  const rendered = await packet.evaluate(() => {
    const heading = getComputedStyle(document.querySelector('h1')!);
    const button = document.querySelector('button')!.getBoundingClientRect();
    return {
      styleSheets: document.styleSheets.length,
      headingFont: heading.fontFamily,
      headingSize: heading.fontSize,
      headingBorder: heading.borderBottomWidth,
      buttonHeight: button.height
    };
  });
  expect(rendered.styleSheets).toBeGreaterThan(0);
  expect(rendered.headingFont).toContain('Georgia');
  expect(rendered.headingSize).toBe('44px');
  expect(rendered.headingBorder).toBe('3px');
  expect(rendered.buttonHeight).toBeGreaterThanOrEqual(44);
  const accessibility = await new AxeBuilder({page:packet}).analyze();
  expect(accessibility.violations.filter(violation => ['serious','critical'].includes(violation.impact || ''))).toEqual([]);
  await packet.evaluate(() => {
    window.print = () => { document.documentElement.dataset.printed = 'true'; };
  });
  await packet.getByRole('button', {name:'Print or save PDF'}).click();
  await expect(packet.locator('html')).toHaveAttribute('data-printed', 'true');

  await page.getByRole('button', {name:'Copy email cover note'}).click();
  await expect(page.getByText('Email cover note copied.')).toBeVisible();
  const email = await page.evaluate(() => navigator.clipboard.readText());
  expect(email).toContain('To: ap@northstar.example');
  expect(email).toContain('Subject: Invoice MVS-1042');
  expect(email).toContain('/status/');
  expect(consoleErrors).toEqual([]);
});

test('rejects malformed and impossible invoice dates at the API edge', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  const base = {
    number: 'BAD-DATE-1', amount_cents: 100, currency: 'USD',
    description: 'Invalid date regression', po_number: 'PO-1',
    tax_id: 'tax', bank_details: 'bank'
  };
  for (const dates of [
    {issue_date:'not-a-date', due_date:'zzzz'},
    {issue_date:'2026-02-30', due_date:'2026-03-01'}
  ]) {
    const response = await page.request.post('/api/invoices', {
      headers:{'x-workspace-token':String(token)}, data:{...base, ...dates}
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('real issue date');
  }
  const dashboard = await page.request.get('/api/dashboard', {headers:{'x-workspace-token':String(token)}});
  expect((await dashboard.json()).invoices).toHaveLength(1);
});

test('@claim:purchase-disabled hides checkout and keeps status follow-through available', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href*="/checkout"]')).toHaveCount(0);
  await expect(page.getByText(/\$19|Pro follow-through/i)).toHaveCount(0);
  await page.goto('/demo');
  await expect(page.getByRole('button', {name:'Mark packet sent'})).toBeEnabled();
  await expect(page.getByRole('button', {name:'Copy status link'})).toBeEnabled();
  await page.goto('/pricing');
  await expect(page.getByRole('heading', {name:'Purchases are not available yet'})).toBeVisible();
  await expect(page.locator('a[href*="api.sociobot.in"]')).toHaveCount(0);
});

test('@claim:status-receipt records the finance response', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  const dashboard = await page.request.get('/api/dashboard', {headers:{'x-workspace-token':token!}});
  const invoice = (await dashboard.json()).invoices[0];
  await page.request.post(`/api/invoices/${invoice.id}/send`, {headers:{'x-workspace-token':token!},data:{}});
  await page.goto(`/status/${invoice.status_token}`);
  await page.getByLabel('We received this invoice').check();
  await page.getByLabel('Optional note').fill('Queued for review.');
  await page.getByRole('button', {name:'Send status update'}).click();
  await expect(page.getByText('Received by AP')).toBeVisible();
  const updated = await page.request.get('/api/dashboard', {headers:{'x-workspace-token':token!}});
  const body = await updated.json();
  expect(body.invoices[0].status).toBe('received');
  expect(body.events.some((event:any) => event.detail.includes('Queued for review.'))).toBeTruthy();
});

test('@claim:encrypted-fields stores no plain bank or tax value', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  const response = await page.request.get('/api/security/storage-check', {headers:{'x-workspace-token':String(token)}});
  expect(await response.json()).toEqual({encrypted:true,records:1});
});

test('@claim:no-tracking sends demo traffic only to this origin', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const origins = new Set<string>();
  page.on('request', request => origins.add(new URL(request.url()).origin));
  await page.goto('/demo');
  await page.getByRole('button', {name:'Edit invoice'}).click();
  await page.getByRole('button', {name:'Run preflight again'}).click();
  expect([...origins]).toEqual(['http://127.0.0.1:4173']);
  await context.close();
});

test('mobile workspace has no horizontal overflow and works by keyboard', async ({ browser }) => {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  for (const path of ['/', '/demo', '/pricing', '/privacy', '/terms', '/missing-page']) {
    await page.goto(path);
    if (path === '/demo') await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    const smallTargets = await page.locator('a:visible, button:visible').evaluateAll(elements => elements.flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.width < 44 || box.height < 44
        ? [{name:(element.textContent || element.getAttribute('aria-label') || element.tagName).trim(), width:box.width, height:box.height}]
        : [];
    }));
    expect(smallTargets, `undersized targets on ${path}`).toEqual([]);
  }
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  let reachedSkipLink = false;
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('Tab');
    reachedSkipLink = await page.locator('.skip-link').evaluate(link => link === document.activeElement);
    if (reachedSkipLink) break;
  }
  expect(reachedSkipLink).toBeTruthy();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await context.close();
});

for (const path of ['/demo','/app','/pricing','/privacy','/terms','/missing-page']) {
  test(`accessibility baseline on ${path}`, async ({ page }) => {
    await page.goto(path);
    if (path === '/demo') await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    const results = await new AxeBuilder({page}).analyze();
    expect(results.violations.filter(v => ['serious','critical'].includes(v.impact || ''))).toEqual([]);
  });
}

test('unknown routes return the designed page with HTTP 404', async ({ page }) => {
  const response = await page.goto('/missing-page');
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle('Page not found — AP-Ready Invoice');
  await expect(page.getByRole('heading', {name:'This page is not in the packet'})).toBeVisible();
  await expect(page.getByRole('link', {name:'Return home'})).toBeVisible();
});

test('hashed assets are immutable while HTML is never cached', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['cache-control']).toBe('no-store');
  const assetPath = await page.locator('script[type="module"]').getAttribute('src');
  expect(assetPath).toMatch(/^\/assets\/index-[\w-]+\.js$/);
  const asset = await page.request.get(assetPath!);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('all API routes enforce a forwarded-IP rate limit', async ({ request }) => {
  const responses = await Promise.all(Array.from({length:46}, () => request.post('/api/demo', {headers:{'x-forwarded-for':'198.51.100.77'},data:{}})));
  const limited = responses.find(response => response.status() === 429);
  expect(limited).toBeTruthy();
  expect(limited!.headers()['retry-after']).toBe('1');
});
