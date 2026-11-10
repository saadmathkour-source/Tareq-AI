# TAREQ Known Limitations

Honest, current limitations. None of these is hidden from the dashboard.

1. **Payment collection is connected (Stripe, live) but the very first real
   customer is still the owner's to win.** Phase 17 wired a public checkout and
   a signature-verified webhook that only records money Stripe confirms. The
   remaining work is demand, not plumbing.
2. **Outbound email needs a provider configured.** Delivery generates and stores
   the artifact regardless, but the buyer email only sends when `EMAIL_PROVIDER`
   (`resend`) or the `GMAIL_*` OAuth set is present. Without it an order lands in
   `EMAIL_FAILED` with the artifact intact and the send retried by the queue.
3. **Sandboxed execution is in-process, not OS-level.** Product building can run
   generated code in an isolated V8 context (no host access, wall-clock timeout,
   JSON-only output) — but that is process isolation, not a container. Hostile
   code is screened statically and confined, yet a kernel-level escape is out of
   scope for this design.
4. **Many commercial engines are analytic, not predictive.** Groups 29-100 are
   deterministic scoring/analysis functions over stored data. They are tested,
   but they are decision aids, not oracles. Predictions are labelled as
   hypotheses, never facts.
5. **Discussion volume is a weak demand proxy.** The public-data connector
   measures interest only and caps confidence at 0.5.
6. **No load testing.** Behaviour under many concurrent workers is unmeasured.
7. **The 100-group list is not proof of 100 production features.**
   The audited register distinguishes production verification from tested code
   and backend-only helpers. Current audited counts are in
   `PHASE1_100_CAPABILITY_REGISTER.md`; production-verified groups remain zero
   until direct deployed evidence is recorded.
8. **Integrations are code-complete but not all live.** Gmail and HubSpot report
   honest configured/unconfigured status and refuse when unconfigured; their live
   connection is blocked on the owner supplying OAuth/token secrets, not on code.
9. **The Supabase connection is pooled with `connection_limit=1` and ~1.2s
   round-trip latency.** Every code path must stay query-frugal. `discovery.ts`
   was rewritten to use `createMany` for this reason (20 rows: 53s -> 6.8s).
   Raising the pool limit on the pooled URL would help all paths; until then,
   avoid `Promise.all` over multiple Prisma queries (it causes P2024 timeouts).
10. **The supervisor runs inside the same process it supervises.** It recovers
    crashed tasks and raises findings, but if the worker process itself is dead
    nothing reclaims it — that needs an external cron/heartbeat monitor. Findings
    are surfaced on the dashboard; they are not yet pushed to an external channel.
11. **Owner-control enforcement is honest about what is wired.** Of the permission
    switches, only `publishingAllowed` and `outreachAllowed` currently have an
    action path; `marketingAllowed`, `financialOpsAllowed`, `maxDiscountPct` and
    `adSpendCapUsd` are declared but not yet enforced anywhere. `setControls`
    refuses to turn an unenforced switch on (so it can never be shown as "on"),
    and `GET /controls` reports the implemented vs not-implemented split. These
    remain no-ops until the code that would enforce them is added.
12. **The owner-login abuse guard is per-process.** `src/lib/security/login-guard.ts`
    bounds password guessing with a fixed-window rate limit and a failure lockout,
    but the counters live in memory. With more than one instance, each holds its
    own counters, so the effective limit is per-instance, not global. A shared
    store (Redis) would make it global; the guard is still a strict improvement
    over an unthrottled login endpoint.
13. **Inquiry email delivery is conditional and not yet proven live.** A submitted
    inquiry is stored and answered from verified product data. Email is sent only
    when the owner has enabled outreach permission and a provider is configured.
    The dashboard exposes inquiry status and whether the provider accepted a
    reply. The latest `main` source adds a delivery lease and retry handling, but
    it requires the additive `reply_claimed_at` database field and a deployment
    before it can be relied on in production. Do not treat email as delivered
    unless `replySentAt` is present.
14. **Commercial activation is owner-gated.** PR #12 added the content owner
    interface and is merged to `main`; current production deployment and public
    article state are unverified. PR #13 tightens product claims and source QA,
    but does not activate publication. No production content permission or
    inquiry email permission was activated in this task. No genuine customer,
    paid order, revenue, or net profit has been verified.
