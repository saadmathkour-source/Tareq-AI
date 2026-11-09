#!/usr/bin/env bash
# Provision / sync the ISOLATED test database used by `npm test`.
#
# DB-writing integration tests (orders, ledger, queue, stripe webhook) run with
# TAREQ_USE_TEST_DB=1 and connect to TEST_DATABASE_URL instead of the production
# DATABASE_URL, so a test can never write into production financial tables.
#
# Prerequisites (one-time), set in .env (git-ignored, never committed):
#   TEST_DATABASE_URL / TEST_DIRECT_URL  - same Supabase project, database
#                                          `tareq_test` instead of `postgres`.
# The database itself must exist once:
#   psql "$DIRECT_URL" -c 'CREATE DATABASE tareq_test'   (or the SQL editor)
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f .env ] && . ./.env
set +a

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required (see .env.example)}"
: "${TEST_DIRECT_URL:?TEST_DIRECT_URL is required (see .env.example)}"

if [ "$TEST_DATABASE_URL" = "${DATABASE_URL:-}" ]; then
  echo "refusing: TEST_DATABASE_URL equals DATABASE_URL" >&2
  exit 1
fi

echo "syncing schema into the isolated test database..."
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" npx prisma db push --skip-generate

echo "seeding the isolated test database (products, budget, owner, schedules)..."
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DIRECT_URL" node --experimental-strip-types scripts/bootstrap.ts

echo "done."
