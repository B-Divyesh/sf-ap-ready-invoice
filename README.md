# AP-Ready Invoice

AP-Ready Invoice helps freelancers and small studios hand invoices to corporate finance teams. It checks each client's AP rules before sending, builds a printable invoice packet, shares a status link, and records a receipt trail.

Try the isolated sample at `/demo`. It loads Mara Vale Studio's invoice for Northstar Systems Ltd with realistic PO, tax, bank, and AP requirements.

## What v1 includes

- Reusable client AP profiles for addresses, finance email, PO, tax, and payment rules.
- Seven invoice preflight checks with a named next action.
- A print-ready invoice packet and prepared email copy.
- Unguessable recipient status links for received, change-requested, and approved states.
- Exportable receipt trails in CSV.
- Encrypted tax and bank fields in SQLite.
- A separate demo workspace with a 24-hour expiry and reset control.
- A $19 monthly Pro checkout and license restore flow through Sociobot.

AP-Ready Invoice does not process payments, replace bookkeeping, or impersonate a client's AP system.

## Run locally

Requirements: Node.js 22+, Rust stable, and SQLite development libraries.

```bash
npm install
npm run build
cargo run
```

Open `http://127.0.0.1:8080`. The server uses `PORT`, defaulting to `8080`. It writes SQLite and its generated encryption key to `/data` when that directory exists. Otherwise it uses `./data`. Set `AP_READY_DATA_DIR` only when a local or test path is useful.

For frontend hot reload, run `npm run dev` beside `npm run dev:server`.

## Test

```bash
npm test
```

The command builds the frontend, runs Rust unit tests, starts the full server, and runs Playwright in Chromium. Claim tests are listed in `.factory/claims.json`. Playwright 1.58.2 is pinned.

## Container

```bash
docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t ap-ready-invoice .
docker run --rm -p 8080:8080 -v apri-data:/data ap-ready-invoice
```

The multi-stage image runs as a non-root user. `GET /health` returns the build SHA. The app needs no required environment variables.

## Deploy

The factory builds the root `Dockerfile` and mounts durable product storage at `/data`. Do not deploy infrastructure from this repository. The production origin is `https://ap-ready-invoice.sociobot.in`.

## Privacy and billing

The site loads no third-party fonts or scripts. Invoice data stays in the product's SQLite database. Sensitive fields use ChaCha20-Poly1305 encryption with a generated key persisted beside the database. The checkout and daily license verification call only the Sociobot billing API. See `/privacy` and `/terms` in the app.

## Project notes

- [Design thesis](.factory/design.md)
- [Demo contract](.factory/demo.md)
- [Tested claims](.factory/claims.json)
- [Handoff](.factory/handoff.md)

Licensed under the [MIT License](LICENSE).
