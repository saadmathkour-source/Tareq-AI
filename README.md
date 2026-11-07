# VoiceProxy AI

AI voice proxy platform. Route calls through AI voice profiles, transcribe them in
real time, and bill usage automatically.

Built with **Next.js (App Router) · TypeScript · Prisma · Supabase · OpenAI/DeepSeek · Stripe**,
ready to deploy on **Railway**.

## Stack

| Layer      | Technology                                  |
| ---------- | ------------------------------------------- |
| Framework  | Next.js 16 (App Router, React 19)           |
| Language   | TypeScript 5.9                              |
| Database   | PostgreSQL (Supabase) via Prisma 6          |
| Auth       | Supabase Auth (`@supabase/ssr`)             |
| AI         | OpenAI SDK (OpenAI + DeepSeek compatible)   |
| Billing    | Stripe subscriptions + webhooks             |
| Styling    | Tailwind CSS 4                              |

## Getting started

```bash
cp .env.example .env      # then fill in the values
npm install               # installs deps and runs `prisma generate`
npm run db:push           # push the Prisma schema to Supabase
npm run dev               # http://localhost:3000
```

## Environment variables

All variables are documented in [`.env.example`](./.env.example). Required at runtime:

- `DATABASE_URL` – Supabase **pooled** connection (port `6543`, `pgbouncer=true`)
- `DIRECT_URL` – Supabase **direct** connection (port `5432`), used by Prisma migrations
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY` (and optionally `DEEPSEEK_API_KEY`)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

> **Supabase connection string gotcha.** The Postgres user must be
> `postgres.<PROJECT_REF>`, where `<PROJECT_REF>` is the exact project ref
> (find it in the Supabase dashboard URL, or `SUPABASE_URL` host). A truncated or
> mistyped ref fails with `FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found`.

## API routes

| Method | Route                   | Purpose                                  |
| ------ | ----------------------- | ---------------------------------------- |
| `GET`  | `/api/health`           | Liveness + DB/env dependency probe       |
| `POST` | `/api/chat`             | Chat completion via OpenAI or DeepSeek   |
| `GET`  | `/api/voices`           | List voice profiles                      |
| `POST` | `/api/voices`           | Create a voice profile                   |
| `POST` | `/api/stripe/checkout`  | Create a Stripe Checkout session         |
| `POST` | `/api/stripe/webhook`   | Verify + persist Stripe webhook events   |

## Data model

`User` → `VoiceProfile` → `VoiceSession`, plus `Subscription`, `ApiKey` and `EventLog`.
See [`prisma/schema.prisma`](./prisma/schema.prisma).

## Scripts

| Script              | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start the dev server                 |
| `npm run build`     | `prisma generate` + `next build`     |
| `npm run start`     | Start the production server          |
| `npm run db:push`   | Push the schema to the database      |
| `npm run db:studio` | Open Prisma Studio                   |
| `npm run lint`      | Run ESLint                           |
| `npm run typecheck` | Run `tsc --noEmit`                   |

## Deploy on Railway

1. Create a Railway project from this repository.
2. Add the variables from `.env.example` in the Railway **Variables** tab.
3. Railway runs `npm install` (which triggers `prisma generate`) and then
   `npm run build`; set the start command to `npm run start`.
4. Railway injects `PORT`; `next start` binds to it automatically.

Expose the health check at `/api/health` for Railway monitoring.
