# TAREQ Known Limitations

Honest, current limitations. None of these is hidden from the dashboard.

1. **No payment provider is connected.** Verified-collection code paths exist and
   are tested, but no real Stripe/alternative account is configured, so no real
   revenue can yet be collected. This is a hard blocker on "first paying
   customer" that requires an owner decision.
2. **No email/CRM connector.** Outreach can be drafted and approved but not sent
   by the agent. Sending needs a provider (Resend/Gmail) that is not configured.
3. **No sandboxed code execution.** Product building produces specs and
   templates; it does not yet compile/run generated code in an isolated sandbox
   (capability 13 is partial for this reason).
4. **Many commercial engines are analytic, not predictive.** Groups 29-100 are
   deterministic scoring/analysis functions over stored data. They are tested,
   but they are decision aids, not oracles. Predictions are labelled as
   hypotheses, never facts.
5. **Discussion volume is a weak demand proxy.** The public-data connector
   measures interest only and caps confidence at 0.5.
6. **No load testing.** Behaviour under many concurrent workers is unmeasured.
7. **The 100-group list is a mapping, not a proof of 100 finished products.**
   Statuses in `src/lib/capabilities/index.ts` reflect code + tests; several are
   `partial`. See `TAREQ_100_FEATURE_MATRIX.md`.
8. **The original detailed specs for groups 1-63 could not be recovered.** Their
   requirements in the matrix are reconstructed from the existing code and
   labelled as such.
9. **The Supabase connection is pooled with `connection_limit=1` and ~1.2s
   round-trip latency.** Every code path must stay query-frugal. `discovery.ts`
   was rewritten to use `createMany` for this reason (20 rows: 53s -> 6.8s).
   Raising the pool limit on the pooled URL would help all paths; until then,
   avoid `Promise.all` over multiple Prisma queries (it causes P2024 timeouts).
10. **GitHub push is blocked by token scope, not by the repository.** The
    fine-grained token needs Repository permissions -> Contents: Read and write.
    Nothing is broken in the code or the repo.
