-- Exact row count for every table in the public schema (used by docs/runbooks/restore.md).
--   psql "$DB_URL" -At -F ',' -f scripts/db-row-counts.sql > counts.csv
SELECT table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS row_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
