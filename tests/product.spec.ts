import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type Profile = { id:string; freelancer_name:string; company_name:string; ap_email:string; billing_address:string; po_required:boolean; tax_required:boolean; bank_required:boolean; escalation_days:number };
type Invoice = { id:string; number:string; status:string; status_token:string; profile_id:string; checks:Array<{key:string; ready:boolean}>; next_action:string };
type Dashboard = { profiles:Profile[]; invoices:Invoice[]; events:Array<{invoice_id:string; detail:string}>; expires_at:string };

const invoicePayload = (profileId:string, number:string, overrides:Record<string, unknown> = {}) => ({
  profile_id:profileId,
  number,
  amount_cents:125000,
  currency:'USD',
  issue_date:'2026-09-01',
  due_date:'2026-10-01',
  description:'Production design support for the September milestone',
  po_number:'PO-74002',
  tax_id:'GB 123 4567 89',
  bank_details:'Account ending 1842',
  ...overrides
});

const profilePayload = (overrides:Record<string, unknown> = {}) => ({
  freelancer_name:'Mara Vale Studio',
  company_name:'Fieldline Media Ltd',
  ap_email:'finance@fieldline.example',
  billing_address:'14 Green Street, London W1K 7DA',
  po_required:false,
  tax_required:false,
  bank_required:true,
  escalation_days:7,
  ...overrides
});

async function demo(page:Page) {
  await page.goto('/demo');
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  expect(token).toBeTruthy();
  const response = await page.request.get('/api/dashboard', {headers:{'x-workspace-token':String(token)}});
  expect(response.ok()).toBeTruthy();
  return {token:String(token), dashboard:await response.json() as Dashboard};
}

async function dashboard(page:Page, token:string) {
  const response = await page.request.get('/api/dashboard', {headers:{'x-workspace-token':token}});
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Dashboard>;
}

test('landing explains the job and has no serious or critical accessibility issue', async ({ page }) => {
  const consoleErrors:string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/');
  await expect(page).toHaveTitle('AP-Ready Invoice — Send invoices finance can accept');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Send invoices corporate AP can accept');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('link', {name:'Try it with sample data'})).toBeVisible();
  const results = await new AxeBuilder({page}).analyze();
  expect(results.violations.filter(item => ['serious','critical'].includes(item.impact || ''))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('@claim:demo-isolated replaces an expired sample and hides its old status link', async ({ browser }) => {
  const real = await browser.newContext();
  const realPage = await real.newPage();
  await realPage.goto('/app');
  await expect(realPage.getByRole('heading', {name:'Prepare your first AP packet'})).toBeVisible();
  const realToken = await realPage.evaluate(() => localStorage.getItem('apri:workspace'));
  expect(realToken).toBeTruthy();
  const realBlank = await dashboard(realPage, String(realToken));
  const configureReal = await realPage.request.put(`/api/profiles/${realBlank.profiles[0].id}`, {
    headers:{'x-workspace-token':String(realToken)},
    data:profilePayload()
  });
  expect(configureReal.status()).toBe(200);
  const realInvoice = await realPage.request.post('/api/invoices', {
    headers:{'x-workspace-token':String(realToken)},
    data:invoicePayload(realBlank.profiles[0].id, 'REAL-KEEP')
  });
  expect(realInvoice.status()).toBe(201);

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  const firstDemo = await demo(firstPage);
  const hoursToExpiry = (Date.parse(`${firstDemo.dashboard.expires_at}Z`) - Date.now()) / 3_600_000;
  expect(hoursToExpiry).toBeGreaterThan(23.9);
  expect(hoursToExpiry).toBeLessThanOrEqual(24.1);

  await firstPage.getByRole('button', {name:'Reset demo'}).click();
  await expect(firstPage.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const resetToken = await firstPage.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  expect(resetToken).not.toBe(firstDemo.token);
  const resetDashboard = await dashboard(firstPage, String(resetToken));
  const expiredInvoice = resetDashboard.invoices.find(invoice => invoice.number === 'MVS-1042')!;

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  const secondDemo = await demo(secondPage);
  expect(secondDemo.token).not.toBe(resetToken);

  const expire = await firstPage.request.post(`/api/test/demo/${resetToken}/expire`, {data:{}});
  expect(expire.status()).toBe(204);
  await firstPage.reload();
  await expect(firstPage.getByText('Demo — sample data, nothing is saved.')).toBeVisible();
  await expect(firstPage.getByRole('button', {name:'Reset demo'})).toBeVisible();
  await expect(firstPage.getByRole('heading', {name:'The demo could not open'})).toBeVisible();
  await firstPage.getByRole('button', {name:'Reset demo'}).click();
  await expect(firstPage.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  const recoveredToken = await firstPage.evaluate(() => localStorage.getItem('demo:apri:workspace'));
  expect(recoveredToken).not.toBe(resetToken);

  const oldStatus = await firstPage.request.get(`/api/status/${expiredInvoice.status_token}`);
  expect(oldStatus.status()).toBe(404);
  const oldAction = await firstPage.request.post(`/api/status/${expiredInvoice.status_token}/action`, {data:{action:'received'}});
  expect(oldAction.status()).toBe(404);
  const realAfterDemo = await dashboard(realPage, String(realToken));
  expect(realAfterDemo.invoices.map(invoice => invoice.number)).toEqual(['REAL-KEEP']);
  await real.close();
  await first.close();
  await second.close();
});

test('@claim:profile-snapshot keeps profile rules and packet recipient details on their original invoice', async ({ page }) => {
  const sample = await demo(page);
  const original = sample.dashboard.profiles[0];
  const updateOriginal = await page.request.put(`/api/profiles/${original.id}`, {
    headers:{'x-workspace-token':sample.token},
    data:profilePayload({company_name:'Northstar Systems Ltd', ap_email:'ap@northstar.example', po_required:false, tax_required:true, bank_required:true, escalation_days:5})
  });
  expect(updateOriginal.status()).toBe(200);
  const firstInvoiceResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(original.id, 'SNAP-ONE', {po_number:''})
  });
  expect(firstInvoiceResponse.status()).toBe(201);
  const firstInvoice = await firstInvoiceResponse.json() as Invoice;
  expect(firstInvoice.status).toBe('ready');

  const secondProfileResponse = await page.request.post('/api/profiles', {
    headers:{'x-workspace-token':sample.token},
    data:profilePayload({company_name:'Second Client Works', ap_email:'ap@second-client.example', po_required:true})
  });
  expect(secondProfileResponse.status()).toBe(200);
  const secondProfile = await secondProfileResponse.json() as Profile;
  const secondInvoiceResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(secondProfile.id, 'SNAP-TWO', {po_number:''})
  });
  expect(secondInvoiceResponse.status()).toBe(201);
  const secondInvoice = await secondInvoiceResponse.json() as Invoice;
  expect(secondInvoice.status).toBe('draft');

  const mutateProfile = await page.request.put(`/api/profiles/${original.id}`, {
    headers:{'x-workspace-token':sample.token},
    data:profilePayload({company_name:'Changed Client Holdings', ap_email:'changed-ap@example.test', po_required:true, tax_required:false, bank_required:false, escalation_days:14})
  });
  expect(mutateProfile.status()).toBe(200);

  const packet = await page.request.get(`/api/invoices/${firstInvoice.id}/packet`, {headers:{'x-workspace-token':sample.token}});
  expect(packet.status()).toBe(200);
  const packetBody = await packet.json();
  expect(packetBody.profile.company_name).toBe('Northstar Systems Ltd');
  expect(packetBody.email.to).toBe('ap@northstar.example');
  expect(packetBody.invoice.status).toBe('ready');
  expect(packetBody.invoice.checks.find((check:any) => check.key === 'po').ready).toBeTruthy();

  await page.goto(`/packet/${firstInvoice.id}?workspace=demo`);
  await expect(page.getByRole('heading', {name:'Invoice SNAP-ONE'})).toBeVisible();
  await expect(page.getByText('Northstar Systems Ltd')).toBeVisible();
  await expect(page.getByText('Changed Client Holdings')).toHaveCount(0);

  const status = await page.request.get(`/api/status/${firstInvoice.status_token}`);
  expect(status.status()).toBe(200);
  expect((await status.json()).company).toBe('Northstar Systems Ltd');
});

test('@claim:preflight sets ready on create and refuses missing selected-profile requirements', async ({ page }) => {
  const sample = await demo(page);
  const requiredProfile = sample.dashboard.profiles[0];
  const validResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(requiredProfile.id, 'READY-ON-CREATE')
  });
  expect(validResponse.status()).toBe(201);
  const valid = await validResponse.json() as Invoice;
  expect(valid.status).toBe('ready');
  expect(valid.checks.every(check => check.ready)).toBeTruthy();
  const sent = await page.request.post(`/api/invoices/${valid.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  expect(sent.status()).toBe(200);

  const missingResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(requiredProfile.id, 'MISSING-PO', {po_number:''})
  });
  expect(missingResponse.status()).toBe(201);
  const missing = await missingResponse.json() as Invoice;
  expect(missing.status).toBe('draft');
  expect(missing.checks.find(check => check.key === 'po')?.ready).toBeFalsy();
  const blocked = await page.request.post(`/api/invoices/${missing.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  expect(blocked.status()).toBe(400);

  const optionalProfileResponse = await page.request.post('/api/profiles', {
    headers:{'x-workspace-token':sample.token},
    data:profilePayload({company_name:'No PO Client', po_required:false, tax_required:false})
  });
  const optionalProfile = await optionalProfileResponse.json() as Profile;
  const switchableResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(optionalProfile.id, 'SWITCH-PROFILE', {po_number:''})
  });
  const switchable = await switchableResponse.json() as Invoice;
  expect(switchable.status).toBe('ready');
  const selectedProfileUpdate = await page.request.put(`/api/invoices/${switchable.id}`, {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(requiredProfile.id, 'SWITCH-PROFILE', {po_number:''})
  });
  expect(selectedProfileUpdate.status()).toBe(200);
  const selectedProfileInvoice = await selectedProfileUpdate.json() as Invoice;
  expect(selectedProfileInvoice.status).toBe('draft');
  expect(selectedProfileInvoice.checks.find(check => check.key === 'po')?.ready).toBeFalsy();
  const switchedBlocked = await page.request.post(`/api/invoices/${switchable.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  expect(switchedBlocked.status()).toBe(400);
});

test('@claim:invoice-packet uses the selected invoice for send, copy, and packet actions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const consoleErrors:string[] = [];
  for (const openPage of context.pages()) openPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  context.on('page', openPage => openPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); }));
  const sample = await demo(page);
  const source = sample.dashboard.invoices.find(invoice => invoice.number === 'MVS-1042')!;
  const secondResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(source.profile_id, 'SECOND-DRAFT', {po_number:''})
  });
  expect(secondResponse.status()).toBe(201);
  const second = await secondResponse.json() as Invoice;
  expect(second.status).toBe('draft');

  await page.reload();
  await page.getByRole('button', {name:/MVS-1042/}).click();
  await page.getByRole('button', {name:'Mark packet sent'}).click();
  await expect(page.locator('.next-action')).toContainText('Accounts payable confirms receipt');
  const afterSend = await dashboard(page, sample.token);
  expect(afterSend.invoices.find(invoice => invoice.id === source.id)?.status).toBe('waiting_on_ap');
  expect(afterSend.invoices.find(invoice => invoice.id === second.id)?.status).toBe('draft');

  await page.getByRole('button', {name:'Copy status link'}).click();
  await expect(page.getByText('Secure status link copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(source.status_token);
  await page.getByRole('button', {name:'Copy email cover note'}).click();
  await expect(page.getByText('Email cover note copied.')).toBeVisible();
  const email = await page.evaluate(() => navigator.clipboard.readText());
  expect(email).toContain('Subject: Invoice MVS-1042');
  expect(email).toContain(source.status_token);

  const firstPopup = page.waitForEvent('popup');
  await page.getByRole('button', {name:'Open invoice packet'}).click();
  const firstPacket = await firstPopup;
  await expect(firstPacket.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  await expect(firstPacket.getByRole('link', {name:/\/status\//})).toHaveAttribute('href', new RegExp(source.status_token));
  const rendered = await firstPacket.evaluate(() => {
    const heading = getComputedStyle(document.querySelector('h1')!);
    const button = document.querySelector('button')!.getBoundingClientRect();
    return {styleSheets:document.styleSheets.length, headingFont:heading.fontFamily, headingSize:heading.fontSize, headingBorder:heading.borderBottomWidth, buttonHeight:button.height};
  });
  expect(rendered.styleSheets).toBeGreaterThan(0);
  expect(rendered.headingFont).toContain('Georgia');
  expect(rendered.headingSize).toBe('44px');
  expect(rendered.headingBorder).toBe('3px');
  expect(rendered.buttonHeight).toBeGreaterThanOrEqual(44);
  await firstPacket.evaluate(() => { window.print = () => { document.documentElement.dataset.printed = 'true'; }; });
  await firstPacket.getByRole('button', {name:'Print or save PDF'}).click();
  await expect(firstPacket.locator('html')).toHaveAttribute('data-printed','true');
  await firstPacket.close();

  const readySecond = await page.request.put(`/api/invoices/${second.id}`, {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(source.profile_id, 'SECOND-DRAFT', {po_number:'PO-SECOND'})
  });
  expect(readySecond.status()).toBe(200);
  await page.reload();
  await page.getByRole('button', {name:/SECOND-DRAFT/}).click();
  const secondPopup = page.waitForEvent('popup');
  await page.getByRole('button', {name:'Open invoice packet'}).click();
  const secondPacket = await secondPopup;
  await expect(secondPacket.getByRole('heading', {name:'Invoice SECOND-DRAFT'})).toBeVisible();
  await expect(secondPacket.getByText('PO-SECOND')).toBeVisible();
  await secondPacket.close();

  const accessibility = await new AxeBuilder({page}).analyze();
  expect(accessibility.violations.filter(item => ['serious','critical'].includes(item.impact || ''))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('@claim:audit-export exports only the selected invoice receipt trail as escaped CSV', async ({ page }) => {
  const sample = await demo(page);
  const source = sample.dashboard.invoices[0];
  await page.request.post(`/api/invoices/${source.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  await page.request.post(`/api/status/${source.status_token}/action`, {data:{action:'received', note:'Current, "quoted" receipt'}});
  const secondResponse = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(source.profile_id, 'CSV-SECOND')
  });
  const second = await secondResponse.json() as Invoice;
  await page.request.post(`/api/invoices/${second.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  await page.request.post(`/api/status/${second.status_token}/action`, {data:{action:'received', note:'Second invoice only'}});

  await page.reload();
  await page.getByRole('button', {name:/MVS-1042/}).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export receipt CSV'}).click();
  const download = await downloadPromise;
  const content = await readFile(await download.path()!, 'utf8');
  expect(content).toContain('timestamp,event,actor,detail');
  expect(content).toContain('"Receipt confirmed: Current, ""quoted"" receipt"');
  expect(content).not.toContain('Second invoice only');
});

test('@claim:status-receipt records the finance recipient response on the right invoice', async ({ page }) => {
  const sample = await demo(page);
  const invoice = sample.dashboard.invoices[0];
  const sent = await page.request.post(`/api/invoices/${invoice.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  expect(sent.status()).toBe(200);
  await page.goto(`/status/${invoice.status_token}`);
  await expect(page).toHaveTitle('Invoice MVS-1042 status — AP-Ready Invoice');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://ap-ready-invoice.sociobot.in/');
  await page.getByLabel('We received this invoice').check();
  await page.getByLabel('Optional note').fill('Queued for review.');
  await page.getByRole('button', {name:'Send status update'}).click();
  await expect(page.getByText('Received by AP')).toBeVisible();
  const updated = await dashboard(page, sample.token);
  expect(updated.invoices.find(item => item.id === invoice.id)?.status).toBe('received');
  expect(updated.events.some(event => event.invoice_id === invoice.id && event.detail.includes('Queued for review.'))).toBeTruthy();
});

test('@claim:encrypted-fields stores bank and tax values as ciphertext in the isolated SQLite database', async ({ page }) => {
  const sample = await demo(page);
  const invoice = sample.dashboard.invoices[0];
  const directory = await mkdtemp(join(tmpdir(), 'ap-ready-invoice-test-'));
  const snapshot = join(directory, 'invoice.sqlite3');
  await copyFile(join(process.env.AP_READY_TEST_DATA_DIR!, 'ap-ready-invoice.sqlite3'), snapshot);
  const database = new DatabaseSync(snapshot, {readOnly:true});
  const row = database.prepare('SELECT tax_id_enc, bank_details_enc FROM invoices WHERE id = ?').get(invoice.id) as {tax_id_enc:string; bank_details_enc:string};
  database.close();
  await rm(directory, {recursive:true, force:true});
  expect(row.tax_id_enc).not.toContain('GB 123 4567 89');
  expect(row.bank_details_enc).not.toContain('Account ending 1842');
  expect(row.tax_id_enc.length).toBeGreaterThan('GB 123 4567 89'.length);
  expect(row.bank_details_enc.length).toBeGreaterThan('Account ending 1842'.length);
});

test('@claim:no-tracking keeps full demo, packet, and status traffic on this origin', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const origins = new Set<string>();
  context.on('request', request => origins.add(new URL(request.url()).origin));
  const sample = await demo(page);
  const invoice = sample.dashboard.invoices[0];
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', {name:'Open invoice packet'}).click();
  const packet = await popupPromise;
  await expect(packet.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  await packet.close();
  await page.request.post(`/api/invoices/${invoice.id}/send`, {headers:{'x-workspace-token':sample.token}, data:{}});
  await page.goto(`/status/${invoice.status_token}`);
  await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
  expect([...origins]).toEqual(['http://127.0.0.1:4173']);
  await context.close();
});

test('@claim:purchase-disabled hides checkout while registration is unavailable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href*="/checkout"]')).toHaveCount(0);
  await expect(page.getByText(/\$19|Pro follow-through/i)).toHaveCount(0);
  await page.goto('/pricing');
  await expect(page.getByRole('heading', {name:'Purchases are not available yet'})).toBeVisible();
  await expect(page.locator('a[href*="api.sociobot.in"]')).toHaveCount(0);
});

test('rejects malformed AP email and accepts 500 Unicode characters at the API edge', async ({ page }) => {
  const sample = await demo(page);
  const profile = sample.dashboard.profiles[0];
  const invalidEmail = await page.request.put(`/api/profiles/${profile.id}`, {
    headers:{'x-workspace-token':sample.token},
    data:profilePayload({company_name:'Northstar Systems Ltd', ap_email:'@'})
  });
  expect(invalidEmail.status()).toBe(400);
  expect((await invalidEmail.json()).error).toContain('complete finance email');
  const unicode = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(profile.id, 'UNICODE-500', {description:'é'.repeat(500)})
  });
  expect(unicode.status()).toBe(201);
  const tooLong = await page.request.post('/api/invoices', {
    headers:{'x-workspace-token':sample.token},
    data:invoicePayload(profile.id, 'UNICODE-501', {description:'é'.repeat(501)})
  });
  expect(tooLong.status()).toBe(400);
});

test('mobile workspace keeps focus in the first visible invoice field and has full landmark coverage', async ({ browser }) => {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  for (const path of ['/','/demo','/pricing','/privacy','/terms','/missing-page']) {
    await page.goto(path);
    if (path === '/demo') await expect(page.getByRole('heading', {name:'Invoice MVS-1042'})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
    const smallTargets = await page.locator('a:visible, button:visible').evaluateAll(elements => elements.flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.width < 44 || box.height < 44 ? [{name:(element.textContent || element.tagName).trim(), width:box.width, height:box.height}] : [];
    }));
    expect(smallTargets, `undersized targets on ${path}`).toEqual([]);
    const results = await new AxeBuilder({page}).analyze();
    expect(results.violations).toEqual([]);
  }
  await page.goto('/demo');
  await page.getByRole('button', {name:'Edit invoice'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Invoice number')).toBeFocused();
  await context.close();
});

test('unknown routes return a designed HTTP 404 and response policies include HSTS', async ({ page }) => {
  const root = await page.goto('/');
  expect(root?.headers()['strict-transport-security']).toBe('max-age=31536000');
  expect(root?.headers()['cache-control']).toBe('no-store');
  const assetPath = await page.locator('script[type="module"]').getAttribute('src');
  expect(assetPath).toMatch(/^\/assets\/index-[\w-]+\.js$/);
  const asset = await page.request.get(assetPath!);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  const demoApi = await page.request.post('/api/demo', {data:{}});
  expect(demoApi.headers()['cache-control']).toBe('no-store');

  const missing = await page.goto('/missing-page');
  expect(missing?.status()).toBe(404);
  await expect(page).toHaveTitle('Page not found — AP-Ready Invoice');
  await expect(page.getByRole('heading', {name:'This page is not in the packet'})).toBeVisible();
});

test('all API routes enforce a forwarded-IP rate limit with Retry-After', async ({ request }) => {
  const responses = await Promise.all(Array.from({length:46}, () => request.post('/api/demo', {headers:{'x-forwarded-for':'198.51.100.77'}, data:{}})));
  const limited = responses.find(response => response.status() === 429);
  expect(limited).toBeTruthy();
  expect(limited!.headers()['retry-after']).toBe('1');
});
