# Independent verification 2 — FAIL

Verified on 2026-09-02 UTC.

- Candidate: `08f08de714f067c0424583b54801b3a27d0cee67`
- Live URL: `https://ap-ready-invoice.sociobot.in`
- Work order: `ap-ready-invoice-verify-2`
- Result: **FAIL — do not release**
- Live identity: `GET /health` returned HTTP 200 with `build_sha` exactly `08f08de714f067c0424583b54801b3a27d0cee67`.
- Deployment match: local and live `index.html` both had SHA-256 `52346650c308e87d7abcc9ec36012bcd027269f5e428846c9147f92dbcf0f49f`. The built/live JavaScript, CSS, and mobile hero hashes also matched.

## Release-blocking findings

### S1 — Multi-invoice actions operate on the wrong invoice

The workspace correctly highlights a selected invoice, but **Open invoice packet**, **Mark packet sent**, **Copy status link**, **Copy email cover note**, and **Export receipt CSV** operate on the first item in the dashboard list instead of the selected item.

Fresh live demo reproduction:

1. Open invoice `MVS-1042`.
2. Add `QA-SECOND-0902`.
3. Select `MVS-1042`; its heading, status, and selected index button all show that it is active.
4. Click **Open invoice packet**. The popup heading is `Invoice QA-SECOND-0902`.
5. In a second run, leave the newer invoice in draft, select ready invoice `MVS-1042`, and click **Mark packet sent**. The visible invoice remains **Ready to send**, but the action returns `This packet is not ready` because it targeted the hidden draft.

This breaks the normal workflow as soon as a freelancer has more than one invoice. The existing multi-invoice test only checks navigation and never exercises an action after selection.

### S1 — Preflight state contradicts its checks and can be bypassed

Two independent live paths violate the core preflight promise:

- Creating a fully valid invoice at the 1-cent boundary returned HTTP 201 with `7/7` checks ready, but stored `status: "draft"`, displayed **Needs details**, set the next action to **You fix the missing invoice details**, and disabled **Mark packet sent**. Editing the unchanged invoice and running preflight a second time is required before it can be sent.
- After that invoice became `ready`, changing its shared profile to require a missing PO made the PO check false while leaving `status: "ready"` and next action **You send the invoice packet**. `POST /api/invoices/<id>/send` then returned HTTP 200 and changed it to `waiting_on_ap` despite the failed requirement.

Therefore `@claim:preflight` passes only its narrow fixture; the claimed outcome is false for normal create and profile-change paths.

### S1 — Required reusable client profiles do not exist, and edits rewrite old packets

The brief requires reusable client AP profiles. The product has exactly one profile per workspace (`profiles.workspace_id` is the primary key), no client selector, and no per-invoice profile snapshot.

In a fresh live demo, invoice `MVS-1042` initially produced a packet for **Northstar Systems Ltd** addressed to `ap@northstar.example`. After editing the workspace profile to **Changed Client Holdings** and `changed-ap@example.test`, fetching the already-sent invoice packet changed its client and finance email to those new values. Historical invoice handoff data is therefore mutable and incorrect.

This is also an unlisted and false README claim: “Reusable client AP profiles” has no matching claim entry or outcome test.

### S1 — The demo expiry claim has no working recovery and leaves public data reachable

`@claim:demo-isolated` only checks that `expires_at` is approximately 24 hours in the future. It does not test actual expiry.

Independent expiry reproduction used a fresh local release server and moved only that test workspace's `expires_at` into the past:

- `GET /api/dashboard` returned HTTP 410 with `This demo has expired. Reset the demo to continue.`
- Reloading `/demo` rendered **The demo could not open**, removed the persistent demo banner and **Reset demo** control, and showed only **Try again**.
- Clicking **Try again** reused the expired localStorage key and returned to the same error indefinitely.
- `GET /api/status/<sample-token>` still returned HTTP 200 with the sample invoice after expiry.

The promised reset recovery is unavailable precisely when it is needed, and part of the expired demo remains publicly usable. The claim test is an inadequate false positive.

## Other findings

### S2 — Opening the invoice form by keyboard loses focus

Keyboard-only navigation reaches and activates **Edit invoice** with a visible 3px focus ring. After activation, focus falls to `<body>` because the implementation attempts to focus the form's hidden input. The next Tab starts again at the site wordmark instead of the first invoice field. The form remains reachable, but the focus-management baseline is not met.

### S2 — API validation accepts an invalid AP address and miscounts Unicode text

- `PUT /api/profile` accepted `ap_email: "@"` with HTTP 200. The payer preflight checks only for the presence of `@`, so this malformed address can be marked ready through the backend.
- A work description containing exactly 500 `é` characters was rejected with `Describe the work in 500 characters or fewer.` The UI permits 500 such characters, but the backend enforces UTF-8 byte length rather than character length. Exactly 500 ASCII characters passed.

Other checked boundaries behaved correctly: 1 and 1,000,000,000 cents, leap day, 50-character invoice number, 500 ASCII-character description, and 30-day escalation were accepted; zero/over-limit amounts, unsupported currency, malformed/impossible/reversed dates, 51-character invoice number, 501 ASCII characters, escalation 0/31, duplicate number, invalid status action, and a 501-character note returned 400. A valid request succeeded after invalid requests.

### S2 — The secure recipient route has the wrong page title

A valid live `/status/<token>` page rendered the correct invoice but kept the title **Page not found — AP-Ready Invoice**. Its canonical URL includes the status token and it has no `robots=noindex` directive. The packet route set its invoice-specific title correctly.

### S2 — The researched $19/month subscription is not available

The acceptance brief defines a $19/month subscription. `/pricing` instead says **Purchases are not available yet**, and the site has no price, checkout, license restore, or paid boundary. Removing the previously broken checkout avoids a dead link but does not fulfill the monetization contract.

### S3 — One moderate Axe landmark issue remains

Desktop and mobile Axe runs found no serious or critical violations. The landing page has one moderate `landmark-complementary-is-top-level` violation because its margin-note `aside` is nested in a section. All other checked public routes, the recipient status page, and printable packet had no Axe violations.

### S3 — HSTS is absent

Live responses include CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options`, but no `Strict-Transport-Security` header.

## Mandatory claims gate

The very first pre-install invocation attempted every exact command and each stopped at `vite: not found`, as expected for an uninstalled clean clone. After the required `npm ci`, all eight exact commands were rerun independently and exited 0:

| Claim | Exact command | Command result | Independent outcome |
|---|---|---|---|
| `demo-isolated` | `npm test -- --grep @claim:demo-isolated` | PASS, 1 test | **FAIL**: expiry/reset/status behavior above is not tested |
| `preflight` | `npm test -- --grep @claim:preflight` | PASS, 1 test | **FAIL**: valid creates stay draft; changed requirements can be bypassed |
| `audit-export` | `npm test -- --grep @claim:audit-export` | PASS, 1 test | PASS for one invoice; wrong selected-invoice dispatch is an S1 defect |
| `invoice-packet` | `npm test -- --grep @claim:invoice-packet` | PASS, 1 test | **FAIL** with multiple invoices because the wrong packet opens |
| `status-receipt` | `npm test -- --grep @claim:status-receipt` | PASS, 1 test | PASS for the single-invoice fixture |
| `encrypted-fields` | `npm test -- --grep @claim:encrypted-fields` | PASS, 1 test | PASS |
| `no-tracking` | `npm test -- --grep @claim:no-tracking` | PASS, 1 test | PASS |
| `purchase-disabled` | `npm test -- --grep @claim:purchase-disabled` | PASS, 1 test | PASS, but monetization remains outside the brief |

Every claim ID has exactly one matching `@claim:<id>` tag. The failures above are assertion-coverage failures, not missing tags.

## First-read test

**PASS.** Cold loads at 1440×900 and 390×844 answer all three required questions in the initial viewport:

- What it does: **Send invoices corporate AP can accept**.
- For whom: **For freelancers who need finance teams to approve invoices without another correction round.**
- What to click first: **Try it with sample data**, with adjacent text explaining that it opens a checked invoice and next action.

The one-click action opens invoice `MVS-1042` with the persistent **Demo — sample data, nothing is saved** banner, **Reset demo**, and **Start for real**. Cold loads had no console/page errors and made only same-origin requests.

## Build and repository gates

| Check | Result |
|---|---|
| Candidate checkout | PASS; clean at exact requested commit |
| `npm ci` | PASS; 23 packages, 0 vulnerabilities |
| `npm test` | PASS; build, TypeScript, rustfmt, Clippy, 7 Rust tests, 21 Chromium tests |
| `npm run build` | PASS; `frontend/dist/` produced |
| `npm run lint` / `npm run typecheck` | PASS within the full gate |
| `cargo build --release` | PASS |
| OCI image build | Not run; Docker, Podman, Buildah, and nerdctl are absent in the verifier image |

The frontend output is 23,203 bytes JavaScript (7,954 bytes gzip), 14,058 bytes CSS (3,829 bytes gzip), 25,094-byte mobile hero, and 101,102-byte large hero. These are within budget. The social card is a real 1200×630 WebP and the touch icon is 180×180.

A release binary copied into a fresh directory started with `env -i PORT=4182` and no other environment variables. It generated `./data`, served `/` and `/health`, wrote the database and key with mode 600, shut down cleanly, restarted with the persisted key, and retained the test profile/invoice. The Dockerfile statically satisfies the non-root, `rust:1-slim`, `ARG BUILD_SHA=dev`, `/data`, and `PORT` contracts.

## Live workflow and backend evidence

The single-invoice happy path works:

1. Fresh `/api/demo` returned an isolated 43-character workspace token and a 24-hour timestamp.
2. Sample invoice `MVS-1042` had 7/7 checks, `ready`, and the correct next action.
3. Packet data contained the expected AP email and same-origin status URL; the rendered packet loaded its stylesheet, had a 46px mobile print control, and produced no console/Axe error.
4. Marking sent returned `waiting_on_ap`.
5. The recipient page opened the expected invoice, accepted **received** with a note, and the note appeared in the audit.
6. CSV export returned HTTP 200, `text/csv`, attachment disposition, six rows, and the receipt note.

Authentication boundaries returned 401 for dashboard, packet, and storage-check calls without a workspace token. Thirty concurrent authenticated dashboard reads completed in 83ms with 30 HTTP 200 responses. A 100-request live `/health` smoke returned 100 HTTP 200 responses.

Rate limiting is enforced across `/api`: 160 concurrent requests from one forwarded client produced 40 normal 404 responses and 120 HTTP 429 responses. The limited responses included `Retry-After: 1`; after 1.1 seconds the same client was admitted again. The observed allowance is **40 API requests per client IP per one-second window**. `/health` is exempt.

## Privacy, headers, accessibility, routes, and performance

- Landing, full demo, packet, and recipient flows contacted only `https://ap-ready-invoice.sociobot.in`. No analytics, CDN font, or third-party script request occurred. Browser storage contained only the documented workspace key.
- HTML returns `Cache-Control: no-store`; hashed JS/CSS return `public, max-age=31536000, immutable`; artwork/icons return a one-week policy. Unknown routes return a designed HTTP 404.
- The factory `verify-url.sh` passed: HTTP 200, 578ms load, correct title and `lang=en`, one `h1`, one `main`, no missing alt text or unnamed button, and no console errors.
- Desktop and 390px checks found one `h1`, one `main`, no horizontal overflow, and no sub-44px visible link/button on every public route. Focus is a visible 3px proof-red outline. Reduced motion changes active animations to 0.01ms and disables smooth scrolling.
- Axe found zero serious/critical issues on `/`, `/demo`, `/app`, `/pricing`, `/privacy`, `/terms`, `/missing-page`, the printable packet, and a valid status page.
- Lighthouse 12.8.2 mobile: Performance 99, Accessibility 100, Best Practices 100, SEO 100; FCP 1.2s, LCP 1.7s, TBT 70ms, CLS 0, total transfer 138KiB.
- All public internal links returned 200 except the intentionally tested missing route at 404. The external Param Factory link returned 200; the privacy mail link is a valid `mailto:`.
- No service worker or manifest exists and no offline/PWA claim is made. No sign-in is required, so Entra verification is not applicable. No library/CLI packaging check is applicable.

## Required remediation

1. Dispatch every invoice action using the selected invoice and add action-level multi-invoice tests.
2. Compute status from preflight on create and whenever client requirements change; refuse send unless current checks all pass.
3. Implement multiple saved client AP profiles and snapshot the selected profile fields onto each invoice/packet so later edits cannot rewrite history.
4. Test actual demo expiry, automatically replace an expired demo key, retain the Reset control on errors, and reject/delete expired public status data.
5. Move keyboard focus to the first visible field, validate real email syntax, count description characters consistently, and set a correct status-route title/noindex policy.
6. Complete the researched monetization path through the allowed Sociobot billing API before advertising this as the contracted paid product.

