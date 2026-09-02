# Demo sandbox

- URL: `https://ap-ready-invoice.sociobot.in/demo` (local: `http://127.0.0.1:8080/demo`).
- Sample: Mara Vale Studio billing Northstar Systems Ltd for invoice MVS-1042. The client requires a PO, tax identifier, payment instructions, AP email, and billing address.
- First screen: all seven checks pass. The next action is sending the invoice packet.
- Reset: use **Reset demo** in the persistent banner. This creates a fresh server workspace and replaces the browser key.
- Isolation: demo workspaces have random 256-bit keys, `is_demo=1`, and a 24-hour SQLite expiry. The browser key uses `demo:apri:workspace`; real data uses `apri:workspace`. Neither namespace reads the other.
- Verification: tests use a clean browser context, only `/demo`, and the shipped sample. No account or external network is needed.
