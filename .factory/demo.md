# Demo sandbox

- URL: `https://ap-ready-invoice.sociobot.in/demo` (local:
  `http://127.0.0.1:8080/demo`).
- Sample: Mara Vale Studio bills Northstar Systems Ltd through invoice
  `MVS-1042`. The client requires a PO, tax identifier, payment instructions,
  AP email, and billing address.
- First screen: all seven preflight checks pass. The next action is to send
  the invoice packet.
- Reset: choose **Reset demo** in the persistent banner. It creates a new
  server workspace and replaces the `demo:apri:workspace` browser key.
- Isolation: demo and real workspaces use separate browser keys and separate
  server workspaces. Resetting or expiring a demo does not change a real
  workspace. The `@claim:demo-isolated` browser test proves that outcome.
- Expiry: a demo expires after 24 hours. Expired demo data is removed, its
  old public status link returns 404, and the banner keeps **Reset demo**
  available so the visitor can start a fresh sample.
- Verification: each claim begins at `/demo` in a clean browser context. The
  debug build has an expiry fixture used only by the test; release builds do
  not expose that route.
