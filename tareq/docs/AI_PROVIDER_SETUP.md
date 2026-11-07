# AI Provider Setup

TAREQ routes model calls through a provider-independent layer
(`src/lib/providers/`). Two providers are supported: OpenAI and DeepSeek.

## Configuration

Set in the environment (never in the repo):

- `OPENAI_API_KEY` — OpenAI key.
- `DEEPSEEK_API_KEY` — DeepSeek key.
- `TAREQ_DEFAULT_PROVIDER` — `openai` (default) or `deepseek`.

A provider that is not configured is skipped, not treated as an error.

## Routing

- `chat(provider, req)` — direct call, records tokens, cost and latency.
- `routeChat(preferred, req)` — tries the preferred provider, then the other
  configured one; non-retryable 4xx errors stop the fallback immediately.
- `probe(provider)` — lightweight reachability check used by `/health?deep=1`.

Model defaults favour cost: `gpt-4o-mini` for OpenAI, `deepseek-chat` for
DeepSeek. Pricing lives in `src/lib/providers/index.ts` and must be updated when
vendors change prices.

## Verification (measured 2026-11-07)

A real call to each provider returned content, token counts and cost:

```
openai:   content="OK" model=gpt-4o-mini-2024-07-18 in=14 out=1 cost=$0.0000027 latency=664ms
deepseek: content="OK" model=deepseek-flash          in=11 out=1 cost=$0.0000041 latency=611ms
```

A configured key alone is not proof; a successful probe is not proof of agent
execution. The end-to-end acceptance test exercises a full workflow.

## Cost control

Every call's cost is recorded. Spend passes through the budget gate
(`assertCanSpend`), so the hard cap cannot be crossed. Simple tasks use the
cheap default model; complex reasoning can request a stronger one explicitly.
