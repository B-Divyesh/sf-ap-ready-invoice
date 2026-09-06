# M1 repair candidate handoff

## Status

Implementation candidate: `8d395f7e8d49766f0cf579c8bb65b87d58f4b7cd`.

The candidate is deployed in documentation build `4ee00f0`. M1 is not accepted
until an independent verification PASS. The full live evidence is in the
latest handoff.

## What changed

- Replaced the single mutable profile model with reusable `client_profiles`.
  New invoices save the chosen profile fields and requirements as an invoice
  snapshot.
- Made create and update set preflight status from that snapshot. Sending
  rechecks the snapshot in its transaction and refuses a failed packet.
- Made packet, send, copy-link, copy-email, CSV, and print actions resolve the
  selected invoice rather than the first invoice in a dashboard response.
- Made an expired demo keep its sample banner and reset control. Expired demo
  status reads and writes now return 404, and API responses are `no-store` so
  a cached expiry cannot block a fresh demo.
- Fixed form focus, malformed finance-email rejection, Unicode character
  limits, status-page title and private metadata, moderate landmark nesting,
  and HSTS.
- Added outcome-based browser coverage for profile snapshots, selected
  multi-invoice actions, selected CSV data, failed preflight send attempts,
  real/demo separation, actual demo expiry recovery, ciphertext storage,
  tracking requests, mobile accessibility, headers, and rate limiting.

## Local verification

- `npm ci`
- `npm test` — 7 Rust tests and 14 Chromium tests passed.
- `cargo build --release` passed before deployment verification.
- Each command in `.factory/claims.json` is runnable from the documented clean
  setup and starts at `/demo`.

## Migration note

Migration `0002_profile_snapshots.sql` creates `client_profiles` and copies a
legacy workspace profile into it. Existing invoices receive the legacy
profile's current values as their first snapshot. The old single-profile
schema did not retain historical values, so it cannot reconstruct a past
packet that was already overwritten before this migration. New and edited
invoices are snapshot-safe.

## External dependencies and next milestone

- M2 needs Sociobot Entra tenant authentication, real tenant isolation,
  account export/delete, and the operator's registered $19/month Sociobot
  subscription. None is claimed or enabled in M1.
- Email delivery, payment processing, bookkeeping, and AP-system
  impersonation remain out of scope.
