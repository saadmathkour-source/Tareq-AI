# TAREQ AI — COMPLETE SOURCE, UI, INTEGRATION & PRODUCTION INVENTORY

**Scope:** only `tareq/` in `saadmathkour-source/Tareq-AI`. The repository root also contains unrelated application material; it was not inspected or changed beyond identifying the TAREQ boundary.

**Read-only production audit:** no production mutation, login attempt, form submission, payment, email, DB write, merge, or deployment was made.
**Audit time:** 2026-11-10 UTC. Production observations below include the timestamp returned by `/health`.

## 1. Source and repository state

- GitHub repository: `saadmathkour-source/Tareq-AI`; default branch `main`; public repo. Latest `main` commit: `bca738c426482de22b16e86915685b87a299b356` (`feat(tareq): Phase 19 — organic publishing + inbound inquiry (lawful acquisition)`).
- Production `/health` reports the same build commit `bca738c426482de22b16e86915685b87a299b356`.
- Open draft PRs: #10 (`Security: remove TAREQ auth bypass and protect exposed API routes`) and #11 (`Fix inquiry reply stop guard and delivery retries`). Neither was merged as of this audit. PR #10's own description says build/tests were not run. PR #11's description reports typecheck/build and 299/299 tests passing against isolated local PostgreSQL; it also requires the additive `reply_claimed_at` column before deployment.
- Local checkout: `fix/inquiry-emergency-stop-retries`, clean working tree, `HEAD=963b951c1a6bb8cf8e9dc4975097e4cffa216443`. This contains the PR #11 inquiry/schema/tests work plus a local dashboard health-probe adjustment. That last dashboard commit is **not** on remote PR #11. Do not treat the local head as deployed or pushed.
- TAREQ application root is verified as `tareq/`. It is a private Node.js ESM TypeScript service (Node >=20.9, Prisma 6/PostgreSQL); package manager is npm (`package-lock.json`). It is not a Vite/React frontend. It serves a hand-built HTML dashboard and public storefront through one Node HTTP API.
- Entry points: `tareq/src/app/server.ts` (HTTP API + routes + static views); `tareq/src/app/dashboard.html` (owner control UI); `tareq/src/app/storefront.ts` (public shop, product, contact, legal, insights and checkout pages); `tareq/worker/main.ts` (worker process); `tareq/src/lib/core/orchestrator.ts` (task execution loop); `tareq/src/lib/queue/scheduler.ts` (cron scheduler).
- Database: PostgreSQL, Prisma schema namespace `tareq`, 33 models in `tareq/prisma/schema.prisma`. There is no checked-in Prisma migrations directory; only the schema is present. Deployment/schema application therefore needs the existing approved Railway process. PR #11 adds a nullable inquiry lease field and must not be deployed until schema compatibility is deliberately handled.
- CI/tests: 25 `*.test.ts` files under `tareq/tests/`. Historical main-branch record states 290/290 tests and typecheck passed; PR #11 reports 299/299 plus typecheck/build. These are source/test results, not proof of production operation. This audit did not rerun the suite.

## 2. Complete TAREQ source tree

The exhaustive application-root file listing is in [`TAREQ_EXECUTION_STATUS.md`](../TAREQ_EXECUTION_STATUS.md). The following lists the source modules that make up the app:

- `tareq/src/app/dashboard.html`
- `tareq/src/app/server.ts`
- `tareq/src/app/storefront.ts`
- `tareq/src/lib/capabilities/engines.ts`
- `tareq/src/lib/capabilities/index.ts`
- `tareq/src/lib/commercial/checkout.ts`
- `tareq/src/lib/commercial/decision-engine.ts`
- `tareq/src/lib/commercial/delivery.ts`
- `tareq/src/lib/commercial/engines.ts`
- `tareq/src/lib/commercial/inquiries.ts`
- `tareq/src/lib/commercial/landing.ts`
- `tareq/src/lib/commercial/mission.ts`
- `tareq/src/lib/commercial/optimization.ts`
- `tareq/src/lib/commercial/orders.ts`
- `tareq/src/lib/commercial/overview.ts`
- `tareq/src/lib/commercial/products.ts`
- `tareq/src/lib/commercial/publishing.ts`
- `tareq/src/lib/commercial/types.ts`
- `tareq/src/lib/core/audit.ts`
- `tareq/src/lib/core/db.ts`
- `tareq/src/lib/core/errors.ts`
- `tareq/src/lib/core/events.ts`
- `tareq/src/lib/core/handlers.ts`
- `tareq/src/lib/core/logger.ts`
- `tareq/src/lib/core/orchestrator.ts`
- `tareq/src/lib/core/subagents.ts`
- `tareq/src/lib/core/supervisor.ts`
- `tareq/src/lib/core/worker-boot.ts`
- `tareq/src/lib/env.ts`
- `tareq/src/lib/finance/ledger.ts`
- `tareq/src/lib/finance/report.ts`
- `tareq/src/lib/integrations/buyers.ts`
- `tareq/src/lib/integrations/email.ts`
- `tareq/src/lib/integrations/gmail.ts`
- `tareq/src/lib/integrations/hubspot.ts`
- `tareq/src/lib/integrations/publicdata.ts`
- `tareq/src/lib/integrations/stripe.ts`
- `tareq/src/lib/integrations/telegram.ts`
- `tareq/src/lib/memory/evidence.ts`
- `tareq/src/lib/memory/index.ts`
- `tareq/src/lib/observability/health.ts`
- `tareq/src/lib/planner/index.ts`
- `tareq/src/lib/planner/intent.ts`
- `tareq/src/lib/providers/index.ts`
- `tareq/src/lib/providers/router.ts`
- `tareq/src/lib/queue/scheduler.ts`
- `tareq/src/lib/queue/tasks.ts`
- `tareq/src/lib/sales/discovery.ts`
- `tareq/src/lib/sales/leads.ts`
- `tareq/src/lib/sales/outreach.ts`
- `tareq/src/lib/sandbox/exec.ts`
- `tareq/src/lib/sandbox/persist.ts`
- `tareq/src/lib/security/budget.ts`
- `tareq/src/lib/security/controls.ts`
- `tareq/src/lib/security/login-guard.ts`
- `tareq/src/lib/security/owner-auth.ts`
- `tareq/src/lib/security/permissions.ts`
- `tareq/src/lib/security/rate-limit.ts`
- `tareq/src/lib/tools/index.ts`
- `tareq/src/lib/tools/registry.ts`
- `tareq/src/lib/tools/research.ts`

## 3. Backend route inventory

Every route below is registered in `src/app/server.ts`. `owner-only` means the dispatch checks an authenticated owner session; public pages/webhook are separately identified. This is source evidence only; protected production actions were not exercised.

- `GET /health` — public
- `GET /api/health` — public
- `POST /auth/login` — public
- `POST /auth/logout` — owner-only
- `POST /auth/revoke-all` — owner-only
- `GET /mode` — owner-only
- `POST /mode` — owner-only
- `GET /capabilities` — owner-only
- `GET /integrations` — owner-only
- `GET /tasks` — owner-only
- `POST /tasks/cancel` — owner-only
- `GET /approvals` — owner-only
- `POST /approvals/decide` — owner-only
- `GET /finance` — owner-only
- `GET /usage` — owner-only
- `GET /leads` — owner-only
- `GET /errors` — owner-only
- `GET /config` — owner-only
- `GET /research` — owner-only
- `GET /audit` — owner-only
- `POST /emergency-stop` — owner-only
- `POST /resume` — owner-only
- `POST /plan` — owner-only
- `POST /mission` — owner-only
- `POST /payments/link` — owner-only
- `GET /commercial/overview` — owner-only
- `GET /supervisor` — owner-only
- `POST /supervisor/run` — owner-only
- `POST /supervisor/resolve` — owner-only
- `GET /controls` — owner-only
- `POST /controls` — owner-only
- `GET /optimization` — owner-only
- `GET /readiness` — owner-only
- `GET /finance/report` — owner-only
- `GET /products` — owner-only
- `POST /products/seed` — owner-only
- `POST /products/publish` — owner-only
- `POST /products/landing` — owner-only
- `GET /content` — owner-only
- `POST /content/draft` — owner-only
- `POST /content/publish` — owner-only
- `GET /inquiries` — owner-only
- `POST /inquiries/answer` — owner-only
- `GET /orders` — owner-only
- `POST /orders` — owner-only
- `POST /orders/checkout` — owner-only
- `GET /orders/artifact` — owner-only

Additional public page branches in the server: `GET /`, `GET /dashboard`, `GET /shop`, `GET /buy/:slug`, `GET|POST /checkout/:slug`, `GET /download/:token`, `GET /orders/status`, `GET /thanks`, `GET /legal/:page`, `GET /robots.txt`, `GET /sitemap.xml`, `GET /insights`, `GET /insights/:slug`, `GET|POST /contact`. `POST /webhooks/stripe` is the Stripe webhook route.

## 4. UI and route/component inventory

The owner UI is a single, long, responsive HTML dashboard served from `/` (the `dashboard.html` asset), with login, language toggle, refresh, emergency stop, executive overview, operating mode, command planner, bounded mission runner, approvals, tasks, finance/budget, products/orders, capability table, integrations, leads, research, usage/cost, errors, config, supervisor/watchdog, autonomy controls and readiness/optimization sections. There is no React router or separate client application in `tareq/`.

Static event bindings are present for sign-in/sign-out, language, refresh, mode apply, plan, mission, seed catalog, checkout-link generation for eligible owner orders, emergency stop, approval decision, task cancellation, watchdog run, finding resolution, and control save. Dynamic approval/cancel/checkout buttons use delegated handlers. These bindings establish code presence only; complete production execution was not tested.

The dashboard currently requests 31 owner API paths during refresh and user actions (see source). The source UI does **not** request `/content` or `/inquiries`, and has no owner controls to draft/publish content or inspect/respond to inbound inquiries, despite backend APIs existing. It also has no live visitor/indexing/organic conversion metrics in the visible dashboard. This is a source gap, not a production guess.

Public production UI observed in the live browser:
- `/` renders the owner sign-in shell and labels it owner-only; login credentials were not available and no attempt was made.
- `/shop` shows one product, Market Opportunity Report, $149 USD.
- `/buy/market-opportunity-report` shows the service, scope, limitations and a Stripe checkout link.
- `/contact` exposes email/name/service/question fields and a send button; no test submission was made.
- `/insights` explicitly says no articles are published yet.

## 5. Worker and scheduler

- `worker/main.ts` bootstraps the worker and runs `orchestrator.run()` with default concurrency `1`, polling every 2 seconds; `TAREQ_WORKER_CONCURRENCY` can override it.
- `scheduler.ts` declares 7 schedules, including watchdog every 10 minutes and `content.weekly` on Mondays/Thursdays at 09:00 UTC. `content.weekly` drafts articles only; publication remains permission-gated.
- Health reports `workerConcurrency: 1`, but that is configured/build metadata, not proof a distinct worker process or scheduler is currently running. No Railway worker logs/service state was available.

## 6. Database and integration inventory

- Database connectivity: live `/health` returned `checks.database.ok=true` at `2026-11-10T16:52:50.995Z`.
- Health's environment summary returned `openai:true`, `deepseek:true`, `owner:true`. These are presence/health indicators returned by the app; they do not reveal values. No credentials were printed or requested.
- The repo `.env.example` lists: `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `TAREQ_OWNER_EMAIL`, `TAREQ_OWNER_PASSWORD`, `TAREQ_SESSION_SECRET`, `TAREQ_AUTH_BYPASS`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `TAREQ_DEFAULT_PROVIDER`, `TAREQ_EMBEDDED_WORKER`, `TAREQ_BUDGET_CAP_USD`, `TAREQ_BUDGET_WARN_USD`, `TAREQ_PUBLIC_URL`, `TAREQ_DOWNLOAD_TTL_HOURS`, `TAREQ_CHECKOUT_RATE_LIMIT`, `TAREQ_CHECKOUT_RATE_WINDOW_MS`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`, `HUBSPOT_PRIVATE_APP_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_ID`. This is a variable-name inventory only; `.env.example` is not proof of production values.
- Current status: DB / OpenAI / DeepSeek / owner configuration are indicated present by live health. Stripe LIVE credentials/webhook, email delivery (Resend/Gmail), Telegram, HubSpot, and separate worker configuration are **unknown/unverified** because neither Railway environment metadata nor owner-only integration status was accessible. `EMAIL_PROVIDER` is optional in source; HubSpot is optional. Source docs `INTEGRATIONS.md` call Stripe/email planned, but that section is stale against the current source (Stripe and email modules/routes are present); do not use that old doc as a live integration result.
- Source integrations: Stripe checkout + signature-verified webhook; email adapter (Resend/Gmail); Telegram owner channel; optional HubSpot; keyless public-data sources (Hacker News Algolia/Wikipedia); OpenAI/DeepSeek model router. Live connectivity is not inferred from adapter existence.

## 7. Production checks (read-only)

| Check | Observed result | Evidence class |
|---|---|---|
| `GET /health` | HTTP 200; `ok=true`; DB true; OpenAI/DeepSeek/owner presence true; build SHA matches `main`; concurrency reports 1 | Direct live response |
| Owner UI `/` | Sign-in shell rendered; login not attempted | Direct live browser observation |
| `/shop` | Product page and $149 offer rendered | Direct live browser observation |
| `/buy/market-opportunity-report` | Sales page, offer details and checkout link rendered | Direct live browser observation |
| `/contact` | Inbound form rendered; not submitted | Direct live browser observation |
| `/insights` | Explicitly no articles published | Direct live browser observation |
| Protected owner data/action APIs | Not tested in this browser session; previous audit recorded anonymous 401s for `/tasks`, `/controls`, `/content`, `/inquiries`, `/finance`, `/supervisor` | Prior direct audit; not a fresh check in this pass |
| Worker/scheduler execution | Unknown | No Railway runtime/log access |
| Stripe webhook delivery, successful payment, order, fulfillment, delivery | Unknown; no payment created | No production transaction performed |
| Actual inquiries, customer replies delivered, visitors, indexing, orders, revenue, costs, net profit | Not verified in current accessible evidence; no genuine sale verified | No owner DB/analytics access; no fabrication |

## 8. Current blockers from Phase 0

1. **No organic acquisition has yet been demonstrated:** the production Insights page has zero published articles. The scheduler only creates drafts. Publication is owner-permission-gated, and the current owner dashboard has no content/publishing surface.
2. **Inbound inquiry automation is not operable from the owner UI:** contact form exists publicly and backend owner inquiry routes exist, but dashboard has no inquiry list/answer actions; live email delivery is unverified.
3. **Commercial outcome evidence is absent:** the $149 offer is displayed, but there is no verified real customer, paid LIVE order, delivery, revenue or net profit in accessible production evidence.
4. **Key runtime configuration is not auditable here:** no Railway connector is available; current Stripe/email/worker settings and logs cannot be verified without owner-only access.

Phase 0 does not authorize or perform production changes. The single commercial blocker will be ranked after the ordered 100-capability and full UI inventory are complete. Current strongest source/live signal is the absence of published acquisition content and missing owner UI controls to publish it.

## 9. Reference paths

- API/UI entry: `src/app/server.ts`, `src/app/dashboard.html`, `src/app/storefront.ts`
- Worker/scheduler: `worker/main.ts`, `src/lib/core/orchestrator.ts`, `src/lib/queue/scheduler.ts`, `src/lib/core/handlers.ts`
- Product/sales: `src/lib/commercial/products.ts`, `landing.ts`, `checkout.ts`, `orders.ts`, `delivery.ts`
- Organic and inbound: `src/lib/commercial/publishing.ts`, `src/lib/commercial/inquiries.ts`
- Stripe/email: `src/lib/integrations/stripe.ts`, `src/lib/integrations/email.ts`, `src/lib/integrations/gmail.ts`
- Safety/finance: `src/lib/security/controls.ts`, `permissions.ts`, `budget.ts`, `src/lib/finance/ledger.ts`, `report.ts`
- Database: `prisma/schema.prisma`
