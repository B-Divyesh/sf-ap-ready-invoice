# AP-Ready Invoice venture plan

**Plan status:** 2026-09-05 audit. M1 is **not accepted**. This is a planning
document, not a release approval. It is based on the researched brief, the
current `main` implementation at `c97ff30`, both independent verification
reports, the current local test run, and a fresh production demo probe.

## 1. Product contract

### Customer, situation, and promise

AP-Ready Invoice is for freelancers and small studios whose corporate clients
route invoices through accounts payable (AP). Today they export a PDF, carry
PO, tax, bank, and billing rules in notes, send an email manually, and chase a
thread for a receipt. The product promise is: **prepare the AP requirements,
send one invoice packet, and make the next action and receipt trail visible.**

The three jobs are deliberately narrow:

1. Save a client's AP requirements and preflight an invoice before handoff.
2. Produce a correct printable/email-ready invoice packet for that invoice.
3. Let the recipient update a scoped status link and give the sender an
   exportable, dated escalation trail.

The $19/month subscription is the researched commercial model. It is **not
available or implemented now**. Merchant processing, bookkeeping, tax advice,
general CRM, payment collection, HMRC access, AP-system impersonation, and
automatic email delivery are out of scope. No AI feature is planned: the core
job is deterministic validation and receipt tracking, and no model would make
that safer or clearer.

### Evidence and wedge

- A freelancer reported that FreshBooks was overkill when clients simply need a
  PDF sent to AP: <https://hn.algolia.com/api/v1/items/42607269> (2025-01-06).
- Invoice Ninja users asked for company/group/client selection, showing the
  limits of a one-client invoice model:
  <https://github.com/invoiceninja/invoiceninja/issues/12093> (2026-07-16).

The wedge is the handoff after invoice creation: reusable AP rules, an
invoice-specific preflight, packet, status link, and evidence trail. It must
not turn into another ledger.

The pilot success measure remains unmeasured: 85% first AP-review pass rate
and a 30% reduction in time to first status. No public copy may state either
result until a consented pilot establishes the baseline and outcome.

## 2. Current reality and public promises

### Milestone assessment

There is no accepted venture milestone. The current product is an **M1
candidate with a working single-invoice demo path**, not a released M1. The
current deployment presents a polished lander, demo, preflight, packet, public
status page, CSV export, and local SQLite storage. It does not satisfy the
core workflow once a workspace has multiple invoices, and it does not provide
the brief's reusable client profiles.

| Area | Status | Evidence and limit |
|---|---|---|
| Landing, original visual system, demo entry point | Demonstrated | The broadsheet design, one-click `/demo`, metadata, privacy/terms, and 390px checks exist. The local 21-browser-test gate passes. This is not an M1 acceptance on its own. |
| Single-invoice preflight → packet → send → recipient receipt → CSV | Demonstrated only | A fresh 2026-09-05 live demo returned 7/7 ready, packet data, a 200 send, and a 200 status page. It proves one sample flow, not production tenant isolation or all invoices. |
| Correct action on the selected invoice | Failed / release blocker | In the live probe, after selecting `MVS-1042`, **Open invoice packet** opened the newly created `PLAN-LIVE-SECOND` invoice. The frontend dispatches actions using `dashboardData.invoices[0]`. |
| Preflight prevents invalid handoff | Failed / release blocker | New valid invoices are inserted as `draft`; changing the mutable profile can leave failed checks with `ready` status, and send does not recompute checks. Independent verification reproduced both. |
| Reusable client AP profiles and historical packet accuracy | Failed / release blocker | `profiles.workspace_id` is the primary key: there is one mutable profile per workspace and no invoice profile snapshot. Editing it rewrites a previous packet. README's “Reusable client AP profiles” is currently an unlisted, false claim. |
| Demo isolation and 24-hour expiry | Partially implemented, claim failed | The demo has a separate random key and `is_demo`/expiry columns, but expired workspaces cannot reset in the UI and the public status link remains reachable. The current test only asserts a future expiry timestamp. |
| Bank/tax storage encryption | Locally demonstrated | ChaCha20-Poly1305 with a generated persisted key is implemented and `@claim:encrypted-fields` passes locally. This is not a security audit and does not establish account or tenant isolation. |
| No analytics/tracking | Locally demonstrated | `@claim:no-tracking` passes from a clean local demo context; the frontend has no CDN script/font. This does not make a broader “no data leaves your device” promise, which would be false for this backend product. |
| Accessibility and quality baseline | Partial | Current local tests pass, including serious/critical Axe checks. Independent verification found keyboard focus lost when opening the invoice form and one moderate landmark violation. Those repairs remain in M1. |
| Security headers and rate limit | Partial / live verification failed | CSP, nosniff, referrer policy, permissions policy, frame denial, and cache policies were observed live. HSTS is absent. The source limiter is 40 API requests per forwarded IP/second, and the local rate test passes; a fresh 120-request live `/api/demo` probe returned 120 HTTP 200 responses and no `Retry-After`, so live enforcement is not accepted. |
| Billing, subscription, paid gate | Not implemented | `/pricing` honestly says purchases are unavailable. There is no $19 checkout, entitlement, license restore, or paid boundary. The previous checkout registration returned 404; that is an external dependency, not a shipped feature. |
| Sign-in and tenant isolation | Not implemented | Browser-held opaque workspace tokens are not identities. No sign-in, tenant model, cross-tenant proof, account export/delete, or production access-control verification exists. A demo does not prove these properties. |
| Messaging, HMRC | Not implemented and not planned | The app copies a prepared email; it does not send email or messages. There is no HMRC integration. Neither may be described as available. |

The existing claims manifest has eight locally passing tagged tests, but passing
commands do not override the independent outcome failures. In particular,
`demo-isolated`, `preflight`, and `invoice-packet` are inadequate assertions
for the public claims they carry. `audit-export` also needs a selected-invoice
case. The public README must be narrowed or repaired with a tested
`profile-snapshot` claim before it promises reusable profiles.

### Evidence ledger

- `.factory/brief.json` — researched customer, smallest useful product, price,
  constraints, and success measure.
- `.factory/design.md`, `.factory/demo.md`, `.factory/copy-audit.md` — design,
  demo, and copy intent.
- `.factory/verification.md` — first independent review and the repaired
  packet/date/cache/mobile issues it found.
- `.factory/verification-2.md` — current independent **FAIL**, four S1 core
  defects, S2/S3 repair work, and prior live/local QA.
- `.factory/handoff.md` — repair, deployment, and SQLite cutover history.
- `tests/product.spec.ts` and `.factory/claims.json` — present local automated
  coverage; several assertions are narrower than the live contract.
- 2026-09-05 planner checks: `npm ci && npm test` passed (7 Rust + 21 Chromium
  tests); a fresh live demo reproduced the wrong-invoice packet and the status
  title “Page not found — AP-Ready Invoice”; the 120-request live rate probe
  had no 429/`Retry-After` response.

## 3. Architecture and data boundaries

### Current implementation, accurately described

- A Rust 2021 Axum service serves the Vite/TypeScript frontend and JSON API on
  `PORT` (default 8080). The root `Dockerfile` builds the frontend and Rust
  binary, runs non-root, and `/health` emits a build SHA.
- SQLx uses one SQLite database at `/data/ap-ready-invoice.sqlite3` when the
  fleet mount exists, otherwise `./data`. A randomly generated encryption key
  is persisted beside it. The current deployment history records the
  Azure-Files single-writer/rolling-cutover constraint; do not replace that
  operational evidence with a health-only check.
- Current tables are `workspaces`, one `profiles` row per workspace,
  `invoices`, and `events`. `tax_id_enc` and `bank_details_enc` use
  ChaCha20-Poly1305; status tokens and workspace tokens are stored as lookup
  values.
- Real and demo browser state use different localStorage keys:
  `apri:workspace` and `demo:apri:workspace`. Demo rows carry `is_demo=1` and
  `expires_at`. They share the same database and schema.
- A workspace bearer token scopes authenticated API reads/writes. It is not an
  account, is not a sign-in session, and does not prove tenant isolation.
  Public status tokens are capability links, not recipient-authenticated
  sessions.
- The service has JSON logs, health, strict self-only CSP, cache policy, and a
  source-level in-memory limiter. It has no metrics endpoint, backup/restore
  evidence, account deletion, background worker, email sender, billing client,
  or external AI use.

### Target boundaries

M1 stays demo-first and makes the core model truthful. It must move from one
mutable profile to `client_profiles` (many per workspace in the demo), assign a
profile to an invoice, and persist the profile fields/requirements used for
that invoice as an immutable snapshot. Updates create an auditable new profile
version or affect future invoices only; they never rewrite a sent packet.

M2 introduces real accounts and tenancy. The durable model becomes:

| Entity | Owner and boundary |
|---|---|
| `tenants`, `users`, `memberships` | Authenticated Sociobot Entra subject belongs to a tenant; every app query derives tenant scope server-side. |
| `client_profiles`, `profile_versions` | Tenant-owned. Profile version is selected at invoice creation. |
| `invoices`, encrypted sensitive fields, `invoice_profile_snapshot` | Tenant-owned. Invoice/packet data stays immutable after send except clearly recorded recipient state. |
| `events`, audit export, deletion/export requests | Tenant-owned; event actor and time are append-only. Exports are never paid-gated. |
| `status_links` | Invoice-scoped, hashed token at rest, expiry/revocation/last-used metadata; public route returns only the intended recipient view. |
| `billing_entitlements` | Tenant-owned, server verified from the Sociobot billing contract; no payment credentials or provider SDK in the browser. |

Use SQLite under `/data` with migrations that have an explicit backup/recovery
procedure and integration tests from an empty database. SQLite is appropriate
for the assigned single-replica product only; do not silently use shared
PostgreSQL. Preserve encrypted fields and generated keys on the product mount.
Do not log tokens, invoice/bank/tax content, or secrets. The demo remains an
ephemeral tenant/namespace and must never read a real tenant.

## 4. Milestones

### M1 — Repair and accept the AP handoff core

**Status:** next milestone; currently incomplete and blocked only by product
repair/verification, not external billing or sign-in access.

**Scope and screens:** `/`, `/demo`, `/app`, `/packet/:invoiceId`,
`/status/:token`, client profile editor/index, and the existing 404/legal
screens. Keep the current broadsheet design system while fixing interaction
and semantic defects.

**Build outcome:** a demo user can keep two client profiles and two invoices,
select an invoice, run its actual profile snapshot preflight, create the
correct packet/email/export/status link, and use an expired demo recovery
without exposing expired sample status data.

**Required repairs:**

1. Dispatch every action from the selected invoice ID, never index zero. Test
   packet, send, email copy, status copy, and CSV with at least two invoices.
2. Calculate `ready` atomically on create and update. On send, load the
   invoice snapshot and recompute/require every check in the transaction; no
   stale status can bypass a requirement.
3. Implement multiple reusable profiles and immutable invoice snapshots.
   Profile changes apply only when a user explicitly selects a new version for
   a future/draft invoice; historical packet, recipient address, and rules do
   not change.
4. Make demo expiry complete: a past-expiry workspace can always obtain a fresh
   sample with the persistent banner/reset control intact; expired workspace
   tokens and expired public status tokens return a non-disclosing expiry/404
   result and are cleaned up. Test this with an injected clock or test-only
   expiry fixture, never by relying only on “24 hours from now.”
5. Move focus to the first visible invoice field after opening the form;
   validate a usable email address at the API edge; count user-visible Unicode
   characters consistently; remove the moderate landmark misuse; set a
   status-page title and `noindex` policy that do not disclose a token through
   canonical metadata.
6. Resolve the live limiter discrepancy and HSTS before acceptance. Verify
   429 plus `Retry-After` through the public origin from a single forwarded
   client; do not accept source/local behavior as a substitute.

**M1 claims and tests:** replace/narrow false current claims rather than
grandfathering them. Each entry remains one `@claim:<id>` test from `/demo`.

| Claim ID | Observable test required |
|---|---|
| `demo-isolated` | Two clean contexts receive distinct demo workspaces; reset replaces only demo state; a fixture-expired workspace auto-recovers and its old status link is not accessible. |
| `profile-snapshot` | Create invoices under two saved profiles; edit one profile; assert prior packet/email/status recipient data and checks remain unchanged. |
| `preflight` | Valid creation is `ready`; each missing required field makes the correct selected invoice draft; send returns 400 until the snapshot checks pass, including after profile/version selection. |
| `invoice-packet` | With two invoices selected in both orders, packet, email copy, status link, and print view all contain that selected invoice. |
| `audit-export` | Selected invoice CSV contains only its own chronological events and correct escaped CSV cells. |
| `status-receipt` | A valid live demo status response appends the correct invoice event; an expired/revoked token cannot read or write. |
| `encrypted-fields` | Inspect the isolated test SQLite row, not merely a convenience endpoint, and prove plaintext bank/tax test values are absent while round-trip data is correct. |
| `no-tracking` | Capture the full demo/packet/status flow in a clean context and allow only the product origin. |

**M1 definition of done:** all listed claim tests and `npm ci && npm test` pass;
new migration/API unit tests cover the transaction and expiry edges; a release
binary starts with only `PORT`; `verify-url.sh`, serious/critical Axe, a
keyboard-only form flow, and 390px checks pass. An independent verifier must
run the two-invoice and actual-expiry flows locally and against the live
candidate, verify live 429/`Retry-After` and HSTS, and find no console errors.
Update `claims.json`, demo/copy/README, plan status, and
`.factory/handoff-m1.md`. M1 is not complete until that independent result is
PASS.

### M2 — Accounts, durable tenant boundaries, and $19 subscription

**Status:** planned only. Do not start public billing copy or a paid gate until
the external registration dependency below is available and verified.

**Scope and screens:** sign-in/onboarding, tenant/profile workspace,
account-data export/delete settings, `/pricing`, checkout return/restore, and
an entitlement-aware app shell. `/demo` remains no-account and isolated.

**Build outcome:** an authenticated owner can create/reopen only their tenant's
data after deployment, restore a subscription entitlement, and export or ask
to delete their tenant's data. A second tenant cannot enumerate, read, write,
download, or obtain a status link for the first tenant.

**Required work:**

1. Integrate approved Sociobot Entra CIAM using server-side token validation
   (issuer, audience, signature/JWKS, expiry) and server-derived tenant scope.
   Do not treat localStorage workspace tokens as real authentication.
2. Add tenant columns and query guards to every invoice/profile/event/export/
   status-management route. Add two-account integration tests for every route,
   including direct IDs, CSV, packet, and mutation attempts.
3. Persist state and cryptographic material under `/data`, test restart and
   migration recovery, document backup/restore and deletion behavior, and
   expose health/structured operational signals without logging customer data.
4. Wire the registered Sociobot billing subscription at **$19/month** through
   its hosted checkout/verification contract. Store a server-verified
   entitlement, restore it on another device, and make verification fail soft.
   Never embed a payment provider or secret. Keep safety, accessibility, and
   CSV export free.
5. Only then change `/pricing` and README from “not available” to the exact
   verified offer, merchant-of-record, cancellation/refund, and entitlement
   copy. No test or demo may spend money.

**M2 definition of done:** a test identity fixture proves strict tenant
isolation; an independent deployed test account verifies the normal sign-in,
restart, export/delete, checkout return, entitlement refresh, invalid/revoked
subscription, and free fallback paths. Billing tests use recorded gateway
fixtures plus the factory's registered test product; no worker asks for or
prints production credentials. The demo remains one click, not connected to
real tenant data. M2 is unaccepted until live cross-tenant and billing
verification pass.

### M3 — Recipient follow-through and escalation timeline

**Status:** planned only. The present single-demo status update is a prototype
of this job, not M3 acceptance.

**Scope and screens:** invoice detail/timeline, status-link management
(create/copy/revoke/expiry), recipient status page, CSV audit export, and an
in-app follow-up queue. The current packet is carried forward and must remain
snapshot-correct.

**Build outcome:** after the sender marks a correct packet sent, the recipient
can record received/changes/approved through a scoped link. The sender sees
an append-only receipt and a deterministic in-app “follow up on” action until
the status changes. They can revoke/regenerate a link and export the full
trail.

**Boundaries:** this milestone does **not** send email, text messages, or AP
system updates. “Email package” means sender-controlled prepared copy. A
future opt-in transactional sender would be a separate milestone with a
provider, consent, unsubscribe/retention design, and independent delivery
verification; it is not a dependency for M3.

**M3 claims and definition of done:** status updates have an invoice-scoped
token with expiry/revoke tests; they cannot alter another invoice or access
expired demo/real data; timeline dates and owner are durable across restart;
CSV includes complete events; recipient pages use a correct title/noindex and
no customer data in browser metadata/logs. Verify selected-invoice behavior,
token replay/revocation, cross-tenant denial, mobile/keyboard use, rate limit,
and a live candidate flow. M3 does not claim that AP received an email or that
an AP system was contacted.

## 5. External dependencies, risks, and release rules

### External dependencies — kept separate from product progress

| Dependency | Needed for | Current state | Rule |
|---|---|---|---|
| Product deployment and durable `/data` mount | M1 live verification and M2 persistence | Existing product deployment/mount is recorded in handoff history; rolling SQLite behavior needs re-verification after changes. | A fleet concern, not a reason to declare M1 repaired without live evidence. |
| Sociobot billing product registration and subscription entitlement contract | M2 $19/month checkout | Unavailable. Current site correctly has no checkout or paid claim. | Operator/factory provides normal registered test/live contract; product workers do not request or expose production credentials. |
| Sociobot Entra CIAM application/issuer contract | M2 sign-in | Unavailable/not integrated. | Treat sign-in as unimplemented until server validation and live two-tenant tests pass. |
| Transactional email/messaging provider | Not M1–M3 | No integration and none required for the in-app timeline. | Do not imply emails/reminders are sent. |
| HMRC or other tax authority access | Not M1–M3 | No integration; deliberate non-goal. | Do not request, add, or claim it. |

### Risks and experiments

| Risk / unknown | Experiment that retires it |
|---|---|
| The preflight fields do not match real AP rejection reasons. | With consent, recruit 5–10 pilots, import only their approved AP checklists, and compare first-review outcomes to their prior invoices. |
| Capability links are forwarded or retained too long. | M3 link expiry/revocation/reissue tests, noindex metadata review, and a security review of token hashing and logs. |
| SQLite/Azure Files cutover fails under a new revision. | Repeat the documented two-revision read/write/idle-lock test on the candidate, not just `/health`; document backup/restore before M2 accounts. |
| Billing conversion is weak at $19/month. | M2 registered test checkout and a small consented price/interview experiment; do not infer demand from demo use. |
| Public status page causes an AP recipient to think it is their AP system. | First-read test of recipient copy; retain the explicit “not the client's AP system” statement and record only the response selected. |

### Release rule

Future builders update this plan and add a milestone handoff after every
independent PASS. A green unit/browser suite, a demo, or a successful health
check alone never marks billing, messaging, sign-in, HMRC access, tenant
isolation, or a milestone complete.
