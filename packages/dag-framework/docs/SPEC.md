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
- Run lifecycle, definition reads and mutations, build, catalog-aware definition validation,
  registered-node catalog, cost-meta, and run-draft operations are domain capabilities on the
  returned framework. Until cost persistence and formula execution are wired
  with an explicit policy, cost operations report an explicit unsupported result rather than
  fabricating a response.
- The in-process framework does not create HTTP response envelopes. Its run lifecycle owns the
  implicit definition create/publish needed before a manually prepared run; the runtime server
  maps those outcomes to HTTP. Asset storage and byte streaming remain separate capabilities.
- The diagnostics dead-letter-reinject port this composition wires has no queue to drain and
  reports that explicitly; it must never report success in a way that reads as "the queue is
  empty," which would misstate a queue the composition does not have.
- Stopping the framework closes prompt admission before halting advancement, and resolves only
  after the jobs it owns (admitted submissions, terminal-observation promises, history-observation
  jobs) have settled.
- A run may be submitted before the framework is started; a run waiter itself creates the demand
  that starts advancement.
- The in-process composition connects committed run cancellation to the worker attempts it owns.
  Local provider calls can settle promptly when their node and provider cooperate with the attempt
  signal. This does not notify workers in other processes or wait for abandoned executor cleanup.
- Default skill-node discovery reads only host-supplied contribution sources and ordered skill roots.
  When either is omitted, no skill files are discovered; construction never selects a filesystem
  source from the current process or home directory.

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

## Text expansion ceiling

The local provider snapshots trusted host byte limits before executing any workflow. Omitted
limits retain the core default, so the default catalog used by `/workflows` bounds `text-repeat`
without any workflow-controlled opt-out. A tighter host limit travels through the worker into the
node context independently of workflow input and config. This limits one text expansion only; it
is not a root aggregate budget, a snapshot-size limit, or CPU preemption.

## Shared local root snapshot authority

Each independent local provider execution creates a fresh task snapshot authority from a snapshot
of trusted host limits. Nested executions inherit the same live authority; a new provider or local
storage instance does not create a new allowance for that child. Concurrent sibling reservations
share one balance even while a storage write awaits completion. The default cumulative input and
output allowances are 16 MiB each. This accounts for persisted task I/O admission only, not generated
values, run-level snapshots, memory, CPU, durable budget recovery or multiple processes. A host
composing lower-level workers must explicitly supply the same authority to every participating
worker. Persisted lineage identifies ancestry but cannot recreate or authorize a budget. The
root owns authority lifetime and closes it on completion; committed cancellation closes new
admissions across its children. This does not interrupt child execution or atomically cancel
writes already admitted to another child storage instance.
