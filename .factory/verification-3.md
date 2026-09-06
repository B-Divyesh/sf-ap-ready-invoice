# AP invoice handoff verification 3

**Verdict: FAIL — M1 is not accepted.**

- Verified: 2026-09-06 UTC
- Work order: `ap-ready-invoice-verify-3`
- Current milestone: M1 acceptance
- Implementation reviewed: `8d395f7e8d49766f0cf579c8bb65b87d58f4b7cd`
- Documentation commit: `775a6051d6f32e3fcd694912100d7da706e12d7a`
- Deployed runtime identity: `GET /health` returned
  `775a6051d6f32e3fcd694912100d7da706e12d7a`.
- Live URL: <https://ap-ready-invoice.sociobot.in>
- Findings: 1 (S1)
- Untested public claims: 0

The later `4ee00f0` and `775a605` commits are documentation-only after the
implementation candidate. `git diff 8d395f7..775a605 -- src frontend
Cargo.toml package.json Dockerfile` found no runtime source changes. Local and
live `index.html` matched at SHA-256
`24cf0ba5d5fc4b7189eda157353229d7e7162be73919b71e7459db10d21eb303`.

## Finding

### S1 — live API rate limiting is not enforced

The backend contract requires every server endpoint other than health to return
HTTP 429 with `Retry-After` after its allowance is exceeded. This is also an
explicit M1 acceptance requirement.

At the live origin, 50 concurrent requests to `/api/unknown-qa` with one
`X-Forwarded-For` value returned 50 HTTP 404 responses and no 429 response. A
second independent burst of 160 concurrent requests to `/api/unknown-rate`,
again with one forwarded client address, returned 160 HTTP 404 responses and
no `Retry-After` header. The 404 results are expected for the unknown routes;
the missing limiter response is not.

The local source test for this behavior passes. This is a deployed-runtime
mismatch, not an untested source claim. It blocks M1 until the live origin
reliably returns 429 and `Retry-After` beyond its documented allowance.

## First screen and live workflow

Fresh desktop (1440 x 900) and phone (390 x 844) contexts both showed before
scrolling:

- Job: **Send invoices corporate AP can accept**.
- Audience: **For freelancers who need finance teams to approve invoices
  without another correction round.**
- First action: **Try it with sample data**. It opens a checked invoice and
  its next action.

The one-click demo showed `Invoice MVS-1042`, the persistent **Demo — sample
data, nothing is saved.** label, and **Reset demo**. It had no console errors,
no external requests, no horizontal overflow, and no Axe violations on either
desktop or phone.

In a fresh demo, I added a draft second invoice, selected `MVS-1042`, marked
only that selected invoice sent, copied its status link, and opened its packet.
The selected invoice became `waiting_on_ap`; the other remained `draft`; the
clipboard and packet status URL used the selected invoice token. A recipient
status update returned HTTP 200 and demo reset retained the label and created a
new demo token.

## Earlier findings

| Earlier finding | Result now |
|---|---|
| Multi-invoice actions used the first invoice | Fixed live: send, copied link, packet, and recipient update used the selected invoice; the other invoice was unchanged. |
| Preflight could be stale or bypassed | Fixed live: a one-cent valid invoice was `ready`; missing PO was `draft`; send returned 400. |
| Profile edits rewrote old packets | Fixed live: an earlier packet retained Northstar Systems Ltd and its saved AP email after profile update. |
| Expired demo could not reset or revoke status | Fixed locally by the exact expiry claim fixture. Live reset created a new token; live release correctly returned 404 for the debug-only expiry route. |
| Keyboard focus, email validation, Unicode count | Fixed live: form focus moved to `input[name=number]` with a 3px outline; `@` returned 400; 500 `é` characters succeeded. |
| Status metadata, landmark issue, HSTS | Fixed live: status title and `noindex, nofollow` are correct; Axe had no violations; HSTS is `max-age=31536000`. |
| $19 subscription unavailable | M2 dependency, not an M1 finding. M1 honestly shows no checkout or paid gate. |

## Local quality and claims gate

From the clean assigned checkout:

- `npm ci` passed with 0 vulnerabilities.
- `npm test` passed: build, typecheck, rustfmt, Clippy, 7 Rust tests, and 14
  Chromium tests.
- `npm run build` and `cargo build --release` passed.
- A copied release binary started with only `PORT`, generated its SQLite
  database and encryption key, and retained a workspace across restart.
- `verify-url.sh` passed against live: HTTP 200, 642ms load, basic structure,
  alt/button checks, and no console errors.

Every command declared in `.factory/claims.json` was run separately after
`npm ci` and passed. Each has exactly one matching tagged browser test:

| Claim | Exact command | Result |
|---|---|---|
| `demo-isolated` | `npm test -- --grep @claim:demo-isolated` | PASS |
| `profile-snapshot` | `npm test -- --grep @claim:profile-snapshot` | PASS |
| `preflight` | `npm test -- --grep @claim:preflight` | PASS |
| `audit-export` | `npm test -- --grep @claim:audit-export` | PASS |
| `invoice-packet` | `npm test -- --grep @claim:invoice-packet` | PASS |
| `status-receipt` | `npm test -- --grep @claim:status-receipt` | PASS |
| `encrypted-fields` | `npm test -- --grep @claim:encrypted-fields` | PASS |
| `no-tracking` | `npm test -- --grep @claim:no-tracking` | PASS |
| `purchase-disabled` | `npm test -- --grep @claim:purchase-disabled` | PASS |

Same-origin links `/`, `/demo`, `/app`, `/pricing`, `/privacy`, and `/terms`
returned HTTP 200. The designed unknown route deliberately returned HTTP 404
with its expected page and no Axe violations. Privacy and terms have
route-specific titles. There is no offline, service-worker, or update promise.
The external factory link was not fetched because it is outside product scope.

## Milestone and dependencies

M1 can be accepted only after the live limiter is repaired and independently
shown to return 429 plus `Retry-After`. Accounts, real tenant identity and
isolation, account export/delete, and operator registration of the $19/month
Sociobot subscription are M2 dependencies. They are not shipped features and
were not treated as M1 failures. As a narrow M1 boundary smoke check, a second
fresh demo workspace received HTTP 404 when requesting the first workspace's
packet.
