# DAG Projection

Read models for DAG runs: run status summaries, lineage graphs with task status, and dashboard
projections, built from storage by `ProjectionReadModelService`.

`@robota-sdk/dag-projection` is read-only and depends only on `@robota-sdk/dag-core`. Every
projection field comes from explicitly stored data, never from inferred status. It does not depend on
`dag-api`; its service matches `dag-api`'s observability reader port structurally, and composition
roots wire the two together.

## Documents

- [SPEC.md](SPEC.md) — purpose, boundaries, the deterministic-projection contract and design
  decisions.
- [Package README](../README.md) — main exports and a usage example.
