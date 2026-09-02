import './style.css';
import './pro.css';

type Profile = { freelancer_name:string; company_name:string; ap_email:string; billing_address:string; po_required:boolean; tax_required:boolean; bank_required:boolean; escalation_days:number };
type Check = { key:string; label:string; ready:boolean; help:string };
type Invoice = { id:string; number:string; amount_cents:number; currency:string; issue_date:string; due_date:string; description:string; po_number:string; tax_id:string; bank_details:string; status:string; status_token:string; checks:Check[]; next_action:string; created_at:string };
type EventRow = { id:number; invoice_id:string; event_type:string; actor:string; detail:string; created_at:string };
type Dashboard = { profile:Profile; invoices:Invoice[]; events:EventRow[]; demo:boolean; expires_at:string|null };
type Packet = { invoice:Invoice; profile:Profile; email:{to:string;subject:string;body:string}; status_url:string };

const app = document.querySelector<HTMLDivElement>('#app')!;
const titles: Record<string,string> = {
  '/':'AP-Ready Invoice — Send invoices finance can accept', '/demo':'Demo — AP-Ready Invoice', '/app':'Workspace — AP-Ready Invoice',
  '/privacy':'Privacy — AP-Ready Invoice', '/terms':'Terms — AP-Ready Invoice', '/pricing':'Pricing — AP-Ready Invoice'
};
const storageKey = 'apri:workspace';
const demoKey = 'demo:apri:workspace';
let dashboardData: Dashboard | null = null;
let notice = '';
let selectedInvoiceId = '';
let creatingNew = false;

const esc = (v:unknown) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!));
const money = (cents:number, currency:string) => new Intl.NumberFormat('en', {style:'currency',currency}).format(cents / 100);
const statusName = (status:string) => ({draft:'Needs details',ready:'Ready to send',waiting_on_ap:'Waiting on AP',received:'Received by AP',needs_changes:'Changes requested',approved:'Approved'}[status] || status);

function header(active = '') {
  return `<header class="site-header"><a class="wordmark" href="/" data-route aria-label="AP-Ready Invoice home"><span>AP</span> Ready Invoice</a>
  <nav aria-label="Main navigation"><a href="/demo" data-route ${active==='demo'?'aria-current="page"':''}>Demo</a><a href="/app" data-route ${active==='app'?'aria-current="page"':''}>Workspace</a><a href="/privacy" data-route ${active==='privacy'?'aria-current="page"':''}>Privacy</a></nav></header>`;
}
function footer() { return `<footer><p>Invoice handoff for independent professionals.</p><nav aria-label="Footer"><a href="/privacy" data-route>Privacy</a><a href="/terms" data-route>Terms</a><a href="https://hello-factory.sociobot.in">Built by Param Factory <span class="sr-only">(external site)</span></a></nav><p class="folio">Version 1.0 · Original generated artwork</p></footer>`; }

function demoBanner() { return `<aside class="demo-banner" aria-label="Demo mode"><strong>Demo — sample data, nothing is saved.</strong><span>This separate demo expires in 24 hours.</span><button type="button" data-action="reset-demo">Reset demo</button><a href="/app" data-route>Start for real</a></aside>`; }

function landing() {
  app.innerHTML = `${header()}<main id="main"><section class="hero"><div class="hero-copy"><p class="kicker">Invoice handoff for corporate finance</p><h1 tabindex="-1">Send invoices corporate AP can accept</h1><p class="dek">For freelancers who need finance teams to approve invoices without another correction round.</p><div class="hero-action"><a class="button primary" href="/demo" data-route>Try it with sample data</a><span>See a checked invoice and its next action.</span></div><ul class="plain-facts"><li>Sample data expires after 24 hours.</li><li>Bank and tax fields are encrypted.</li><li>Receipt trails export as CSV.</li></ul></div><figure class="hero-art"><picture><source type="image/webp" srcset="/invoice-broadsheet-720.webp 720w, /invoice-broadsheet-1200.webp 1200w" sizes="(max-width: 700px) 100vw, 48vw"><img src="/invoice-broadsheet-1200.webp" width="1200" height="800" fetchpriority="high" alt="An invoice, purchase order slip, envelope, and red pencil arranged on newsprint."></picture><figcaption>Check the packet before finance does.</figcaption></figure></section>
  <section class="preview" aria-labelledby="preview-title"><div class="section-label">Live preview · MVS-1042</div><div><h2 id="preview-title">Know who acts next</h2><p class="measure">Every requirement becomes a visible check. Every handoff adds a dated receipt.</p><div class="preview-checks"><p><span>01</span> AP email and address <b>Ready</b></p><p><span>02</span> Purchase order <b>Ready</b></p><p><span>03</span> Bank instructions <b>Ready</b></p></div></div><aside class="margin-note"><span>Next action</span><strong>You send the invoice packet</strong></aside></section>
  <section class="how" aria-labelledby="how-title"><div class="section-label">How it works</div><div><h2 id="how-title">Pass the first AP review</h2><ol><li><span>1</span><div><h3>Save the client rules</h3><p>Record the finance email, PO rule, billing address, and tax needs once.</p></div></li><li><span>2</span><div><h3>Check the invoice</h3><p>Fix each missing field before you send the packet.</p></div></li><li><span>3</span><div><h3>Track the handoff</h3><p>Share a status link and keep a dated receipt trail.</p></div></li></ol></div></section>
  <section class="boundaries" aria-labelledby="boundaries-title"><div class="section-label">Scope and privacy</div><div><h2 id="boundaries-title">A handoff tool, not bookkeeping</h2><p>It does not take card payments or replace your ledger. It never claims to be your client's AP system.</p><p>Sensitive invoice fields are encrypted on the server. You can export the receipt trail as CSV.</p></div></section></main>${footer()}`;
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
  const invoice = data.invoices.find(item=>item.id===selectedInvoiceId) || data.invoices[0]; if(invoice)selectedInvoiceId=invoice.id; const invoiceEvents=data.events.filter(event=>event.invoice_id===invoice?.id); const ready = invoice?.checks.filter(c=>c.ready).length || 0; const total = invoice?.checks.length || 0;
  data={...data,events:invoiceEvents};
  queueMicrotask(addEmailAction);
  queueMicrotask(()=>addInvoiceNavigation(data,invoice));
  app.innerHTML = `${header(demo?'demo':'app')}${demo?demoBanner():''}<main id="main" class="workspace"><section class="workspace-head"><div><p class="kicker">${demo?'Sample workspace':'Your workspace'}</p><h1 tabindex="-1">${invoice?`Invoice ${esc(invoice.number)}`:'Prepare your first AP packet'}</h1><p>${invoice?`${esc(data.profile.company_name)} · ${money(invoice.amount_cents,invoice.currency)}`:'Save the client rules, then add an invoice.'}</p></div><button class="primary" data-action="${invoice?'edit-invoice':'new-invoice'}">${invoice?'Edit invoice':'Add invoice'}</button></section>${notice?`<div class="notice" role="status">${esc(notice)}</div>`:''}
  ${!data.profile.ap_email?profileEditor(data.profile):''}
  ${formOpen?invoiceForm(creatingNew?undefined:invoice):''}
  ${invoice?`<div class="workspace-grid"><section class="preflight" aria-labelledby="preflight-title"><div class="section-heading"><div><p class="kicker">Preflight · ${ready}/${total} ready</p><h2 id="preflight-title">AP requirements</h2></div><span class="stamp ${ready===total?'pass':'fix'}">${ready===total?'Ready':'Fix items'}</span></div><ol>${invoice.checks.map((c,i)=>`<li class="${c.ready?'checked':'missing'}"><span class="check-number">${String(i+1).padStart(2,'0')}</span><div><strong>${esc(c.label)}</strong>${!c.ready?`<small>${esc(c.help)}</small>`:''}</div><b>${c.ready?'Ready':'Fix'}</b></li>`).join('')}</ol></section>
  <aside class="action-column"><div class="next-action"><span>Next action</span><strong>${esc(invoice.next_action)}</strong></div><dl><div><dt>Status</dt><dd>${esc(statusName(invoice.status))}</dd></div><div><dt>Due</dt><dd>${esc(invoice.due_date)}</dd></div><div><dt>Client</dt><dd>${esc(data.profile.company_name)}</dd></div></dl><button data-action="open-packet" ${ready<total?'disabled':''}>Open invoice packet</button><button class="primary" data-action="mark-sent" ${invoice.status!=='ready'?'disabled':''}>Mark packet sent</button><button data-action="copy-status">Copy status link</button><button data-action="export-audit">Export receipt CSV</button></aside></div>
  <section class="receipt" aria-labelledby="receipt-title"><div class="section-heading"><div><p class="kicker">Delivery record</p><h2 id="receipt-title">Receipt trail</h2></div></div>${data.events.length?`<ol>${data.events.map(e=>`<li><time>${esc(e.created_at.replace('T',' '))}</time><strong>${esc(e.actor)}</strong><span>${esc(e.detail)}</span></li>`).join('')}</ol>`:'<div class="empty"><p>No handoff events yet.</p><p>Run preflight to add the first receipt.</p></div>'}</section>`:`<section class="empty-state"><span class="big-number">00</span><h2>No invoices yet</h2><p>Your preflight checks and receipt trail will appear here.</p><button class="primary" data-action="new-invoice">Add your first invoice</button></section>`}
  <section class="profile-summary"><div><p class="kicker">Client AP profile</p><h2>${esc(data.profile.company_name||'No client saved')}</h2></div><p>${data.profile.ap_email?`${esc(data.profile.ap_email)} · Follow up after ${data.profile.escalation_days} days.`:'Add the finance team and its invoice rules.'}</p><button data-action="edit-profile">Edit client rules</button></section></main>${footer()}`;
}

function addEmailAction() {
  const exportButton=document.querySelector<HTMLElement>('[data-action="export-audit"]');
  if(exportButton&&!document.querySelector('[data-action="copy-email"]'))exportButton.insertAdjacentHTML('beforebegin','<button data-action="copy-email">Copy email cover note</button>');
}

function addInvoiceNavigation(data:Dashboard,invoice?:Invoice) {
  const edit=document.querySelector<HTMLElement>('[data-action="edit-invoice"]');
  if(edit&&!document.querySelector('[data-action="new-invoice"]'))edit.insertAdjacentHTML('beforebegin','<button data-action="new-invoice">Add invoice</button>');
  if(data.invoices.length<2)return;
  const profile=document.querySelector('.profile-summary');
  profile?.insertAdjacentHTML('beforebegin',`<section class="invoice-index"><p class="kicker">All invoices</p><h2>Invoice index</h2><div>${data.invoices.map(item=>`<button data-action="select-invoice" data-id="${esc(item.id)}" ${item.id===invoice?.id?'aria-current="true"':''}><span>${esc(item.number)}</span><small>${esc(statusName(item.status))}</small></button>`).join('')}</div></section>`);
}

function profileEditor(p:Profile) { return `<section class="profile-editor" aria-labelledby="profile-title"><h2 id="profile-title">Save the client AP rules</h2><form id="profile-form"><div class="form-grid"><label>Your business name<input name="freelancer_name" required value="${esc(p.freelancer_name)}"></label><label>Client company<input name="company_name" required value="${esc(p.company_name)}"></label><label>Finance email<input name="ap_email" type="email" required value="${esc(p.ap_email)}"></label><label>Billing address<textarea name="billing_address" required>${esc(p.billing_address)}</textarea></label><label>Follow up after days<input name="escalation_days" type="number" min="1" max="30" required value="${p.escalation_days||5}"></label></div><fieldset><legend>Required on each invoice</legend><label class="check"><input type="checkbox" name="po_required" ${p.po_required?'checked':''}> Purchase order</label><label class="check"><input type="checkbox" name="tax_required" ${p.tax_required?'checked':''}> Tax identifier</label><label class="check"><input type="checkbox" name="bank_required" ${p.bank_required?'checked':''}> Payment instructions</label></fieldset><div id="form-error" class="form-error" role="alert"></div><button class="primary" type="submit">Save client rules</button></form></section>`; }

function printPacket(invoice:Invoice, demo:boolean) {
  const win = window.open(`/packet/${encodeURIComponent(invoice.id)}?workspace=${demo?'demo':'real'}`, '_blank');
  if (!win) {
    notice='Your browser blocked the print window. Allow pop-ups and try again.';
    renderWorkspace(dashboardData!,demo);
  }
}

async function packetPage(invoiceId:string) {
  app.innerHTML = `<main id="main" class="packet-page"><div class="loading" role="status"><span></span><h1 tabindex="-1">Preparing the invoice packet</h1></div></main>`;
  try {
    const demo = new URLSearchParams(location.search).get('workspace') === 'demo';
    const token = localStorage.getItem(demo?demoKey:storageKey);
    if (!token) throw new Error('Open this packet from your workspace so its invoice details stay private.');
    const packet = await api<Packet>(`/invoices/${encodeURIComponent(invoiceId)}/packet`,{},token);
    const invoice = packet.invoice;
    document.title = `Invoice ${invoice.number} — AP-Ready Invoice`;
    app.innerHTML = `<main id="main" class="packet-page"><div class="packet-toolbar"><button class="primary" data-action="print-packet">Print or save PDF</button><button data-action="close-packet">Close packet</button></div><article class="packet-sheet" aria-labelledby="packet-title"><p class="packet-label">Invoice packet</p><h1 id="packet-title" tabindex="-1">Invoice ${esc(invoice.number)}</h1><p class="packet-parties">${esc(packet.profile.freelancer_name)} <span aria-hidden="true">→</span> ${esc(packet.profile.company_name)}</p><dl class="packet-facts"><div><dt>Issue date</dt><dd>${esc(invoice.issue_date)}</dd></div><div><dt>Due date</dt><dd>${esc(invoice.due_date)}</dd></div><div><dt>Purchase order</dt><dd>${esc(invoice.po_number||'Not required')}</dd></div></dl><p class="packet-description">${esc(invoice.description)}</p><p class="packet-amount">${money(invoice.amount_cents,invoice.currency)}</p><section class="packet-payment" aria-labelledby="payment-title"><h2 id="payment-title">Payment details</h2><p><strong>Payment instructions</strong><br>${esc(invoice.bank_details)}</p><p><strong>Tax identifier</strong><br>${esc(invoice.tax_id)}</p><p><strong>Status link</strong><br><a href="${esc(packet.status_url)}">${esc(packet.status_url)}</a></p></section></article></main>`;
  } catch(error) {
    renderError('This invoice packet did not open',(error as Error).message,()=>packetPage(invoiceId));
  }
}

async function statusPage(token:string) {
  app.innerHTML = `${header()}<main id="main"><div class="loading" role="status"><span></span><h1 tabindex="-1">Opening invoice status</h1></div></main>${footer()}`;
  try { const data = await api<any>(`/status/${encodeURIComponent(token)}`); app.innerHTML=`${header()}<main id="main" class="status-page"><p class="kicker">Secure invoice status</p><h1 tabindex="-1">Invoice ${esc(data.number)}</h1><p class="status-lede">${esc(data.sender)} sent this invoice to ${esc(data.company)}.</p><dl class="status-facts"><div><dt>Amount</dt><dd>${esc(data.amount)}</dd></div><div><dt>Due date</dt><dd>${esc(data.due_date)}</dd></div><div><dt>Current status</dt><dd>${esc(statusName(data.status))}</dd></div></dl><form id="status-form"><fieldset><legend>Update the sender</legend><label class="choice"><input type="radio" name="action" value="received" required> We received this invoice</label><label class="choice"><input type="radio" name="action" value="needs_changes"> We need a change</label><label class="choice"><input type="radio" name="action" value="approved"> We approved this invoice</label></fieldset><label>Optional note<textarea name="note" maxlength="500"></textarea></label><div id="form-error" class="form-error" role="alert"></div><button class="primary">Send status update</button></form><p class="small">This page records your selection. It is not the client's AP system.</p></main>${footer()}`; }
  catch(error){renderError('This status link did not open',(error as Error).message,()=>statusPage(token));}
}

function legal(kind:'privacy'|'terms') { const privacy = kind==='privacy'; app.innerHTML=`${header(kind)}<main id="main" class="legal"><p class="kicker">AP-Ready Invoice</p><h1 tabindex="-1">${privacy?'Privacy':'Terms'}</h1><p class="updated">Effective 2 September 2026</p>${privacy?`<h2>What we store</h2><p>We store client profiles, invoices, status events, and a browser workspace key. Bank and tax fields are encrypted before they enter SQLite.</p><h2>Demo data</h2><p>Demo workspaces are separate from real workspaces. A demo expires after 24 hours. Resetting creates a new demo.</p><h2>Who receives data</h2><p>We do not run advertising or tracking scripts. A finance recipient sees only the invoice status page you share.</p><h2>Your choices</h2><p>Export the receipt trail from the workspace. Contact <a href="mailto:privacy@sociobot.in">privacy@sociobot.in</a> to request account data removal.</p>`:`<h2>The service</h2><p>AP-Ready Invoice checks invoice fields and records a handoff trail. It does not provide bookkeeping, tax advice, payment processing, or an accounts-payable system.</p><h2>Your responsibility</h2><p>You must verify invoice, tax, bank, client, and purchase-order details before sending them. Keep your workspace and status links private.</p><h2>Availability</h2><p>The service is provided as available. Export your receipt trail when you need a separate record.</p>`}</main>${footer()}`; }

function pricing(){app.innerHTML=`${header()}<main id="main" class="legal"><p class="kicker">Purchase status</p><h1 tabindex="-1">Purchases are not available yet</h1><p>The external checkout is still being registered. There is no purchase action on this site until it is ready.</p><p>You can use the workspace, status links, printable packets, and CSV exports now.</p><a class="button primary" href="/app" data-route>Open your workspace</a></main>${footer()}`;}

function notFound(){app.innerHTML=`${header()}<main id="main" class="not-found"><p class="big-number">404</p><h1 tabindex="-1">This page is not in the packet</h1><p>The address may be old or incomplete.</p><a class="button primary" href="/" data-route>Return home</a></main>${footer()}`;}
function renderError(title:string,message:string,retry:()=>void){app.innerHTML=`${header()}<main id="main" class="error-page"><p class="big-number">!</p><h1 tabindex="-1">${esc(title)}</h1><p>${esc(message)}</p><button class="primary" id="retry">Try again</button></main>${footer()}`;document.querySelector('#retry')?.addEventListener('click',retry);}

async function route(push=false) {
  if(push) history.pushState({},'',location.href); const path=location.pathname; document.title=titles[path]||'Page not found — AP-Ready Invoice';
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href=`https://ap-ready-invoice.sociobot.in${path}`;
  if(path==='/')landing(); else if(path==='/demo')await productPage(true); else if(path==='/app')await productPage(false); else if(path==='/privacy'||path==='/terms')legal(path.slice(1) as 'privacy'|'terms'); else if(path==='/pricing')pricing(); else if(path.startsWith('/status/'))await statusPage(path.split('/').pop()!); else if(path.startsWith('/packet/'))await packetPage(path.split('/').pop()!); else notFound();
  scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}); const h1=document.querySelector<HTMLElement>('h1');h1?.focus();document.querySelector('#route-announcer')!.textContent=h1?.textContent||document.title;
}

document.addEventListener('click', async event => {
  const skip=(event.target as HTMLElement).closest<HTMLAnchorElement>('.skip-link');if(skip){event.preventDefault();const main=document.querySelector<HTMLElement>('#main');main?.setAttribute('tabindex','-1');main?.focus();return;}
  const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-route]'); if(link){event.preventDefault();history.pushState({},'',link.href);route();return;}
  const button=(event.target as HTMLElement).closest<HTMLElement>('[data-action]'); if(!button)return; const action=button.dataset.action; const demo=location.pathname==='/demo';
  if(action==='print-packet'){window.print();return;}
  if(action==='close-packet'){window.close();return;}
  if(action==='reset-demo'){localStorage.removeItem(demoKey);notice='Demo reset with fresh sample data.';await productPage(true);}
  if(action==='new-invoice'||action==='edit-invoice'){creatingNew=action==='new-invoice';renderWorkspace(dashboardData!,demo,true);document.querySelector<HTMLInputElement>('#invoice-form input[name="id"]')?.setAttribute('name','invoice_id');document.querySelector<HTMLInputElement>('#invoice-form input')?.focus();}
  if(action==='select-invoice'){selectedInvoiceId=button.dataset.id||'';creatingNew=false;renderWorkspace(dashboardData!,demo);}
  if(action==='close-form')renderWorkspace(dashboardData!,demo);
  if(action==='edit-profile'){app.querySelector('.profile-summary')?.insertAdjacentHTML('beforebegin',profileEditor(dashboardData!.profile));app.querySelector<HTMLElement>('.profile-editor input')?.focus();}
  const invoice=dashboardData?.invoices[0]; if(!invoice)return;
  if(action==='open-packet')printPacket(invoice,demo);
  if(action==='mark-sent'){button.setAttribute('disabled','');try{await api(`/invoices/${invoice.id}/send`,{method:'POST',body:'{}'},localStorage.getItem(demo?demoKey:storageKey)!);notice='Packet marked as sent. Accounts payable has the next action.';await productPage(demo);}catch(e){notice=(e as Error).message;renderWorkspace(dashboardData!,demo);}}
  if(action==='copy-status'){await navigator.clipboard.writeText(`${location.origin}/status/${invoice.status_token}`);notice='Secure status link copied.';renderWorkspace(dashboardData!,demo);}
  if(action==='copy-email'){const token=localStorage.getItem(demo?demoKey:storageKey)!;const packet=await api<any>(`/invoices/${invoice.id}/packet`,{},token);await navigator.clipboard.writeText(`To: ${packet.email.to}\nSubject: ${packet.email.subject}\n\n${packet.email.body}`);notice='Email cover note copied.';renderWorkspace(dashboardData!,demo);}
  if(action==='export-audit'){const token=localStorage.getItem(demo?demoKey:storageKey)!;const response=await fetch(`/api/invoices/${invoice.id}/audit.csv`,{headers:{'x-workspace-token':token}});const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${invoice.number}-receipt.csv`;a.click();URL.revokeObjectURL(url);}
});

document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target as HTMLFormElement;const error=form.querySelector<HTMLElement>('#form-error');if(error)error.textContent='';
  try {
    if(form.id==='profile-form'){const d=new FormData(form);const p={freelancer_name:d.get('freelancer_name'),company_name:d.get('company_name'),ap_email:d.get('ap_email'),billing_address:d.get('billing_address'),escalation_days:Number(d.get('escalation_days')),po_required:d.has('po_required'),tax_required:d.has('tax_required'),bank_required:d.has('bank_required')};await api('/profile',{method:'PUT',body:JSON.stringify(p)},localStorage.getItem(location.pathname==='/demo'?demoKey:storageKey)!);notice='Client AP rules saved.';await productPage(location.pathname==='/demo');}
    if(form.getAttribute('id')==='invoice-form'){const d=new FormData(form);const payload={number:d.get('number'),amount_cents:Math.round(Number(d.get('amount'))*100),currency:d.get('currency'),issue_date:d.get('issue_date'),due_date:d.get('due_date'),description:d.get('description'),po_number:d.get('po_number'),tax_id:d.get('tax_id'),bank_details:d.get('bank_details')};const id=d.get('invoice_id');await api(id?`/invoices/${id}`:'/invoices',{method:id?'PUT':'POST',body:JSON.stringify(payload)},localStorage.getItem(location.pathname==='/demo'?demoKey:storageKey)!);notice='Preflight finished. Review every marked item.';await productPage(location.pathname==='/demo');}
    if(form.id==='status-form'){const d=new FormData(form);await api(`/status/${location.pathname.split('/').pop()}/action`,{method:'POST',body:JSON.stringify({action:d.get('action'),note:d.get('note')})});notice='The sender can now see your update.';await statusPage(location.pathname.split('/').pop()!);}
  } catch(e){if(error)error.textContent=(e as Error).message;}
});

window.addEventListener('popstate',()=>route()); route();
