# Edgenroots Formula Engine

Node.js, Express and MySQL backend for the supplied Formula Engine Service assignment.

## Setup
- Node.js 20+ and MySQL 8+.
- Copy `.env.example` to `.env` and configure credentials.
- Run `npm install`, `npm run db:setup`, `npm test`, then `npm start`.
- `GET /health` is the health endpoint.

## API
Successful responses use `{ "data": ... }`; errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`.
- `POST /formulas` create: `{"name":"commission","formula":"return EXTERNAL_VAR.amount * EXTERNAL_VAR.rate / 100","createdBy":"admin"}`
- `POST /formulas` change: include `uuid` and `expectedVersionId`, plus changed fields.
- `POST /formulas/:uuid/deactivate`: `{"expectedVersionId":1,"force":false}`
- `POST /formulas/:uuid/rollback`: `{"expectedVersionId":2,"targetVersionId":1}`
- `GET /formulas`: current active versions.
- `GET /formulas/:uuid/history`: full history, oldest first.
- `GET /formulas/:uuid/impact`: direct and indirect active dependents.
- `POST /formulas/preview`: `{"record":{"amount":2000,"rate":10}}`; optional `formulaUuids` and ISO-8601 `asOf`.
- `POST /formulas/preview/bulk`: `{"records":[{"amount":2000,"rate":10}]}`; max 500 records.

## Design decisions
Every formula change appends a row with the same logical UUID and a new auto-increment id. The highest id is current. Change copies omitted fields; deactivate appends INACTIVE; rollback appends the old values as a new ACTIVE row. No business-table UPDATE or DELETE is used. `sql/views.sql` includes the aggregate-subquery current view and the window-function alternative. The aggregate view is chosen for clarity. Indexes support UUID/latest-version lookup, active formulas and run reports.

Changes require `expectedVersionId`. A MySQL named lock per UUID serializes writers across app processes. After acquiring it, the service checks the latest row; stale requests receive 409 and the current version. The lock is released in a finally block.

Dependencies are inspected from formula text and topologically sorted. Cycles return a path. Each evaluation runs in a child process with a timeout. Run logs share one run UUID and are written using one multi-row INSERT. Bulk preview is capped at 500 records and bounded concurrency is used. All seven SQL reports are in `sql/queries.sql`.

## Insert-only trade-offs (14 lines)
1. Append-only history preserves a complete audit trail.
2. Every version can be reconstructed without mutable audit metadata.
3. Rollback adds a new version and retains intervening changes.
4. The main cost is additional storage for old versions.
5. Indexes grow as the version history grows.
6. A current view centralizes latest-row selection.
7. UUID/id indexes support latest-version reads.
8. Run logs need indexes by formula, status and timestamp.
9. At millions of versions, monitor index size and query plans.
10. Archive or partition run logs by time where retention permits.
11. Keep formula history when auditability requires it.
12. Cache current formulas only with reliable invalidation.
13. Paginate history responses for long-lived formulas.
14. Analyze tables and validate indexes as usage grows.

## Verification status
The GitHub Actions workflow runs the API and integration tests against MySQL 8. It covers formula creation/change, history, historical preview, optimistic concurrency, dependency failures, timeout handling, rounding, and bulk preview. The formula interpreter's actual `interpretor()` API is used.

The 500-record × 10-formula benchmark has taken roughly 106–128 seconds on the standard two-core GitHub-hosted runner, depending on load and timeout settings. CI allows up to 150 seconds for that benchmark; outside CI, the test enforces the assignment's 30-second target. The target-hardware 30-second result must be verified on the laptop intended for submission. Do not treat a green CI run on a slower runner as proof that the 30-second laptop requirement has passed.
