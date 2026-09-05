# AP-Ready Invoice v1 handoff

## Venture plan audit: M1 not accepted — 2026-09-05

Documentation-only planner work order `ap-ready-invoice-plan-1` added
`.factory/plan.md` and `/work/.evidence/venture-plan.json`. No application
code, deployment, product data, or external configuration was changed.

- A clean `npm ci && npm test` completed with 7 Rust tests and 21 Chromium
  tests passing. That confirms the current automated suite, not the product
  outcome: independent verification already showed its M1 claims are too
  narrow.
- A fresh scoped production demo again completed the single-invoice happy
  path, then reproduced the release blocker: after selecting `MVS-1042`, the
  packet opened the newly created second invoice. The public status page still
  used the **Page not found — AP-Ready Invoice** title.
- A fresh 120-request production `/api/demo` probe received only HTTP 200
  responses and no `Retry-After`, despite the source and local test asserting a
  40-request forwarded-IP limiter. Live rate limiting is therefore not
  accepted and is preserved as M1 verification work. HSTS was also absent from
  the observed live root headers.

The next worker owns M1 repair and independent live verification exactly as
defined in `.factory/plan.md`: selected-invoice dispatch, atomic preflight,
multiple immutable profile snapshots, expiry recovery/revocation, accessibility
and metadata repairs, and observable public-origin rate limiting. Billing,
sign-in, tenant isolation, message delivery, and HMRC access remain unbuilt;
do not describe them as shipped or request production credentials.

## Independent verification 2: FAIL — 2026-09-02

Candidate `08f08de714f067c0424583b54801b3a27d0cee67` was verified locally and at `https://ap-ready-invoice.sociobot.in` under work order `ap-ready-invoice-verify-2`. Live `/health` reports the exact candidate SHA, live/local frontend hashes match, every listed claim command exits 0 after `npm ci`, the full 7-Rust/21-Playwright gate passes, the release build and zero-config startup pass, rate limiting returns 429 with `Retry-After: 1` after 40 API requests per client/second, and first-read, privacy, serious/critical Axe, mobile, header, cache, and performance gates pass.

**Do not release this candidate.** Normal multi-invoice actions target the first invoice rather than the selected invoice. New invoices can show 7/7 ready while remaining draft, and changed client requirements can be bypassed when sending. The product has one mutable workspace profile instead of the brief's reusable per-client profiles, so editing the client rewrites previously sent packet details. Actual demo expiry removes the Reset control, loops on retry, and leaves the public status URL reachable. These independently falsify the otherwise-passing invoice-packet, preflight, reusable-profile, and demo-expiry outcomes.

Additional findings are lost keyboard focus when an invoice form opens, acceptance of `@` as a finance email, incorrect UTF-8 character limits, the status page title **Page not found**, unavailable $19/month monetization, one moderate Axe landmark issue, and absent HSTS. Full commands, evidence, severities, boundaries, live workflow results, and required remediation are in `.factory/verification-2.md`.

## Repair: ap-ready-invoice-repair-2 — 2026-09-02

### Release blockers repaired

- Reproduced the exact candidate failure before editing: the old `@claim:invoice-packet` test passed, but the opened window logged `Applying inline style violates ... style-src 'self'`, loaded zero stylesheets, rendered its heading as 32px Times New Roman with no border, and exposed a 21px print button.
- Replaced the `document.write` packet with a real `/packet/<invoice-id>` route. It loads the hashed first-party stylesheet under the same strict CSP, reads the workspace key from the correct real/demo browser namespace, renders the full invoice and status URL, and provides explicit print and close controls.
- Expanded `@claim:invoice-packet` to open the packet and assert its loaded stylesheet, 44px Georgia heading, 3px rule, 44px control, print invocation, prepared email clipboard contents, status link, Axe result, and absence of console errors.
- Added strict server-side `YYYY-MM-DD` parsing with leap-year and month-length validation. Malformed values such as `not-a-date`, `zzzz`, and `2026-02-30` now return HTTP 400 and can never make the dates preflight row ready. Rust boundary tests and a full API regression cover invalid, impossible, ordered, and leap-day dates.
- Removed the unavailable checkout, price, license restore, and Pro gating from public copy and runtime code. Status links and receipt tracking remain usable while the operator-gated billing registration is pending. `@claim:purchase-disabled` proves there is no checkout URL or paid price and no disabled status action.
- Pinned the Axe adapter and `playwright-core` to Playwright 1.58.2, added Node types, and made `npm run typecheck`, `cargo fmt -- --check`, and Clippy part of `npm run lint` and `npm test`.
- Raised demo, header, footer, and inline legal-link targets to at least 44×44 CSS pixels. The 390px regression measures every visible link and button across `/`, `/demo`, `/pricing`, `/privacy`, `/terms`, and the designed 404.
- Split known frontend routes from the backend fallback. Unknown paths now return HTTP 404 while rendering the broadsheet 404 screen; known deep links still return 200.
- Added `Cache-Control: public, max-age=31536000, immutable` to hashed `/assets/*`, one-week caching to stable artwork/icons, and `no-store` to HTML. The response-policy regression checks both HTML and a built hashed asset.
- Removed the unused external billing origin from CSP and kept `style-src 'self'`; the printable packet is fully styled without inline-style exceptions.
- The final identity check caught a rolling-deploy lock that a plain HTTP 200 would have hidden: the old revision retained SQLite's `unix-excl` connection, so its replacement panicked with `open database: PoolTimedOut` while ingress kept serving the old SHA. Normal runtime locking allowed rolling startup but made live Azure Files writes stall. The final design keeps reliable `unix-excl` writes and gives the one-connection runtime pool a one-second idle timeout so its filesystem lock is released promptly between requests and revisions. A regression waits for that pool to reach zero connections, then opens and reads through a second exclusive pool.

### Local verification evidence

- Clean install: `npm ci` passed with 23 packages and 0 vulnerabilities.
- Complete gate: `npm test` passed with 7 Rust tests and 21 Chromium tests. It includes TypeScript, rustfmt, Clippy with `-D warnings`, all eight claim tests, desktop flows, 390px mobile targets, keyboard navigation, privacy request boundaries, Axe checks, rate limiting, HTTP 404, caching policy, and rolling-revision SQLite access.
- Every exact command in `.factory/claims.json` passed independently from the demo entry point.
- `cargo build --release` passed. A release binary started with only `PORT=4181`, generated local fallback state under `./data`, and served successfully.
- `/opt/fleet/lib/verify-url.sh http://127.0.0.1:4181 <temp-dir>` passed: HTTP 200, 645ms load, correct title and `lang=en`, one `h1`, one `main`, no missing alt text, no unnamed button, and no console errors.
- Header checks: `/missing-page` returned HTTP 404 with `Cache-Control: no-store`; the built hashed JavaScript returned `Cache-Control: public, max-age=31536000, immutable`; CSP contains `style-src 'self'` with no unsafe-inline exception.
- Lighthouse 12.8.2 mobile: Performance 100, Accessibility 100, Best Practices 100, SEO 100; FCP 1.1s, LCP 1.7s, TBT 10ms, CLS 0.
- Production frontend: 23,203-byte JavaScript (7.92 KB gzip), 14,058-byte CSS (3.81 KB gzip), 25,094-byte mobile hero, and 101,102-byte large hero.
- Visual inspection covered the full desktop landing page, 390×844 demo workspace, and the styled printable packet. No overflow, clipping, or broken hierarchy was found.

### Known external dependency

- Checkout registration remains operator-gated. This repair did not touch billing, shared services, secrets, or resources outside `sf-ap-ready-invoice*`. The site exposes no purchase action or paid gate until registration is available.
- No service worker is shipped and no offline/update claim is made. Email remains prepared for the sender to copy; the product does not impersonate or send through a client's AP system.

### Deployment evidence

- Pushed repair commit `0e5c212ea65d8f6ef66b90f294188c7efa32556b` and deployed it with `WO_DATA_DIR=/data /opt/fleet/lib/deploy-container.sh ap-ready-invoice /work/repo Dockerfile 8080`.
- ACR build `ch1xr` completed successfully with image tag `sf-ap-ready-invoice:0e5c212ea65d`. Scoped revision `sf-ap-ready-invoice--0000008` became Healthy and Provisioned with one replica and 100% traffic. The existing fleet-created share `sf-ap-ready-invoice-data` remains mounted at `/data`.
- Both the container-app hostname and `https://ap-ready-invoice.sociobot.in/health` returned build SHA `0e5c212ea65d8f6ef66b90f294188c7efa32556b`. The live and local `index.html` SHA-256 values matched at `52346650c308e87d7abcc9ec36012bcd027269f5e428846c9147f92dbcf0f49f`.
- Live `verify-url.sh` passed: HTTP 200, 568ms load, correct title/lang/landmarks, no missing alt text or unnamed controls, and no console errors. A live 390px demo and packet inspection found no sub-44px target, no packet console error, one loaded packet stylesheet, the expected Georgia heading and 3px rule, a canonical status URL, and zero checkout links.
- Live `/missing-page` returned HTTP 404. `/assets/index-Bpkv0BSb.js` returned `Cache-Control: public, max-age=31536000, immutable` under the strict self-only style CSP. A 100-request concurrent live `/health` smoke returned 100 HTTP 200 responses.
- A documentation-only follow-up first exposed the retained exclusive runtime lock and never became ready; the domain correctly stayed on the prior healthy revision. A normal-locking trial then proved rolling startup but failed the required live write: `POST /api/demo` waited on Azure Files for the 60-second busy timeout. Both conditions were treated as blockers rather than accepting health-only evidence.
- Commit `2a833a8fda3d355b18cd8c1cfcf9bc657b8af9f6` built in ACR run `ch1y6`. Only this product's old locked revisions were deactivated for that one-time recovery. Its persisted `/data` key and database remained intact.
- The deployment after this handoff entry verifies the final short-idle exclusive-pool design. Acceptance requires the new revision to report the repository-tip SHA and `POST /api/demo` to complete promptly. The local two-pool regression proves that an idle runtime pool drops to zero connections before the next exclusive revision opens.

## Independent verification: FAIL — 2026-09-02

Candidate `f0df92ce2ec66cfa2e0b968f61307bd036e65bbe` was verified locally and at `https://ap-ready-invoice.sociobot.in`. The live `/health` identity and frontend hash match the candidate, all seven listed claim commands pass after `npm ci`, `npm test` passes (5 Rust + 17 Chromium tests), the release build passes, and the cold first-read/demo gate passes.

**Do not release this candidate.** Production checkout returns HTTP 404, and opening the printable packet triggers a CSP console error that blocks all packet styling. The packet claim test does not open or inspect that output. Additional findings are malformed dates accepted as AP-ready, unlisted paid-tier claims, failing `npx tsc --noEmit` and `cargo fmt -- --check`, sub-44px mobile targets, unknown routes returning HTTP 200, and absent immutable asset caching.

Full independent evidence and required remediation are in `.factory/verification.md`.

## Repair: ap-ready-invoice-repair-1

- Repaired the failed `a539cb2929044ebf3236b28e96d3943a70f9a924` container revision. Product revision logs showed two Azure Files startup conditions before the listener could bind `PORT`: POSIX `chmod` returned `Operation not permitted (os error 1)`, then SQLite migration returned `database is locked` after its 5-second default wait. The failed first migration left a zero-byte database and rollback journal; the journal is now renamed in place as recovery evidence (never deleted) before SQLite initialises a fresh empty database.
- `/data` is unchanged and remains the durable SQLite/key location. File-mode attempts now log whether they succeeded and continue with the Azure Files mount ACL when POSIX modes are unavailable. The startup log reports the selected database, key source, build identity, and listener address without exposing secret material.
- Added Rust regression coverage for Azure Files `PermissionDenied`/`EOPNOTSUPP` mode-change handling, temporary SQLite lock classification, and preservation of a stale journal beside a zero-byte database. SQLite now uses its single-replica `unix-excl` VFS with one exclusive connection, DELETE journaling, a 60-second busy timeout, and four migration attempts with bounded backoff; every failed attempt closes its pool first, so it cannot wait on its own journal lock while a replacement revision adopts the durable database.

### Repair verification before deployment

- `npm test` passed: Vite production build, 5 Rust unit tests, and 17 Chromium tests (claims, demo isolation, privacy request boundary, mobile/keyboard, Axe accessibility, and forwarded-IP rate limiting).
- `cargo build --release` passed. A clean temporary data directory launched the release server on `PORT=18080`; `GET /health` and `GET /` both returned HTTP 200.
- `/opt/fleet/lib/verify-url.sh http://127.0.0.1:18081 <temp-evidence-dir>` passed: HTTP 200, `lang=en`, one `h1`, `main`, no missing image alt text or unlabeled buttons, no console errors; local load was 640 ms. The existing Playwright Axe suite found no serious or critical violations.

### Deployment evidence

- Exact clean container build/deploy command: `WO_DATA_DIR=/data /opt/fleet/lib/deploy-container.sh ap-ready-invoice /work/repo Dockerfile 8080`. ACR image `sociobotregistry.azurecr.io/sf-ap-ready-invoice:b48da2b35141` built successfully from commit `b48da2b35141226532ba4eec52c88fb91d26ca87`.
- Active revision `sf-ap-ready-invoice--0000006` is ready with one replica. Its startup log records the preserved empty-database journal, Azure Files mode fallback, generated `/data/encryption.key`, and `server listening` on `0.0.0.0:8080`.
- On 2026-09-02, both `https://sf-ap-ready-invoice.orangepond-1638693f.eastus2.azurecontainerapps.io/` and `https://ap-ready-invoice.sociobot.in/` returned root `200` and `/health` `200`; both health responses reported build SHA `b48da2b35141226532ba4eec52c88fb91d26ca87`.
- Live `verify-url.sh` against the custom domain passed: HTTP 200, no console errors, title/lang/one-h1/main/alt/button baseline all passed, with a 649 ms page load.

## What shipped

- A Rust 2021 Axum service on `PORT` with SQLite migrations, JSON logs, graceful shutdown, secure response headers, forwarded-IP rate limiting, and `GET /health` build identity.
- Durable data at `/data` in the container, with a local `./data` fallback. The database and generated ChaCha20-Poly1305 key use owner-only file permissions.
- Browser-keyed workspaces with reusable client AP profiles and multiple invoices.
- Seven preflight checks covering sender, payer, dates, PO, tax, payment instructions, amount, and description.
- A clear next action for draft, ready, sent, received, change-requested, and approved states.
- Printable invoice packets, prepared finance email copy, unguessable recipient status links, follow-up events, and CSV receipt exports.
- A one-click `/demo` with Mara Vale Studio sample data, a separate browser namespace, random server workspace, reset control, and 24-hour expiry.
- A $19 monthly Pro path through the Sociobot checkout. Returned license tokens use `sb_license:ap-ready-invoice`, verify against the Sociobot endpoint, cache for one day, and can be pasted on the Pricing page. Preflight, printing, and CSV remain free; status follow-through is the Pro control.
- `/privacy`, `/terms`, `/pricing`, `/app`, `/demo`, public `/status/<token>`, and a designed unknown-route screen.
- Original generated broadsheet artwork, responsive WebP sources, a product-derived social card, favicon, and touch icon. Provenance is in `.factory/design.md` and `assets/src/`.

## Run and verify

```bash
npm install
npm test
npm run build
cargo build --release
PORT=8080 STATIC_DIR=frontend/dist target/release/ap-ready-invoice
```

`npm test` passed on 2026-09-02:

- 2 Rust unit tests passed.
- 17 Playwright tests passed in Chromium 1.58.2.
- All seven claim tests in `.factory/claims.json` passed.
- Axe found zero serious or critical issues on `/`, `/demo`, `/app`, `/pricing`, `/privacy`, `/terms`, and the unknown-route screen.
- Mobile verification used a 390 × 844 viewport and found no horizontal overflow.
- The rate-limit test produced HTTP 429 with `Retry-After: 1` after the burst allowance.

Additional verification:

- `verify-url.sh`: HTTP 200, one `h1`, `lang=en`, main landmark present, no missing alt text, no unlabeled buttons, and no console errors. Local measured load: 618 ms.
- Lighthouse mobile: Performance 100, Accessibility 100, Best Practices 100, SEO 100. LCP 1.1 s, CLS 0, total blocking time 0 ms.
- Frontend production output: 8.59 KB gzip JavaScript and 3.49 KB gzip CSS. Largest shipped hero source: 99 KB WebP.
- Release build: `cargo build --release` passed.
- Load smoke: 100 concurrent `GET /health` requests returned 100 HTTP 200 responses.
- Valid SPA deep links return HTTP 200 from the container fallback.

## Operations

- No infrastructure, DNS, billing registration, or resources outside this repository were touched.
- The container starts with no required environment variables. `PORT` defaults to 8080.
- The factory should mount its durable share at `/data` and pass `BUILD_SHA` during the Docker build.
- The runtime image is Debian slim, runs as the non-root `app` user, and exposes port 8080.

## Known external handoff

- The production checkout and a real paid license cannot be exercised until the factory registers `ap-ready-invoice` in the Sociobot billing service. The URL and verification contract are implemented without a hardcoded product ID.
- The product prepares email copy but does not send email. This keeps the sender in control and avoids impersonating a client's AP system.
- PDF delivery uses the browser's print or Save as PDF flow. This avoids storing generated document files on the server.
