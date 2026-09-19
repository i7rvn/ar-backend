-- ═══════════════════════════════════════════════════════════════
-- Migration 026 : صلاحيات أكواد دعوة المغتربين
-- ═══════════════════════════════════════════════════════════════

INSERT INTO permissions (key, module, description) VALUES
  ('invite_codes.create', 'invite_codes', 'توليد كود دعوة لإعفاء مستخدم مغترب من فحص VPN/الموقع الجغرافي'),
  ('invite_codes.view', 'invite_codes', 'عرض قائمة أكواد الدعوة المستعملة وغير المستعملة')
ON CONFLICT (key) DO NOTHING;

-- security_admin يقدر يولّد أكواد الدعوة (قرار أمني/منتج حساس، مناسب لدوره)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'security_admin' AND p.key IN ('invite_codes.create', 'invite_codes.view')
ON CONFLICT DO NOTHING;
