# AP-Ready Invoice repair handoff

## Status

Current venture milestone: M1 acceptance. Independent verification 3 found a
live S1 rate-limit failure, so M1 is **not accepted**.

- Implementation commit: `8d395f7e8d49766f0cf579c8bb65b87d58f4b7cd`
- Candidate deployment documentation commit:
  `4ee00f0c8737dda0121d4e4bad63427659612ddc`
- Final pre-verification documentation commit:
  `775a6051d6f32e3fcd694912100d7da706e12d7a`
- Live health build SHA: `775a6051d6f32e3fcd694912100d7da706e12d7a`
- Active product revision: `sf-ap-ready-invoice--0000014`, healthy, one
  running replica. Its scale contract remains `minReplicas: 1`,
  `maxReplicas: 1`.

The job is to prepare an invoice packet corporate AP can accept. The audience
is freelancers and small studios paid through corporate finance. On the first
screen, the first action is **Try it with sample data**; it opens a checked
invoice and its next action.

## Latest independent verification

Report: `.factory/verification-3.md`.

- **FAIL:** two live one-client bursts (50 and 160 API requests) received no
  HTTP 429 or `Retry-After`. Local rate-limit coverage passes, making this a
  deployed-runtime mismatch. M1 cannot be accepted until the repaired live
  origin is independently retested.
- The clean local quality gate and all nine claim commands passed. Fresh
  desktop and phone checks also passed for selected-invoice actions, profile
  snapshots, preflight, reset, status updates, accessibility, legal routes,
  designed 404, HSTS, and release-only-`PORT` restart persistence.
- The live health endpoint now reports documentation SHA
  `775a6051d6f32e3fcd694912100d7da706e12d7a`. Candidate implementation
  `8d395f7` remains the reviewed runtime source: later commits change docs
  only, and local/live index HTML hashes matched.

## What changed

- Added reusable `client_profiles` and invoice-owned profile snapshots through
  migration `0002_profile_snapshots.sql`.
- Made invoice creation and edits calculate preflight status from the selected
  profile snapshot. Sending recalculates it in the transaction and rejects
  failed checks.
- Made packet, send, status-copy, email-copy, CSV, and print actions use the
  selected invoice rather than the first dashboard invoice.
- Made demo expiry recoverable: the banner and reset control remain visible,
  expired demo status read/write URLs return 404, and API responses are
  `no-store` so an expired dashboard response cannot poison a new demo.
- Fixed invoice-form focus, finance-email validation, Unicode character
  counting, status title/private metadata, the landmark issue, and HSTS.
- Replaced narrow claims with outcome-based browser regressions. They cover
  multiple profiles, snapshots, selected-invoice actions, preflight refusal,
  expiry recovery, real/demo separation, ciphertext storage, tracking,
  accessibility, and rate limits.

## Verification

From a clean documented setup:

- `npm ci` passed with no vulnerabilities.
- `npm test` passed: 7 Rust tests and 14 Chromium tests.
- Every command in `.factory/claims.json` passed separately after `npm ci`.
- `cargo build --release` passed. The release server started with only `PORT`
  set, returned healthy, and did not expose the debug-only expiry fixture.

Local browser coverage includes 390px mobile routes, keyboard focus into the
invoice form, full Axe scans with no violations on those routes, selected CSV
contents, invalid email and Unicode boundaries, headers, and 429 with
`Retry-After`.

Live checks at `https://ap-ready-invoice.sociobot.in`:

- `verify-url.sh` passed: HTTP 200, 561 ms load, correct title/lang, one
  heading and main landmark, alt text, labelled buttons, and no console errors.
- Fresh desktop and 390px phone browsers both showed the job, audience, and
  sample action before scrolling. Neither had horizontal overflow or Axe
  violations.
- A two-invoice demo flow sent, printed, and updated the selected invoice
  while the other invoice stayed unchanged. The public status page had the
  expected invoice-specific title and `noindex, nofollow`.
- A demo record survived an active-revision restart. No real workspace was
  used for that check.
- A 46-request burst from one forwarded test IP produced 40 HTTP 200 responses
  and 6 HTTP 429 responses with `Retry-After: 1`.
- Privacy, terms, pricing, robots, sitemap, and the designed HTTP 404 route
  returned as expected. HSTS is present.
- Lighthouse mobile: Performance 100, Accessibility 100, Best Practices 100,
  SEO 100; FCP 1053 ms, LCP 1653 ms, CLS 0.

## Deployment

The implementation and documentation commits were pushed to `main`. The
container was deployed with:

```bash
WO_DATA_DIR=/data /opt/fleet/lib/deploy-container.sh ap-ready-invoice /work/repo Dockerfile 8080
```

The immutable image is
`sociobotregistry.azurecr.io/sf-ap-ready-invoice@sha256:4838186e7200957fabb2f3553c699ef0b280d0fb7520d3fe4b8b0b1dbe4fcbed`.
The helper preserved the existing product environment, probes, durable
`sf-ap-ready-invoice-data` mount at `/data`, and single-replica bounds.

## Migration note

The legacy schema stored one mutable profile. The migration copies its current
values into a reusable legacy profile and uses those values for existing
invoice snapshots. It cannot reconstruct historic values that the old schema
had already overwritten. New and explicitly edited invoices are snapshot-safe.

## External dependencies and known gaps

- M2 needs Sociobot Entra accounts, actual tenant isolation, account
  export/delete, and the operator's registered $19/month Sociobot
  subscription. M1 does not advertise checkout, paid features, or a price, so
  no billing-offer metadata exists to register.
- Email is prepared for copy; the service does not send email. It does not
  process payments, replace bookkeeping, or impersonate an AP system.
- No service worker or offline/update promise is shipped.
