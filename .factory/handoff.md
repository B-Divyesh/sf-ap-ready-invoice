# AP-Ready Invoice v1 handoff

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
