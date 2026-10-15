USE edgenroots_formula_engine;

-- 1. Full version history, oldest first, with logical version number.
SELECT f.*, ROW_NUMBER() OVER (PARTITION BY uuid ORDER BY id) AS version_number
FROM formulas f WHERE f.uuid = ? ORDER BY f.id ASC;

-- 2. Active formulas. Dependency-aware order is computed by the service, not SQL.
SELECT * FROM current_formulas ORDER BY name;

-- 3. Number of versions per logical formula.
SELECT uuid, MAX(name) AS current_name, COUNT(*) AS version_count
FROM formulas GROUP BY uuid ORDER BY current_name;

-- 4. Runs, failures and failure percentage per formula for last seven days.
SELECT formula_uuid, formula_name, COUNT(*) AS total_runs,
       SUM(status = 'FAILED') AS failures,
       ROUND(100.0 * SUM(status = 'FAILED') / NULLIF(COUNT(*), 0), 2) AS failure_percentage
FROM formula_runs WHERE created_at >= NOW() - INTERVAL 7 DAY
GROUP BY formula_uuid, formula_name;

-- 5. Top five most-failing formulas and their most recent error.
WITH failures AS (
  SELECT formula_uuid, formula_name, COUNT(*) AS failure_count
  FROM formula_runs WHERE status = 'FAILED'
  GROUP BY formula_uuid, formula_name
), latest_error AS (
  SELECT formula_uuid, error_message,
         ROW_NUMBER() OVER (PARTITION BY formula_uuid ORDER BY created_at DESC, id DESC) AS rn
  FROM formula_runs WHERE status = 'FAILED'
)
SELECT f.formula_uuid, f.formula_name, f.failure_count, e.error_message
FROM failures f LEFT JOIN latest_error e
  ON e.formula_uuid = f.formula_uuid AND e.rn = 1
ORDER BY f.failure_count DESC LIMIT 5;

-- 6. Formulas deactivated and never reactivated (current status is inactive).
SELECT f.uuid, f.name, f.id AS latest_version_id, f.inserted_at
FROM formulas f
JOIN (SELECT uuid, MAX(id) AS latest_id FROM formulas GROUP BY uuid) latest
  ON latest.latest_id = f.id
WHERE f.status = 'INACTIVE';

-- 7. Time between consecutive versions and average time between changes.
WITH version_times AS (
  SELECT uuid, name, id, inserted_at,
         LAG(inserted_at) OVER (PARTITION BY uuid ORDER BY id) AS previous_inserted_at
  FROM formulas
)
SELECT uuid, name, id, previous_inserted_at, inserted_at,
       TIMESTAMPDIFF(SECOND, previous_inserted_at, inserted_at) AS seconds_since_previous,
       AVG(TIMESTAMPDIFF(SECOND, previous_inserted_at, inserted_at))
         OVER (PARTITION BY uuid) AS average_seconds_between_changes
FROM version_times ORDER BY uuid, id;