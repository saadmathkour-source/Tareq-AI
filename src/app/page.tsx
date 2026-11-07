const features = [
  {
    title: 'Realtime voice proxy',
    body: 'Route inbound and outbound audio through AI voice profiles with sub-second latency.',
  },
  {
    title: 'AI transcription',
    body: 'Every session is transcribed with OpenAI or DeepSeek and stored against the caller.',
  },
  {
    title: 'Usage billing',
    body: 'Stripe-backed subscriptions and metered usage, synced through webhooks.',
  },
  {
    title: 'Supabase auth',
    body: 'Row-level security, email/password and OAuth sessions out of the box.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-16 px-6 py-20">
      <header className="flex flex-col gap-6">
        <span className="w-fit rounded-full border border-[var(--border)] px-3 py-1 text-xs tracking-wide text-[var(--muted)] uppercase">
          VoiceProxy AI
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          The AI voice proxy platform
        </h1>
        <p className="max-w-2xl text-lg text-[var(--muted)]">
          Proxy calls through AI voices, transcribe them in real time, and bill usage
          automatically. Built on Next.js, Prisma, Supabase, OpenAI and Stripe.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/health"
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Check API health
          </a>
          <a
            href="https://github.com/saadmathkour-source/Tareq-AI"
            className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-medium transition hover:bg-[var(--card)]"
          >
            View on GitHub
          </a>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <article
            key={f.title}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6"
          >
            <h2 className="mb-2 text-lg font-medium">{f.title}</h2>
            <p className="text-sm text-[var(--muted)]">{f.body}</p>
          </article>
        ))}
      </section>

      <footer className="mt-auto border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
        VoiceProxy AI &middot; deployed on Railway
      </footer>
    </main>
  );
}
