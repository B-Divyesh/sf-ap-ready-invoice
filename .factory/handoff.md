# AP-Ready Invoice v1 handoff

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
