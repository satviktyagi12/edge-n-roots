USE edgenroots_formula_engine;

-- Alternative implementation of current_formulas using a window function.
-- Apply this file instead of sql/views.sql when choosing the window-function version.
CREATE OR REPLACE VIEW current_formulas AS
SELECT id, uuid, name, formula, status, created_by, first_created_at, inserted_at, base_version_id
FROM (
  SELECT f.*, ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id DESC) AS rn
  FROM formulas f
) ranked
WHERE rn = 1 AND status = 'ACTIVE';