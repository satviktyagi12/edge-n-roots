# Edgenroots Formula Engine

Backend technical assignment: a versioned formula engine using Node.js, Express, and MySQL.

## Status

Implementation is being built against the supplied six-page assignment. The design prioritizes insert-only business records, optimistic concurrency, dependency-aware evaluation, explainable results, and automated tests.

## Requirements

- Node.js 20+, Express, MySQL 8+
- Formula evaluation with `formula-interpreter`
- Every business-record change is a new row; business tables are never updated or deleted

## Setup

1. Copy `.env.example` to `.env` and configure MySQL.
2. Run `npm install`.
3. Run `npm run db:setup` to apply SQL schema and views.
4. Run `npm test` and `npm start`.

See the API and design notes below as implementation is completed.
