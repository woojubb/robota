# DAG Builder Specification

## Purpose

Converts a declarative pipeline spec, or a `.dag.json` workflow file, into a fully-wired
`IDagDefinition` — construction only, never execution.

## Contract

- Does not own node manifests: callers supply `INodeManifest[]` to control which node types are
  valid.
- The build capability returns the same typed domain success or validation failure to local callers;
  an HTTP host decides how to present that result.
- Sequential stages wire in order; parallel stages fan out from and back into sequential nodes via
  `defaultOutputPort`/`defaultInputPort` matching, with optional per-stage port overrides.
- `dagDefinitionFromParsedFile` is where the on-disk workflow-file format should be read. The
  execution contract is the domain model (`IDagRuntimeProvider.execute` takes an
  `IDagDefinition`), so import at the edge is the only job the file format has.
- Decoding is pure and synchronous: a caller that also reads a `.dag.robota.json` companion off disk
  performs that IO itself and passes the result in. The companion supplies what the file format
  cannot record (original node ids, retry/cost policies) — without it, an imported workflow's nodes
  are named `node-<n>` because that is genuinely all the file records.

## Non-goals

- Does not execute DAGs.
