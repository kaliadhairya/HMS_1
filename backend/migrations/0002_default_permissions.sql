-- 0002: the default role permission matrix.
--
-- Every install needs it: checkPermission() denies any module a role has no
-- row for. It used to be created only by the demo seed. Inserted only into an
-- empty table, so permissions an administrator has edited are kept.
INSERT INTO HMS_PERMISSIONS (ROLE, MODULE, CAN_READ, CAN_WRITE, CAN_EDIT, CAN_DELETE)
SELECT v.role, v.module, v.cr, v.cw, v.ce, v.cd
FROM (
  SELECT r AS role, m AS module, 'Y' AS cr, 'Y' AS cw, 'Y' AS ce, 'Y' AS cd
  FROM unnest(ARRAY['super_admin', 'admin']) AS r,
       unnest(ARRAY['auth', 'dashboard', 'patient', 'consultation', 'lab', 'pharmacy', 'ipd', 'billing', 'reports', 'admin']) AS m
  UNION ALL
  SELECT * FROM (VALUES
    ('doctor', 'auth', 'Y', 'Y', 'Y', 'N'), ('doctor', 'dashboard', 'Y', 'N', 'N', 'N'),
    ('doctor', 'patient', 'Y', 'N', 'N', 'N'), ('doctor', 'consultation', 'Y', 'Y', 'Y', 'N'),
    ('doctor', 'lab', 'Y', 'N', 'N', 'N'), ('doctor', 'ipd', 'Y', 'Y', 'Y', 'N'),
    ('lab_technician', 'auth', 'Y', 'Y', 'Y', 'N'), ('lab_technician', 'dashboard', 'Y', 'N', 'N', 'N'),
    ('lab_technician', 'lab', 'Y', 'Y', 'Y', 'N'),
    ('receptionist', 'auth', 'Y', 'Y', 'Y', 'N'), ('receptionist', 'dashboard', 'Y', 'N', 'N', 'N'),
    ('receptionist', 'patient', 'Y', 'Y', 'Y', 'N'), ('receptionist', 'billing', 'Y', 'Y', 'N', 'N'),
    ('pharmacist', 'auth', 'Y', 'Y', 'Y', 'N'), ('pharmacist', 'dashboard', 'Y', 'N', 'N', 'N'),
    ('pharmacist', 'pharmacy', 'Y', 'Y', 'Y', 'N'), ('pharmacist', 'billing', 'Y', 'Y', 'N', 'N'),
    ('nurse', 'auth', 'Y', 'Y', 'Y', 'N'), ('nurse', 'dashboard', 'Y', 'N', 'N', 'N'),
    ('nurse', 'ipd', 'Y', 'Y', 'Y', 'N'), ('nurse', 'patient', 'Y', 'N', 'N', 'N')
  ) AS specific(role, module, cr, cw, ce, cd)
) v
WHERE NOT EXISTS (SELECT 1 FROM HMS_PERMISSIONS);
