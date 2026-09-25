# LLM Text Node Specification

## Purpose

The collapsed `llm-text` DAG node: AI-powered text generation for **any**
provider in an injected provider-definition registry — superseding the previous per-vendor
`llm-text-<vendor>` nodes and the `llm-text-router`.

## Boundaries

- Depends on `@robota-sdk/agent-core` only — no provider-leaf dependency. The registry of
  `IProviderDefinition`s is supplied by the caller (constructor injection), and provider/credential
  resolution is delegated to agent-core's resolver.
- Reads no `process.env` itself; credential and `$ENV:` resolution live in `agent-core`.
- Does not own provider or agent implementation.

## Contract

- Providers are tried in ascending priority order. A provider with no resolvable credential, an
  unknown provider, or a disallowed model is **skipped**, not failed — the first successful
  provider is used. If every configured provider is skipped, a single validation error is
  returned that lists the skip reasons (never a per-provider error stack).
- Cost estimation is a fast, deterministic function of prompt length and the primary provider's
  token cost (falling back to a flat estimate when the provider's cost is unknown) — it never
  calls the provider to estimate cost.
- The trusted node-context cancellation signal is forwarded to the agent run: an aborted attempt
  starts no new provider, never enters provider fallback, and discards responses returned after
  abort, returning non-retryable `DAG_TASK_EXECUTION_CANCELLED`. Provider transport termination
  still depends on the provider's own cooperation, and node completion waits for the admitted
  provider call to settle even after abort rather than abandoning its cleanup.

## Non-goals

- Real end-to-end calls against live provider APIs are out of scope for this package's own test
  suite (opt-in/out-of-band only); this package proves routing and resolution logic, not provider
  behavior.
