# TAREQ Integrations

Every integration is optional and fails closed. Disconnecting all of them leaves
TAREQ fully operational.

## Public data (built in, no key, no cost)

`src/lib/integrations/publicdata.ts` collects demand *signals* from keyless
public endpoints:

- Hacker News (Algolia) search — discussion volume, recency, engagement.
- Wikipedia REST summary — public background facts.

Output is recorded as a hypothesis, never as proof of demand. Confidence is
capped at 0.5 and the interpretation always states that interest is not
willingness to pay.

## Telegram (optional remote control)

`src/lib/integrations/telegram.ts`. Enable with `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_OWNER_ID`. Commands: `/status /tasks /opportunities /revenue /costs
/approvals /pause /resume /stop /help`. Only the configured owner id is accepted.
Sensitive actions require confirmation and go through the same approval engine.

## Database

PostgreSQL via `DATABASE_URL` (and `DIRECT_URL` for migrations). Required.

## Hosting

`railway.toml` builds with `npm run build` and starts the API with `npm run api`,
health-checking `/health`. The worker runs as a separate process/service with
`npm run worker`.

## Planned (not implemented)

- Email delivery (Resend/Gmail) for approved outreach.
- A payment provider (Stripe or a regionally supported alternative) for verified
  collections.

Neither is required for the agent to run. Do not activate a paid service without
owner approval.
