# AP-Ready Invoice

AP-Ready Invoice helps freelancers and small studios send invoices that
corporate finance teams can review. Save client AP rules, check a chosen
invoice, prepare its packet, share its status link, and export its receipt
trail.

Try the isolated sample at `/demo`. It opens Mara Vale Studio's invoice for
Northstar Systems Ltd with a PO, tax identifier, payment instructions, and AP
contact details.

## What M1 includes

- Saved client AP profiles for finance email, billing address, and PO, tax,
  and payment rules.
- Invoice-specific preflight checks and a named next action.
- A printable invoice packet and prepared email copy for the selected invoice.
- Recipient status links and a recorded reply.
- Receipt-trail CSV exports for the selected invoice.
- Encryption for bank and tax fields in SQLite.
- A separate 24-hour demo workspace with a reset control.

AP-Ready Invoice does not process payments, replace bookkeeping, send email,
or impersonate a client's AP system. There is no checkout or paid gate in M1
while the external subscription registration remains unavailable.

## Run locally

Requirements: Node.js 22+, Rust stable, and SQLite development libraries.

```bash
npm ci
npm run build
cargo run
```

Open `http://127.0.0.1:8080`. The server uses `PORT`, defaulting to `8080`.
It writes SQLite and its generated encryption key to `/data` when that
directory exists. Otherwise it uses `./data`. Set `AP_READY_DATA_DIR` only
when a local or test path is useful.

For frontend hot reload, run `npm run dev` beside `npm run dev:server`.

## Test

```bash
npm test
npm run lint
```

`npm test` builds the frontend, runs TypeScript, rustfmt, Clippy, Rust unit
tests, and Playwright in Chromium. The outcome-tested public claims and their
commands are in `.factory/claims.json`. Playwright and its Axe adapter use the
pinned 1.58.2 core.

## Container

```bash
docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t ap-ready-invoice .
docker run --rm -p 8080:8080 -v apri-data:/data ap-ready-invoice
```

The multi-stage image runs as a non-root user. `GET /health` returns the build
SHA. The app needs no required environment variables.

## Deploy

The factory builds the root `Dockerfile` and mounts durable product storage at
`/data`. Do not deploy infrastructure from this repository. The production
origin is `https://ap-ready-invoice.sociobot.in`.

## Privacy

The site loads no third-party fonts or scripts. Invoice data stays in the
product SQLite database. Sensitive fields are encrypted with a generated key
persisted beside the database. See `/privacy` and `/terms` in the app.

## Project notes

- [Design thesis](.factory/design.md)
- [Demo contract](.factory/demo.md)
- [Tested claims](.factory/claims.json)
- [M1 handoff](.factory/handoff-m1.md)
- [Latest handoff](.factory/handoff.md)

Licensed under the [MIT License](LICENSE).
