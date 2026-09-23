# dag-framework SPEC

**Package:** `@robota-sdk/dag-framework`

## Purpose

`dag-framework` is the embeddable in-process DAG runtime composition package. It assembles the
runtime, worker, local adapters, and default node definitions into a single factory call, so
consumers get a fully wired DAG framework without managing individual infrastructure objects.

Primary use case: local workflow execution composed by the agent CLI `/workflows` command, with
zero external runtime-server process dependencies.

## Contract and guarantees

- The execution composition this package assembles exposes only run advancement; it never exposes
  the raw worker loop, so a consumer cannot call the internal step function directly or create a
  second advancement loop.
- The trusted execution root is validated and canonicalized once at construction. Lower
  composition, worker, task, and lifecycle contracts require that root explicitly and never
  default it themselves — the factory is the sole boundary allowed to fall back to the process's
  own working directory when the root is omitted.
- Build, catalog-aware definition validation, registered-node catalog, cost-meta, and run-draft operations are separate domain capabilities on the returned framework, not
  folded into the main orchestration port. Until cost persistence and formula execution are wired
  with an explicit policy, cost operations report an explicit unsupported result rather than
  fabricating a response.
- The orchestration adapter does not encode build, validation, or catalog results, upload bytes, fabricate download URLs, or wrap asset
  metadata in HTTP envelopes — asset storage and byte streaming are exposed as a separate
  capability. Remaining orchestration methods keep an HTTP-shaped response contract because a
  native runtime server can sit behind the same port.
- The diagnostics dead-letter-reinject port this composition wires has no queue to drain and
  reports that explicitly; it must never report success in a way that reads as "the queue is
  empty," which would misstate a queue the composition does not have.
- Stopping the framework closes prompt admission before halting advancement, and resolves only
  after the jobs it owns (admitted submissions, terminal-observation promises, history-observation
  jobs) have settled.
- A run may be submitted before the framework is started; a run waiter itself creates the demand
  that starts advancement.

## Design decisions

- The default node catalog lives in a separate package and is deliberately not re-exported here —
  a pass-through re-export would force a hard production dependency edge onto that catalog for
  every consumer, even ones supplying their own node set.
- Provider definitions and the trusted-execution-root contract are imported from the shared
  agent-core contracts package as neutral types. Concrete provider packages and upper
  agent-runtime packages are never imported, so this package stays usable without pulling in a
  specific LLM vendor or product-level session logic.

## Non-goals / boundaries

- Must not import concrete provider packages or upper agent-runtime packages (session, executor,
  CLI, tools layers) — the dependency direction runs the other way.
- Does not manage a second worker loop or expose the raw worker step to consumers.
- Does not own the HTTP/byte mapping for assets — that belongs to the runtime server.
- Does not scan a workspace's authored workflow files beyond returning their metadata; it does not
  interpret or validate their contents.
