# @robota-sdk/agent-plugin — Package Specification

## Purpose

Owns the official plugin implementations for the Robota SDK: history persistence, logging,
usage/cost tracking, rate limiting, error handling, execution analytics, performance monitoring,
and webhook notifications. Each plugin extends `AbstractPlugin` from `agent-core` and encapsulates a
single cross-cutting concern. This package does not own the plugin host, the event
bus, or any provider or tool infrastructure — those, and hook dispatch on a real turn, belong to
`agent-core`.

## Boundaries / Non-goals

- Depends exclusively on `agent-core` among the workspace packages. Must never import from
  `agent-framework`, `agent-session`, or `agent-tools`; no SDK package depends on this one, and the
  dependency runs only toward `agent-core`.
- Sub-modules (one per plugin) must not import from each other; each plugin is independently
  tree-shakeable so an unused plugin is excluded from a consumer's bundle.
- Does not perform provider calls or tool execution (owned by the `agent-core` execution loop), and
  does not own session/conversation runtime state (owned by `agent-session`).

## Contract Guarantees

- A plugin selecting an unimplemented or misconfigured storage/strategy fails loudly at
  construction with a `ConfigurationError`, rather than silently dropping data. In particular,
  `ConversationHistoryPlugin` configured for database storage without a supplied database driver
  throws at construction instead of accepting writes it cannot persist. The same holds for the
  `file` strategies without an injected text-file store, and for `PerformancePlugin` with memory,
  CPU or network monitoring on and no injected metrics collector.
- `PerformancePlugin`'s monitoring-strategy type includes values with no backing implementation
  (only `memory` is implemented); selecting any other throws a `ConfigurationError` at construction
  rather than accepting metrics it cannot keep.
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
- **Host access by injection.** The main entry is platform-neutral, so the file strategies write
  through an injected `IPluginTextFileStore` and performance monitoring reads an injected
  `ISystemMetricsCollector`; the Node implementations are on `./node`. A default that quietly
  reached for the file system or `process` would make the package unusable in a browser or Worker
  and hide that a plugin was persisting data at all.
- **No cross-submodule imports.** Each plugin's storage backends and helpers are private to its
  own directory, keeping a plugin removable (and its dependencies tree-shakeable) without
  auditing what else might reach into it.
