-- A profile is reusable for future invoices. Each invoice carries the exact
-- profile fields used for its preflight and packet, so a later profile edit
-- cannot change a historical handoff.
CREATE TABLE IF NOT EXISTS client_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  freelancer_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  ap_email TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  po_required INTEGER NOT NULL DEFAULT 0,
  tax_required INTEGER NOT NULL DEFAULT 0,
  bank_required INTEGER NOT NULL DEFAULT 1,
  escalation_days INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_client_profiles_workspace
  ON client_profiles(workspace_id, created_at);

-- Preserve existing workspaces during the migration. Their current legacy
-- profile becomes one reusable profile and the best available snapshot for
-- every existing invoice. New invoices never read this legacy table.
INSERT OR IGNORE INTO client_profiles(
  id, workspace_id, freelancer_name, company_name, ap_email, billing_address,
  po_required, tax_required, bank_required, escalation_days
)
SELECT
  workspace_id || '-legacy', workspace_id, freelancer_name, company_name,
  ap_email, billing_address, po_required, tax_required, bank_required,
  escalation_days
FROM profiles;

ALTER TABLE invoices ADD COLUMN profile_id TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN snapshot_freelancer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN snapshot_company_name TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN snapshot_ap_email TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN snapshot_billing_address TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN snapshot_po_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN snapshot_tax_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN snapshot_bank_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN snapshot_escalation_days INTEGER NOT NULL DEFAULT 5;

UPDATE invoices
SET
  profile_id = workspace_id || '-legacy',
  snapshot_freelancer_name = COALESCE((SELECT freelancer_name FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), ''),
  snapshot_company_name = COALESCE((SELECT company_name FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), ''),
  snapshot_ap_email = COALESCE((SELECT ap_email FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), ''),
  snapshot_billing_address = COALESCE((SELECT billing_address FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), ''),
  snapshot_po_required = COALESCE((SELECT po_required FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), 0),
  snapshot_tax_required = COALESCE((SELECT tax_required FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), 0),
  snapshot_bank_required = COALESCE((SELECT bank_required FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), 1),
  snapshot_escalation_days = COALESCE((SELECT escalation_days FROM profiles WHERE profiles.workspace_id = invoices.workspace_id), 5)
WHERE profile_id = '';
