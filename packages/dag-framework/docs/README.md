# DAG Framework

Embeddable in-process composition of the DAG engine: one `createDagFramework()` call wires the
runtime, worker, local adapters and a node catalog. It also provides local and HTTP runtime providers.

The CLI's `/workflows` command runs workflows through this package's `LocalDagRuntimeProvider`, and
`apps/dag-runtime-server` serves a `createDagFramework()` instance over HTTP. The framework exposes
domain capabilities without HTTP envelopes, owns a single run advancement actor per queue, and never
exposes the raw worker loop. It does not ship the default node catalog itself: that lives in
`@robota-sdk/dag-nodes-default`, which the framework loads lazily only when the caller passes no
`nodes`.

## Documents

- [SPEC.md](SPEC.md) — the contract: composition and lifecycle, cancellation, budgets and bounds,
  and local regex isolation.
- [Package README](../README.md) — main exports, key options and usage examples.
