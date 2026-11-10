# TAREQ AI — Phase 2 Frontend Audit

**Scope:** only `tareq/`. Source review plus read-only production page observations. No login, submission, payment, or mutation was performed.

## Route and page inventory

| Surface | Source / route | Data/actions | Live evidence |
|---|---|---|---|
| Owner command dashboard | `src/app/dashboard.html`, `GET /` and `/dashboard` | Authenticated refresh, planning, mission, approvals, tasks, finance, products/orders, controls, watchdog, integrations, leads, research, readiness | Sign-in shell rendered; owner login not attempted |
| Shop | `src/app/storefront.ts`, `GET /shop` | Reads published products | One $149 Market Opportunity Report shown |
| Product/offer | `GET /buy/:slug` | Product description and checkout link | `/buy/market-opportunity-report` rendered |
| Checkout | `GET|POST /checkout/:slug` | Creates checkout session with Stripe adapter | Not submitted; payment integration not verified |
| Contact/inquiry | `GET|POST /contact` | Form POST persists inquiry; server invokes answer handling | Form rendered; no submission made |
| Organic insights | `GET /insights`, `GET /insights/:slug` | Public pages for published, sourced articles | `/insights` said no articles published |
| Download/order status | `/download/:token`, `/orders/status`, `/thanks` | Secure artifact delivery and customer order status | Not exercised; no production order was created |
| Legal/SEO | `/legal/:page`, `/robots.txt`, `/sitemap.xml` | Policy pages and sitemap publication | Prior Phase 0 route checks recorded HTTP 200; not rechecked here |

## Dashboard controls and event bindings

| Visible action | UI handler | API path | Audit result |
|---|---|---|---|
| Sign in / out | `loginBtn`, `logoutBtn` | `/auth/login`, `/auth/logout` | Code wired; login not tested |
| Language / refresh | `langBtn`, `refreshBtn` | Refresh calls 22 endpoints, including `/health`, `/mode`, `/capabilities`, `/tasks`, `/approvals`, `/finance`, `/audit`, `/leads`, `/usage`, `/errors`, `/config`, `/research`, `/integrations`, `/commercial/overview`, `/products`, `/orders`, `/supervisor`, `/controls`, `/optimization`, `/readiness`, `/content`, `/inquiries` | `/content` and `/inquiries` are now included in the authenticated refresh |
| Mode apply | `modeApply` | `POST /mode` | Code wired; no live action |
| Plan / bounded mission | `planBtn`, `missionBtn` | `POST /plan`, `POST /mission` | Code wired; no live action |
| Seed catalog | `seedProductsBtn` | `POST /products/seed` | Code wired; code says seeding remains draft-only |
| Owner order checkout link | delegated click | `POST /orders/checkout` | Code wired; no order/payment created |
| Emergency stop | `stopBtn` | `POST /emergency-stop` | Code wired; UI confirmation and backend gate present |
| Approval / cancel | delegated clicks | `POST /approvals/decide`, `POST /tasks/cancel` | Code wired; owner-only; no live action |
| Watchdog / resolve | `watchdogBtn`, delegated click | `POST /supervisor/run`, `POST /supervisor/resolve` | Code wired; no live action |
| Save control settings | `saveControlsBtn` | `POST /controls` | Code wired; backend refuses to enable controls it cannot enforce |
| Content | `contentDraftBtn`, `data-publish-article` | `GET /content`, `POST /content/draft`, `POST /content/publish` | Owner can request a sourced draft, inspect escaped text/source URLs, and confirm publish; server gates remain authoritative |
| Inquiries | `data-answer-inquiry` | `GET /inquiries`, `POST /inquiries/answer` | Owner can inspect the submitted question and saved answer; processing asks confirmation and may email only when permission and provider are enabled |

## States, authentication, and responsive behavior

- Dashboard has a generic “No records yet” state for several lists, an all-clear state for errors/watchdog, and inline/alert errors for some actions. Refresh uses `Promise.all`, so a single failed owner endpoint rejects the whole refresh; there is no per-section stale/error state or global loading indicator. Mission, watchdog, and seed buttons have individual disabled states; login and refresh lack equivalent progress feedback.
- Owner API routes use bearer sessions in source. The dashboard stores the token in `sessionStorage`, attempts to restore it for the tab, and returns to the login shell if the initial refresh fails. Live anonymous protected endpoints were recorded as 401 in the earlier audit, but this pass did not issue a fresh authenticated or protected-route request.
- The source has viewport metadata, fluid CSS grid (`auto-fill`) and flex wrapping, but no `@media` breakpoint. Wide tables are not wrapped in an explicit horizontal scroll container. Desktop/mobile visual and interaction equivalence is not verified; the live browser inspected only its current viewport.
- No customer UI route is a React app: it is server-rendered HTML. There is no separate navigation router or 20-page owner app.

## Backend paths without owner UI controls

At minimum, the authenticated API paths with no matching dashboard fetch/control remain: `/payments/link`, `/resume`, `/finance/report`, `/products/publish`, `/products/landing`, `POST /orders`, and `/orders/artifact`. Some may be intentionally internal/API-only; their absence from the dashboard means their owner operating workflow is not established.

## First commercial blocker and smallest repair

**P0: organic publishing has no owner operating surface and production contains no articles.** The source has a sourced draft engine, QA gate, permission check, emergency-stop check, and publish endpoint. The schedule only drafts. The dashboard neither loads drafts nor gives the owner a review/publish action. `GET /insights` live confirms there are no published articles. This is stronger evidence than inferring publishing failure from code alone.

**Smallest repair implemented on PR #12:** dashboard now loads `/content` and `/inquiries`; it lists sourced articles for review and confirmation before publish, and provides an owner-only inquiry view with escaped question/answer text and a confirmed action for new inquiries. Server-side permission, source QA, emergency-stop and conditional email controls remain authoritative. The public contact response now accurately distinguishes stored inquiries from delivered email and discloses IP use for abuse prevention. None of this is deployed.

**Remaining acquisition blocker:** email delivery is not verified, and a failed email after an inquiry is marked `ANSWERED` cannot yet be retried. This is documented rather than presented as a working retry path.

## UI audit conclusion

Source-to-UI audit covers route, direct API-call, handler, basic state, and auth mapping. Mobile rendering, owner-only control behavior against current production settings, and authenticated production UI remain unverified because this pass had no owner session or Railway runtime access. Focused regression coverage for content and inquiry controls is recorded in the execution status.
