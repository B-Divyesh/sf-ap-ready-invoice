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

test('@claim:invoice-packet provides printable invoice and email copy', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  await expect(page.getByRole('button', {name:'Open invoice packet'})).toBeEnabled();
  await expect(page.getByRole('button', {name:'Copy email cover note'})).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  const dashboard = await page.request.get('/api/dashboard', {headers:{'x-workspace-token':String(token)}});
  const invoice = (await dashboard.json()).invoices[0];
  const response = await page.request.get(`/api/invoices/${invoice.id}/packet`, {headers:{'x-workspace-token':String(token)}});
  const packet = await response.json();
  expect(packet.email.to).toBe('ap@northstar.example');
  expect(packet.email.body).toContain(`/status/${invoice.status_token}`);
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
  await page.goto('/demo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toBeFocused();
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

test('all API routes enforce a forwarded-IP rate limit', async ({ request }) => {
  const responses = await Promise.all(Array.from({length:46}, () => request.post('/api/demo', {headers:{'x-forwarded-for':'198.51.100.77'},data:{}})));
  const limited = responses.find(response => response.status() === 429);
  expect(limited).toBeTruthy();
  expect(limited!.headers()['retry-after']).toBe('1');
});
