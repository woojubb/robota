# DAG Core

The single source of truth for Robota's DAG domain contracts: definition, run and task types, ports,
state machines, decoding and validation. Every other `dag-*` package imports these contracts.

`@robota-sdk/dag-core` defines what the DAG domain looks like, not how it runs: it ships no storage or
queue adapter, no worker loop and no node implementation. Domain operations return `TResult` values
rather than throwing, and state transitions are pure lookups that reject invalid moves.

## Documents

- [SPEC.md](SPEC.md) — the contract: definitions and validation, run and task state, cancellation,
  budgets and bounds, composite child lineage, and host-supplied capabilities.
- [Package README](../README.md) — main exports, a usage example, and a map of all DAG packages.
