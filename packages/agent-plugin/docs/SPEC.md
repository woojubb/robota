# @robota-sdk/agent-plugin — Package Specification

## Purpose

Owns the official plugin implementations for the Robota SDK: history persistence, logging,
usage/cost tracking, rate limiting, error handling, execution analytics, performance monitoring,
and webhook notifications. Each plugin implements the `IPlugin` interface from `agent-core` and
encapsulates a single cross-cutting concern. This package does not own the plugin host, the event
bus, or any provider or tool infrastructure — those, and hook dispatch on a real turn, belong to
`agent-core`.

## Boundaries / Non-goals

- Depends exclusively on `agent-core`. Must never import from `agent-framework`, `agent-session`,
  or `agent-tools` — those are consumers of this package, not dependencies of it.
- Sub-modules (one per plugin) must not import from each other; each plugin is independently
  tree-shakeable so an unused plugin is excluded from a consumer's bundle.
- Does not perform provider calls or tool execution (owned by `agent-framework`), and does not own
  session/conversation runtime state (owned by `agent-session`).

## Contract Guarantees

- A plugin selecting an unimplemented or misconfigured storage/strategy fails loudly at
  construction with a `ConfigurationError`, rather than silently dropping data. In particular,
  `ConversationHistoryPlugin` configured for database storage without a supplied database driver
  throws at construction instead of accepting writes it cannot persist.
- `PerformancePlugin`'s monitoring-strategy type includes values with no backing implementation
  yet (only the in-memory backend is implemented); selecting one of those is a forward-looking
  configuration surface, not a currently working backend.
- `LimitsPlugin` exposes a rate limiter (tokens/requests/cost) and an orthogonal per-run
  cumulative cost budget, tracked independently and reset independently of each other.
- Storage and rate-limiting behavior is injected via option objects rather than requiring
  subclassing, so a consumer supplies a custom backend without extending plugin internals.
- `WebhookPlugin` signs outgoing payloads (HMAC) using a browser-compatible signing library kept
  isolated to the webhook submodule — no other plugin depends on it.
- `PluginError` and `StorageError` (both owned by `agent-core`) are the errors a consumer should
  expect to catch at the agent execution boundary; a plugin construction-time misconfiguration is
  reported as `ConfigurationError` instead, so a caller can distinguish "fix your config" from
  "something failed at runtime."

## Design Decisions

- **Strategy pattern for storage/rate-limiting.** Injected via option objects rather than
  subclassing, so a custom backend (e.g. a consumer's own database or remote store) is a plain
  implementation of the relevant storage interface, not a subclass of plugin internals.
- **Facade for multi-component plugins.** `WebhookPlugin` and `ErrorHandlingPlugin` coordinate
  several internal collaborators (HTTP client, payload transformer, retry/circuit-breaker state)
  behind one class, so a consumer configures one plugin rather than wiring components together.
- **Periodic-task batching.** History and usage plugins flush via a shared periodic-task helper
  from `agent-core` rather than each implementing its own timer loop.
- **No cross-submodule imports.** Each plugin's storage backends and helpers are private to its
  own directory, keeping a plugin removable (and its dependencies tree-shakeable) without
  auditing what else might reach into it.
