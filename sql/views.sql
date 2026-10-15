USE edgenroots_formula_engine;

-- Option A: aggregate subquery. Chosen for clarity and broad MySQL 8 compatibility.
CREATE OR REPLACE VIEW current_formulas AS
SELECT f.*
FROM formulas f
JOIN (
  SELECT uuid, MAX(id) AS current_id
  FROM formulas
  GROUP BY uuid
) latest ON latest.current_id = f.id
WHERE f.status = 'ACTIVE';

-- Option B: equivalent window-function view. Use this instead if preferred.
-- MySQL supports CREATE OR REPLACE VIEW but only one view name can be active:
-- CREATE OR REPLACE VIEW current_formulas AS
-- SELECT id, uuid, name, formula, status, created_by, first_created_at,
--        inserted_at, base_version_id
-- FROM (
--   SELECT f.*, ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id DESC) AS rn
--   FROM formulas f
-- ) ranked
-- WHERE rn = 1 AND status = 'ACTIVE';