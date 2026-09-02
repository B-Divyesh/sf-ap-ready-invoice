# Independent verification — FAIL

Verified on 2026-09-02 UTC.

- Candidate: `f0df92ce2ec66cfa2e0b968f61307bd036e65bbe`
- Live URL: `https://ap-ready-invoice.sociobot.in`
- Work order: `ap-ready-invoice-verify-1`
- Result: **FAIL — do not release**
- Live identity: `GET /health` returned HTTP 200 and `build_sha` `f0df92ce2ec66cfa2e0b968f61307bd036e65bbe`. The live and local built `index.html` files both had SHA-256 `4aa854a8727084afd3aefcc414a1a918e3d6993b1b74375efddd27992acb104f`.

## Release-blocking findings

### S1 — The advertised paid checkout is unavailable

Both the landing page and `/pricing` advertise **Buy Pro for $19 monthly**. On the verified production URL, that link resolves to:

```text
GET https://api.sociobot.in/api/v1/products/ap-ready-invoice/checkout
HTTP 404
{"error":"enabled factory product","status":404}
```

The real workspace disables status follow-through without a verified Pro license, so a customer cannot buy the feature that supplies the brief's secure status link and receipt tracking. This is a dead public link and a broken monetization path.

### S1 — The printable invoice packet violates CSP and loses its design

Opening **Open invoice packet** on the live demo produces a browser console error:

```text
Applying inline style violates the following Content Security Policy directive 'style-src 'self''.
```

The popup inherits the site's CSP, which blocks the inline `<style>` written by `printPacket`. Browser inspection found zero stylesheets, a default 32px Times New Roman heading, and no intended heading rule. The text can still be printed, but the promised branded/print-ready packet from the researched brief is not delivered and the action violates the no-console-errors quality gate.

The `@claim:invoice-packet` test is a false positive: it checks that the print button is enabled and separately inspects the packet API, but never opens the printable packet or asserts its rendered/printed output. That does not satisfy the claims contract's observable-outcome requirement.

### S1 — Public paid-tier claims are absent from the claims manifest

The landing page, pricing page, terms, and README claim a `$19 per month` Pro checkout, license restore, free-versus-Pro feature boundaries, and Sociobot merchant-of-record behavior. `.factory/claims.json` has no paid-tier or checkout claim/test. The checkout claim is demonstrably false in production. The claim catalog therefore does not cover all public claims as required.

## Other findings

### S2 — Invalid dates pass backend validation and preflight

A direct invoice create request with `issue_date: "not-a-date"` and `due_date: "zzzz"` returned HTTP 201. Its `Issue and due dates` preflight check reported `ready: true`. The backend only compares the two strings lexically and does not validate calendar dates. Native date inputs reduce normal UI exposure, but the server does not validate input at the edge and can store an AP-invalid invoice.

### S2 — Available static checks fail

- `npx tsc --noEmit` failed. The repository lacks Node type definitions for `node:*` modules and `Buffer`, and the Axe/Playwright page types conflict because multiple Playwright-core versions are resolved.
- `cargo fmt -- --check` failed with formatting differences in `src/main.rs`.
- `cargo clippy --all-targets -- -D warnings` passed.

### S2 — Mobile touch targets are smaller than 44px

At 390px, live measurements include **Reset demo** and **Start for real** at 36px high. Footer links are 24px high, and some header links are narrower than 44px. This violates the attached 44×44 CSS-pixel target requirement. Axe does not flag these as serious/critical.

### S3 — Unknown routes return HTTP 200

`/missing-page` renders the designed not-found screen and correct page title, but the HTTP response is 200 rather than 404. The same applies to arbitrary unknown paths because the backend serves `index.html` as its fallback.

### S3 — Static assets have no explicit cache policy

The hashed JavaScript and CSS, hero images, social card, and HTML return `Last-Modified` but no `Cache-Control` and no `ETag`. The required long-lived immutable caching policy for hashed assets is absent.

## Mandatory claims gate

The first attempt was made before dependency installation, as ordered, and all commands stopped at `vite: not found`. After the required clean `npm ci`, every exact command from `.factory/claims.json` was rerun serially and passed:

| Claim | Exact command | Result |
|---|---|---|
| `demo-isolated` | `npm test -- --grep @claim:demo-isolated` | PASS, 1 test |
| `preflight` | `npm test -- --grep @claim:preflight` | PASS, 1 test |
| `audit-export` | `npm test -- --grep @claim:audit-export` | PASS, 1 test |
| `invoice-packet` | `npm test -- --grep @claim:invoice-packet` | PASS, 1 test, but inadequate assertion noted above |
| `status-receipt` | `npm test -- --grep @claim:status-receipt` | PASS, 1 test |
| `encrypted-fields` | `npm test -- --grep @claim:encrypted-fields` | PASS, 1 test |
| `no-tracking` | `npm test -- --grep @claim:no-tracking` | PASS, 1 test |

## First-read test

**PASS.** On a cold 390×844 and 1440×900 load, the first screen plainly answers all three questions:

- What it does: **Send invoices corporate AP can accept**.
- For whom: **For freelancers who need finance teams to approve invoices without another correction round.**
- What to click first: **Try it with sample data**, visible in the initial viewport; its adjacent text says that a checked invoice and next action will open.

The one-click demo opens invoice `MVS-1042` with a persistent **Demo — sample data, nothing is saved** banner, **Reset demo**, and **Start for real**. There was no horizontal overflow or cold-load console/page error.

## Build and repository checks

| Check | Result |
|---|---|
| `npm ci` | PASS; 22 packages installed, 0 vulnerabilities |
| `npm test` | PASS; Vite build, 5 Rust tests, 17 Chromium tests |
| `npm run build` | PASS; `frontend/dist/` produced |
| `cargo build --release` | PASS |
| `cargo clippy --all-targets -- -D warnings` | PASS |
| `npx tsc --noEmit` | FAIL |
| `cargo fmt -- --check` | FAIL |
| Dockerfile build | NOT RUN; this verifier image has no Docker, Podman, Buildah, or nerdctl |

Production frontend output was 25,250 bytes JavaScript (8.59 KB gzip) and 12,402 bytes CSS (3.49 KB gzip). The 720px hero was 25,094 bytes and the 1200px hero was 101,102 bytes. These pass the bundle budgets.

## End-to-end and backend evidence

Using a fresh live demo workspace:

1. Removing the required PO changed the PO check to `ready: false` and the next action to **You fix the missing invoice details**.
2. Restoring the PO and using the 1-cent minimum boundary changed the invoice to `ready`.
3. The packet endpoint returned the finance email and a status URL containing the invoice's unguessable token.
4. Marking the packet sent changed status to `waiting_on_ap`.
5. The public status URL returned the expected invoice, accepted **We received this invoice** with a note, and changed the workspace invoice to `received` with the note in its event trail.
6. CSV export returned `timestamp,event,actor,detail` and event rows.
7. **Copy email cover note** wrote the To, Subject, body, and status URL to the clipboard with no console errors.

Boundary/error checks returned 400 for zero and over-limit amounts, unsupported currency, due date before issue date, descriptions over 500 characters, duplicate invoice numbers, and missing workspace tokens. The malformed-date exception is documented above.

A release server started from a fresh temporary directory with only `PORT` supplied, generated a local `data/` SQLite database and encryption key, and served successfully. After graceful shutdown and restart, the saved profile and invoice were present. The database and key were mode 600. The live service returned 100/100 HTTP 200 responses to concurrent health requests.

## Rate limits

- Product API: a single forwarded client received 40 responses in one second; the next 6 returned HTTP 429 with `Retry-After: 1`. A request after 1.1 seconds was accepted by the limiter. Source inspection confirms the limiter wraps every `/api` route; `/health` is exempt.
- Sociobot license verification: 46 concurrent invalid verification requests returned 30 HTTP 200 and 16 HTTP 429, with `Retry-After: 4` on the limited responses. The invalid-license UI showed a clear recovery message.

## Privacy, headers, accessibility, and routes

- The cold landing and full demo traffic contacted only `https://ap-ready-invoice.sociobot.in`. The license restore action contacted only the documented `https://api.sociobot.in` endpoint.
- Live responses included CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `X-Frame-Options: DENY`.
- The factory `verify-url.sh` passed: HTTP 200, 643ms load, `lang=en`, one `h1`, one `main`, no missing image alt, no unnamed button, and no initial console error.
- Live Playwright Axe checks found zero serious/critical violations on `/`, `/demo`, `/app`, `/pricing`, `/privacy`, `/terms`, and the designed unknown-route screen.
- Every checked page had one `h1`, a `main`, route-specific title, `lang=en`, no horizontal overflow at 390px, and no initial console/page error.
- Focus styling is a visible 3px proof-red outline. Route changes focus the new `h1`; the skip link exists. Reduced-motion emulation reduces animation duration to 0.01ms and removes transitions.
- All internal navigation, legal, metadata-image, and factory links returned 200. The checkout was the sole dead link.
- No service worker is shipped and no offline/PWA claim is made.
- No sign-in is required, so Entra authority verification is not applicable.

## Lighthouse and performance

Lighthouse 12.8.2, mobile defaults, live production URL:

- Performance: 99
- Accessibility: 100
- Best Practices: 100
- SEO: 100
- FCP: 1.1s
- LCP: 1.7s
- TBT: 110ms
- CLS: 0
- Total transfer: 138 KiB

## Required remediation before release

1. Register/enable the billing product and verify a real checkout and returned license end to end, or remove the paid offer and gating until it exists.
2. Move packet styles and print behavior into CSP-compatible assets; test the opened packet, its rendered styles, console, print action, email copy, and status URL under `@claim:invoice-packet`.
3. Add claim entries/tests for the paid price, checkout, restore, and free/Pro boundaries.
4. Parse and validate real calendar dates server-side, with invalid and boundary tests.
5. Make `tsc` and `cargo fmt --check` pass and expose them as normal scripts/gates.
6. Bring all mobile targets to at least 44×44px, return a real HTTP 404 for unknown routes, and add immutable cache headers for hashed assets.
