-- Migration 029 : إلغاء كود دعوة قبل استعماله (Revoke)
--
-- revoked_at منفصل عن used_at عمداً — يفرّق بين "استُعمل فعلاً" و
-- "أُلغي إدارياً قبل ما يُستعمل"، مفيد للتدقيق (audit) لاحقاً.

ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES admins(id) ON DELETE SET NULL;

INSERT INTO permissions (key, module, description) VALUES
  ('invite_codes.revoke', 'invite_codes', 'إلغاء كود دعوة غير مستعمل قبل انتهاء صلاحيته')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'security_admin' AND p.key = 'invite_codes.revoke'
ON CONFLICT DO NOTHING;
