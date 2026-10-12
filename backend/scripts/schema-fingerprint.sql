-- One line per column, constraint, index, sequence, function and trigger in the
-- public and audit schemas, sorted, so two databases can be compared with diff.
-- NOT NULL constraints are listed with their columns (PostgreSQL 18 also
-- stores them as constraints).
SELECT 'col ' || n.nspname || '.' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname IN ('public', 'audit') AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped AND c.relname <> 'schema_migrations'
UNION ALL SELECT 'con ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE contype <> 'n' AND connamespace IN ('public'::regnamespace, 'audit'::regnamespace) AND conrelid::regclass::text <> 'schema_migrations'
UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname IN ('public', 'audit') AND tablename <> 'schema_migrations'
UNION ALL SELECT 'seq ' || sequencename FROM pg_sequences WHERE schemaname IN ('public', 'audit')
UNION ALL SELECT 'fn ' || pronamespace::regnamespace || '.' || proname || '(' || pg_get_function_identity_arguments(oid) || ')' FROM pg_proc p WHERE pronamespace IN ('public'::regnamespace, 'audit'::regnamespace) AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = p.oid AND dep.deptype = 'e')
UNION ALL SELECT 'trg ' || tgrelid::regclass || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
ORDER BY 1;
