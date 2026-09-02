import './style.css';
import './pro.css';

type Profile = { freelancer_name:string; company_name:string; ap_email:string; billing_address:string; po_required:boolean; tax_required:boolean; bank_required:boolean; escalation_days:number };
type Check = { key:string; label:string; ready:boolean; help:string };
type Invoice = { id:string; number:string; amount_cents:number; currency:string; issue_date:string; due_date:string; description:string; po_number:string; tax_id:string; bank_details:string; status:string; status_token:string; checks:Check[]; next_action:string; created_at:string };
type EventRow = { id:number; event_type:string; actor:string; detail:string; created_at:string };
type Dashboard = { profile:Profile; invoices:Invoice[]; events:EventRow[]; demo:boolean };

const app = document.querySelector<HTMLDivElement>('#app')!;
const titles: Record<string,string> = {
  '/':'AP-Ready Invoice — Send invoices finance can accept', '/demo':'Demo — AP-Ready Invoice', '/app':'Workspace — AP-Ready Invoice',
  '/privacy':'Privacy — AP-Ready Invoice', '/terms':'Terms — AP-Ready Invoice', '/pricing':'Pricing — AP-Ready Invoice'
};
const storageKey = 'apri:workspace';
const demoKey = 'demo:apri:workspace';
const licenseKey = 'sb_license:ap-ready-invoice';
let dashboardData: Dashboard | null = null;
let notice = '';

const esc = (v:unknown) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));
const money = (cents:number, currency:string) => new Intl.NumberFormat('en', {style:'currency',currency}).format(cents / 100);
const statusName = (status:string) => ({draft:'Needs details',ready:'Ready to send',waiting_on_ap:'Waiting on AP',received:'Received by AP',needs_changes:'Changes requested',approved:'Approved'}[status] || status);

function header(active = '') {
  return `<header class="site-header"><a class="wordmark" href="/" data-route aria-label="AP-Ready Invoice home"><span>AP</span> Ready Invoice</a>
  <nav aria-label="Main navigation"><a href="/demo" data-route ${active==='demo'?'aria-current="page"':''}>Demo</a><a href="/app" data-route ${active==='app'?'aria-current="page"':''}>Workspace</a><a href="/pricing" data-route ${active==='pricing'?'aria-current="page"':''}>Pricing</a><a href="/privacy" data-route ${active==='privacy'?'aria-current="page"':''}>Privacy</a></nav></header>`;
}
function footer() { return `<footer><p>Invoice handoff for independent professionals.</p><nav aria-label="Footer"><a href="/privacy" data-route>Privacy</a><a href="/terms" data-route>Terms</a><a href="https://hello-factory.sociobot.in">Built by Param Factory <span class="sr-only">(external site)</span></a></nav><p class="folio">Version 1.0 · Original generated artwork</p></footer>`; }

function demoBanner() { return `<aside class="demo-banner" aria-label="Demo mode"><strong>Demo — sample data, nothing is saved.</strong><span>This separate demo expires in 24 hours.</span><button type="button" data-action="reset-demo">Reset demo</button><a href="/app" data-route>Start for real</a></aside>`; }

function landing() {
  app.innerHTML = `${header()}<main id="main"><section class="hero"><div class="hero-copy"><p class="kicker">Invoice handoff for corporate finance</p><h1 tabindex="-1">Send invoices corporate AP can accept</h1><p class="dek">For freelancers who need finance teams to approve invoices without another correction round.</p><div class="hero-action"><a class="button primary" href="/demo" data-route>Try it with sample data</a><span>See a checked invoice and its next action.</span></div><ul class="plain-facts"><li>Sample data expires after 24 hours.</li><li>Bank and tax fields are encrypted.</li><li>Pro follow-through costs $19 per month.</li></ul></div><figure class="hero-art"><picture><source type="image/webp" srcset="/invoice-broadsheet-720.webp 720w, /invoice-broadsheet-1200.webp 1200w" sizes="(max-width: 700px) 100vw, 48vw"><img src="/invoice-broadsheet-1200.webp" width="1200" height="800" fetchpriority="high" alt="An invoice, purchase order slip, envelope, and red pencil arranged on newsprint."></picture><figcaption>Check the packet before finance does.</figcaption></figure></section>
  <section class="preview" aria-labelledby="preview-title"><div class="section-label">Live preview · MVS-1042</div><div><h2 id="preview-title">Know who acts next</h2><p class="measure">Every requirement becomes a visible check. Every handoff adds a dated receipt.</p><div class="preview-checks"><p><span>01</span> AP email and address <b>Ready</b></p><p><span>02</span> Purchase order <b>Ready</b></p><p><span>03</span> Bank instructions <b>Ready</b></p></div></div><aside class="margin-note"><span>Next action</span><strong>You send the invoice packet</strong></aside></section>
  <section class="how" aria-labelledby="how-title"><div class="section-label">How it works</div><div><h2 id="how-title">Pass the first AP review</h2><ol><li><span>1</span><div><h3>Save the client rules</h3><p>Record the finance email, PO rule, billing address, and tax needs once.</p></div></li><li><span>2</span><div><h3>Check the invoice</h3><p>Fix each missing field before you send the packet.</p></div></li><li><span>3</span><div><h3>Track the handoff</h3><p>Share a status link and keep a dated receipt trail.</p></div></li></ol></div></section>
  <section class="boundaries" aria-labelledby="boundaries-title"><div class="section-label">Scope and privacy</div><div><h2 id="boundaries-title">A handoff tool, not bookkeeping</h2><p>It does not take card payments or replace your ledger. It never claims to be your client's AP system.</p><p>Sensitive invoice fields are encrypted on the server. You can export the receipt trail as CSV.</p></div></section>
  <section class="price" aria-labelledby="price-title"><div><p class="kicker">Pro follow-through</p><h2 id="price-title">$19 per month</h2><p>Save client profiles, keep active invoices, and track AP replies. The demo stays free.</p></div><a class="button primary" href="https://api.sociobot.in/api/v1/products/ap-ready-invoice/checkout">Buy Pro for $19 monthly <span class="sr-only">(hosted checkout)</span></a><p class="small">Sociobot is the merchant of record. <a href="/terms" data-route>Read the terms</a>.</p></section></main>${footer()}`;
}

async function api<T>(path:string, options:RequestInit = {}, token?:string): Promise<T> {
  const headers = new Headers(options.headers); headers.set('content-type','application/json');
  if (token) headers.set('x-workspace-token',token);
  const response = await fetch(`/api${path}`, {...options,headers});
  if (!response.ok) { const body = await response.json().catch(()=>({error:'The request failed. Reload and try again.'})); throw new Error(body.error || 'The request failed. Reload and try again.'); }
  return response.json();
}

async function ensureWorkspace(demo:boolean) {
  const key = demo ? demoKey : storageKey; let token = localStorage.getItem(key);
  if (!token) { const made = await api<{token:string}>(demo ? '/demo' : '/workspaces', {method:'POST',body:'{}'}); token = made.token; localStorage.setItem(key,token); }
  return token;
}

async function productPage(demo:boolean) {
  app.innerHTML = `${header(demo?'demo':'app')}${demo?demoBanner():''}<main id="main"><div class="loading" role="status"><span></span><h1 tabindex="-1">${demo?'Opening the sample invoice':'Opening your workspace'}</h1><p>Loading the AP checks and receipt trail.</p></div></main>${footer()}`;
  try { const token = await ensureWorkspace(demo); dashboardData = await api<Dashboard>('/dashboard', {}, token); renderWorkspace(dashboardData, demo); }
  catch (error) { renderError(demo?'The demo could not open':'Your workspace could not open', (error as Error).message, ()=>productPage(demo)); }
}

function invoiceForm(invoice?:Invoice) {
  const today = new Date().toISOString().slice(0,10); const due = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  return `<form id="invoice-form" class="sheet-form"><input type="hidden" name="id" value="${esc(invoice?.id||'')}"><div class="form-grid"><label>Invoice number<input name="number" required maxlength="50" value="${esc(invoice?.number||'')}"></label><label>Amount<input name="amount" required inputmode="decimal" value="${invoice?invoice.amount_cents/100:''}"></label><label>Currency<select name="currency">${['USD','GBP','EUR','CAD','AUD','INR'].map(c=>`<option ${invoice?.currency===c?'selected':''}>${c}</option>`).join('')}</select></label><label>Issue date<input type="date" name="issue_date" required value="${esc(invoice?.issue_date||today)}"></label><label>Due date<input type="date" name="due_date" required value="${esc(invoice?.due_date||due)}"></label><label>PO number<input name="po_number" value="${esc(invoice?.po_number||'')}"></label><label class="wide">Work description<textarea name="description" maxlength="500" required>${esc(invoice?.description||'')}</textarea></label><label>Tax identifier<input name="tax_id" autocomplete="off" value="${esc(invoice?.tax_id||'')}"></label><label>Payment instructions<input name="bank_details" autocomplete="off" value="${esc(invoice?.bank_details||'')}"></label></div><div id="form-error" class="form-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">${invoice?'Run preflight again':'Save and run preflight'}</button><button type="button" data-action="close-form">Cancel</button></div></form>`;
}

function renderWorkspace(data:Dashboard, demo:boolean, formOpen=false) {
  const invoice = data.invoices[0]; const ready = invoice?.checks.filter(c=>c.ready).length || 0; const total = invoice?.checks.length || 0;
  queueMicrotask(()=>gatePaidActions(demo));
  app.innerHTML = `${header(demo?'demo':'app')}${demo?demoBanner():''}<main id="main" class="workspace"><section class="workspace-head"><div><p class="kicker">${demo?'Sample workspace':'Your workspace'}</p><h1 tabindex="-1">${invoice?`Invoice ${esc(invoice.number)}`:'Prepare your first AP packet'}</h1><p>${invoice?`${esc(data.profile.company_name)} · ${money(invoice.amount_cents,invoice.currency)}`:'Save the client rules, then add an invoice.'}</p></div><button class="primary" data-action="${invoice?'edit-invoice':'new-invoice'}">${invoice?'Edit invoice':'Add invoice'}</button></section>${notice?`<div class="notice" role="status">${esc(notice)}</div>`:''}
  ${!data.profile.ap_email?profileEditor(data.profile):''}
  ${formOpen?invoiceForm(invoice):''}
  ${invoice?`<div class="workspace-grid"><section class="preflight" aria-labelledby="preflight-title"><div class="section-heading"><div><p class="kicker">Preflight · ${ready}/${total} ready</p><h2 id="preflight-title">AP requirements</h2></div><span class="stamp ${ready===total?'pass':'fix'}">${ready===total?'Ready':'Fix items'}</span></div><ol>${invoice.checks.map((c,i)=>`<li class="${c.ready?'checked':'missing'}"><span class="check-number">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(c.label)}</strong>${!c.ready?`<small>${esc(c.help)}</small>`:''}</div><b>${c.ready?'Ready':'Fix'}</b></li>`).join('')}</ol></section>
  <aside class="action-column"><div class="next-action"><span>Next action</span><strong>${esc(invoice.next_action)}</strong></div><dl><div><dt>Status</dt><dd>${esc(statusName(invoice.status))}</dd></div><div><dt>Due</dt><dd>${esc(invoice.due_date)}</dd></div><div><dt>Client</dt><dd>${esc(data.profile.company_name)}</dd></div></dl><button data-action="open-packet" ${ready<total?'disabled':''}>Open invoice packet</button><button class="primary" data-action="mark-sent" ${invoice.status!=='ready'?'disabled':''}>Mark packet sent</button><button data-action="copy-status">Copy status link</button><button data-action="export-audit">Export receipt CSV</button></aside></div>
  <section class="receipt" aria-labelledby="receipt-title"><div class="section-heading"><div><p class="kicker">Delivery record</p><h2 id="receipt-title">Receipt trail</h2></div></div>${data.events.length?`<ol>${data.events.map(e=>`<li><time>${esc(e.created_at.replace('T',' '))}</time><strong>${esc(e.actor)}</strong><span>${esc(e.detail)}</span></li>`).join('')}</ol>`:'<div class="empty"><p>No handoff events yet.</p><p>Run preflight to add the first receipt.</p></div>'}</section>`:`<section class="empty-state"><span class="big-number">00</span><h2>No invoices yet</h2><p>Your preflight checks and receipt trail will appear here.</p><button class="primary" data-action="new-invoice">Add your first invoice</button></section>`}
  <section class="profile-summary"><div><p class="kicker">Client AP profile</p><h2>${esc(data.profile.company_name||'No client saved')}</h2></div><p>${data.profile.ap_email?`${esc(data.profile.ap_email)} · Follow up after ${data.profile.escalation_days} days.`:'Add the finance team and its invoice rules.'}</p><button data-action="edit-profile">Edit client rules</button></section></main>${footer()}`;
}

function gatePaidActions(demo:boolean) {
  if (demo || localStorage.getItem(`${licenseKey}:verified`)) return;
  document.querySelectorAll<HTMLButtonElement>('[data-action="mark-sent"],[data-action="copy-status"]').forEach(button=>button.disabled=true);
  const column=document.querySelector('.action-column');
  if(column&&!column.querySelector('.pro-lock'))column.insertAdjacentHTML('beforeend','<p class="pro-lock">Status follow-through needs Pro. <a href="/pricing" data-route>See the $19 monthly plan</a>.</p>');
}

function profileEditor(p:Profile) { return `<section class="profile-editor" aria-labelledby="profile-title"><h2 id="profile-title">Save the client AP rules</h2><form id="profile-form"><div class="form-grid"><label>Your business name<input name="freelancer_name" required value="${esc(p.freelancer_name)}"></label><label>Client company<input name="company_name" required value="${esc(p.company_name)}"></label><label>Finance email<input name="ap_email" type="email" required value="${esc(p.ap_email)}"></label><label>Billing address<textarea name="billing_address" required>${esc(p.billing_address)}</textarea></label><label>Follow up after days<input name="escalation_days" type="number" min="1" max="30" required value="${p.escalation_days||5}"></label></div><fieldset><legend>Required on each invoice</legend><label class="check"><input type="checkbox" name="po_required" ${p.po_required?'checked':''}> Purchase order</label><label class="check"><input type="checkbox" name="tax_required" ${p.tax_required?'checked':''}> Tax identifier</label><label class="check"><input type="checkbox" name="bank_required" ${p.bank_required?'checked':''}> Payment instructions</label></fieldset><div id="form-error" class="form-error" role="alert"></div><button class="primary" type="submit">Save client rules</button></form></section>`; }

async function printPacket(invoice:Invoice, profile:Profile) {
  const token = localStorage.getItem(location.pathname==='/demo'?demoKey:storageKey)!; const packet = await api<any>(`/invoices/${invoice.id}/packet`,{},token);
  const win = window.open('', '_blank'); if (!win) { notice='Your browser blocked the print window. Allow pop-ups and try again.'; renderWorkspace(dashboardData!,location.pathname==='/demo'); return; }
  win.document.write(`<!doctype html><html lang="en"><head><title>Invoice ${esc(invoice.number)}</title><style>body{font:16px Arial;color:#151513;margin:48px}h1{font:44px Georgia;border-bottom:3px solid;padding-bottom:16px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #aaa;padding:12px 0}.amount{font:32px Georgia}.note{margin-top:48px;border-top:1px solid;padding-top:16px}@media print{button{display:none}}</style></head><body><button onclick="print()">Print or save PDF</button><h1>Invoice ${esc(invoice.number)}</h1><p>${esc(profile.freelancer_name)} → ${esc(profile.company_name)}</p><div class="row"><span>Issue date</span><b>${esc(invoice.issue_date)}</b></div><div class="row"><span>Due date</span><b>${esc(invoice.due_date)}</b></div><div class="row"><span>Purchase order</span><b>${esc(invoice.po_number||'Not required')}</b></div><p>${esc(invoice.description)}</p><p class="amount">${money(invoice.amount_cents,invoice.currency)}</p><div class="note"><p><b>Payment instructions</b><br>${esc(invoice.bank_details)}</p><p><b>Tax identifier</b><br>${esc(invoice.tax_id)}</p><p>Status: ${esc(packet.status_url)}</p></div></body></html>`); win.document.close();
}

async function statusPage(token:string) {
  app.innerHTML = `${header()}<main id="main"><div class="loading" role="status"><span></span><h1 tabindex="-1">Opening invoice status</h1></div></main>${footer()}`;
  try { const data = await api<any>(`/status/${encodeURIComponent(token)}`); app.innerHTML=`${header()}<main id="main" class="status-page"><p class="kicker">Secure invoice status</p><h1 tabindex="-1">Invoice ${esc(data.number)}</h1><p class="status-lede">${esc(data.sender)} sent this invoice to ${esc(data.company)}.</p><dl class="status-facts"><div><dt>Amount</dt><dd>${esc(data.amount)}</dd></div><div><dt>Due date</dt><dd>${esc(data.due_date)}</dd></div><div><dt>Current status</dt><dd>${esc(statusName(data.status))}</dd></div></dl><form id="status-form"><fieldset><legend>Update the sender</legend><label class="choice"><input type="radio" name="action" value="received" required> We received this invoice</label><label class="choice"><input type="radio" name="action" value="needs_changes"> We need a change</label><label class="choice"><input type="radio" name="action" value="approved"> We approved this invoice</label></fieldset><label>Optional note<textarea name="note" maxlength="500"></textarea></label><div id="form-error" class="form-error" role="alert"></div><button class="primary">Send status update</button></form><p class="small">This page records your selection. It is not the client's AP system.</p></main>${footer()}`; }
  catch(error){renderError('This status link did not open',(error as Error).message,()=>statusPage(token));}
}

function legal(kind:'privacy'|'terms') { const privacy = kind==='privacy'; app.innerHTML=`${header(kind)}<main id="main" class="legal"><p class="kicker">AP-Ready Invoice</p><h1 tabindex="-1">${privacy?'Privacy':'Terms'}</h1><p class="updated">Effective 2 September 2026</p>${privacy?`<h2>What we store</h2><p>We store client profiles, invoices, status events, and a browser workspace key. Bank and tax fields are encrypted before they enter SQLite.</p><h2>Demo data</h2><p>Demo workspaces are separate from real workspaces. A demo expires after 24 hours. Resetting creates a new demo.</p><h2>Who receives data</h2><p>We do not run advertising or tracking scripts. Sociobot receives a license token when you verify Pro. A finance recipient sees only the invoice status page you share.</p><h2>Your choices</h2><p>Export the receipt trail from the workspace. Contact <a href="mailto:privacy@sociobot.in">privacy@sociobot.in</a> to request account data removal.</p>`:`<h2>The service</h2><p>AP-Ready Invoice checks invoice fields and records a handoff trail. It does not provide bookkeeping, tax advice, payment processing, or an accounts-payable system.</p><h2>Pro plan</h2><p>Pro costs $19 per month through the Sociobot checkout. It includes saved client profiles, active invoices, and AP follow-through. You can cancel future renewals through the merchant receipt.</p><h2>Your responsibility</h2><p>You must verify invoice, tax, bank, client, and purchase-order details before sending them. Keep your workspace and status links private.</p><h2>Availability and refunds</h2><p>The service is provided as available. Sociobot is the merchant of record and handles billing support and refunds.</p>`}</main>${footer()}`; }

function pricing(){app.innerHTML=`${header('pricing')}<main id="main" class="legal"><p class="kicker">Pricing</p><h1 tabindex="-1">Keep invoice follow-through in one place</h1><section class="price full"><div><h2>Pro · $19 per month</h2><ul><li>Reusable client AP profiles</li><li>Invoice preflight checks</li><li>Status links and receipt trails</li><li>CSV audit exports</li></ul></div><a class="button primary" href="https://api.sociobot.in/api/v1/products/ap-ready-invoice/checkout">Buy Pro for $19 monthly</a></section><section><h2>Restore a license</h2><form id="license-form"><label>License token<input name="license" autocomplete="off" required></label><div id="form-error" class="form-error" role="alert"></div><button>Verify license</button></form></section></main>${footer()}`;}

function notFound(){app.innerHTML=`${header()}<main id="main" class="not-found"><p class="big-number">404</p><h1 tabindex="-1">This page is not in the packet</h1><p>The address may be old or incomplete.</p><a class="button primary" href="/" data-route>Return home</a></main>${footer()}`;}
function renderError(title:string,message:string,retry:()=>void){app.innerHTML=`${header()}<main id="main" class="error-page"><p class="big-number">!</p><h1 tabindex="-1">${esc(title)}</h1><p>${esc(message)}</p><button class="primary" id="retry">Try again</button></main>${footer()}`;document.querySelector('#retry')?.addEventListener('click',retry);}

async function route(push=false) {
  if(push) history.pushState({},'',location.href); const path=location.pathname; document.title=titles[path]||'Page not found — AP-Ready Invoice';
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href=`https://ap-ready-invoice.sociobot.in${path}`;
  if(path==='/')landing(); else if(path==='/demo')await productPage(true); else if(path==='/app')await productPage(false); else if(path==='/privacy'||path==='/terms')legal(path.slice(1) as 'privacy'|'terms'); else if(path==='/pricing')pricing(); else if(path.startsWith('/status/'))await statusPage(path.split('/').pop()!); else notFound();
  scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}); const h1=document.querySelector<HTMLElement>('h1');h1?.focus();document.querySelector('#route-announcer')!.textContent=h1?.textContent||document.title;
}

document.addEventListener('click', async event => {
  const skip=(event.target as HTMLElement).closest<HTMLAnchorElement>('.skip-link');if(skip){event.preventDefault();const main=document.querySelector<HTMLElement>('#main');main?.setAttribute('tabindex','-1');main?.focus();return;}
  const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-route]'); if(link){event.preventDefault();history.pushState({},'',link.href);route();return;}
  const button=(event.target as HTMLElement).closest<HTMLElement>('[data-action]'); if(!button)return; const action=button.dataset.action; const demo=location.pathname==='/demo';
  if(action==='reset-demo'){localStorage.removeItem(demoKey);notice='Demo reset with fresh sample data.';await productPage(true);}
  if(action==='new-invoice'||action==='edit-invoice'){renderWorkspace(dashboardData!,demo,true);document.querySelector<HTMLInputElement>('#invoice-form input[name="id"]')?.setAttribute('name','invoice_id');document.querySelector<HTMLInputElement>('#invoice-form input')?.focus();}
  if(action==='close-form')renderWorkspace(dashboardData!,demo);
  if(action==='edit-profile'){app.querySelector('.profile-summary')?.insertAdjacentHTML('beforebegin',profileEditor(dashboardData!.profile));app.querySelector<HTMLElement>('.profile-editor input')?.focus();}
  const invoice=dashboardData?.invoices[0]; if(!invoice)return;
  if(action==='open-packet')await printPacket(invoice,dashboardData!.profile);
  if(action==='mark-sent'){button.setAttribute('disabled','');try{await api(`/invoices/${invoice.id}/send`,{method:'POST',body:'{}'},localStorage.getItem(demo?demoKey:storageKey)!);notice='Packet marked as sent. Accounts payable has the next action.';await productPage(demo);}catch(e){notice=(e as Error).message;renderWorkspace(dashboardData!,demo);}}
  if(action==='copy-status'){await navigator.clipboard.writeText(`${location.origin}/status/${invoice.status_token}`);notice='Secure status link copied.';renderWorkspace(dashboardData!,demo);}
  if(action==='export-audit'){const token=localStorage.getItem(demo?demoKey:storageKey)!;const response=await fetch(`/api/invoices/${invoice.id}/audit.csv`,{headers:{'x-workspace-token':token}});const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${invoice.number}-receipt.csv`;a.click();URL.revokeObjectURL(url);}
});

document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target as HTMLFormElement;const error=form.querySelector<HTMLElement>('#form-error');if(error)error.textContent='';
  try {
    if(form.id==='profile-form'){const d=new FormData(form);const p={freelancer_name:d.get('freelancer_name'),company_name:d.get('company_name'),ap_email:d.get('ap_email'),billing_address:d.get('billing_address'),escalation_days:Number(d.get('escalation_days')),po_required:d.has('po_required'),tax_required:d.has('tax_required'),bank_required:d.has('bank_required')};await api('/profile',{method:'PUT',body:JSON.stringify(p)},localStorage.getItem(location.pathname==='/demo'?demoKey:storageKey)!);notice='Client AP rules saved.';await productPage(location.pathname==='/demo');}
    if(form.getAttribute('id')==='invoice-form'){const d=new FormData(form);const payload={number:d.get('number'),amount_cents:Math.round(Number(d.get('amount'))*100),currency:d.get('currency'),issue_date:d.get('issue_date'),due_date:d.get('due_date'),description:d.get('description'),po_number:d.get('po_number'),tax_id:d.get('tax_id'),bank_details:d.get('bank_details')};const id=d.get('invoice_id');await api(id?`/invoices/${id}`:'/invoices',{method:id?'PUT':'POST',body:JSON.stringify(payload)},localStorage.getItem(location.pathname==='/demo'?demoKey:storageKey)!);notice='Preflight finished. Review every marked item.';await productPage(location.pathname==='/demo');}
    if(form.id==='status-form'){const d=new FormData(form);await api(`/status/${location.pathname.split('/').pop()}/action`,{method:'POST',body:JSON.stringify({action:d.get('action'),note:d.get('note')})});notice='The sender can now see your update.';await statusPage(location.pathname.split('/').pop()!);}
    if(form.id==='license-form'){const token=String(new FormData(form).get('license')||'').trim();const response=await fetch(`https://api.sociobot.in/api/v1/products/ap-ready-invoice/verify?license=${encodeURIComponent(token)}`);const result=await response.json();if(!result.valid)throw new Error('That license is not active. Check the token and try again.');localStorage.setItem(licenseKey,token);localStorage.setItem(`${licenseKey}:verified`,String(Date.now()));notice='Pro license verified on this browser.';await productPage(false);}
  } catch(e){if(error)error.textContent=(e as Error).message;}
});

function captureLicense(){const params=new URLSearchParams(location.search);const token=params.get('license');if(token){localStorage.setItem(licenseKey,token);localStorage.removeItem(`${licenseKey}:verified`);history.replaceState({},'',location.pathname);}}
async function verifySavedLicense(){const token=localStorage.getItem(licenseKey);if(!token)return;const checked=Number(localStorage.getItem(`${licenseKey}:verified`)||0);if(Date.now()-checked<86400000)return;try{const response=await fetch(`https://api.sociobot.in/api/v1/products/ap-ready-invoice/verify?license=${encodeURIComponent(token)}`);const result=await response.json();if(result.valid){localStorage.setItem(`${licenseKey}:verified`,String(Date.now()));}else{localStorage.removeItem(`${licenseKey}:verified`);notice='Your Pro license is no longer active. Restore it from Pricing.';}}catch{ /* Keep the free workspace available when verification is offline. */ }}
captureLicense(); void verifySavedLicense(); window.addEventListener('popstate',()=>route()); route();
