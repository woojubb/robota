# dag-framework SPEC

**Package:** `@robota-sdk/dag-framework`

## Purpose

`dag-framework` is the embeddable in-process DAG runtime composition package. It assembles the
runtime, worker, local adapters, and default node definitions into a single factory call, so
consumers get a fully wired DAG framework after supplying persistence paths or ports instead of
managing the remaining infrastructure objects individually.

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
- The run lifecycle delegates cancellation to the same committed-state authority as local execution.
  The HTTP runtime provider sends a cancel request to the native server and rejects a non-successful
  response; it does not treat stopping a status watcher as run cancellation.
- The diagnostics dead-letter-reinject port this composition wires has no queue to drain and
  reports that explicitly; it must never report success in a way that reads as "the queue is
  empty," which would misstate a queue the composition does not have.
- Stopping the framework closes prompt admission before halting advancement, and resolves only
  after the jobs it owns (admitted submissions, terminal-observation promises, history-observation
  jobs) have settled.
- A run may be submitted before the framework is started; a run waiter itself creates the demand
  that starts advancement.
- The in-process composition connects committed run cancellation to the worker attempts it owns,
  so active calls receive their abort signal. Local runtime completion joins admitted node
  lifecycles and their composite child runtimes after cancellation or timeout; providers that
  ignore abort keep completion pending until their calls settle. This is an ownership guarantee,
  not preemption of arbitrary code or a guarantee about work detached by a node or provider.
- Default skill-node discovery reads only host-supplied contribution sources and ordered skill
  roots; when either is omitted, no skill files are discovered, and construction never selects a
  filesystem source from the current process or home directory.

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

The local provider snapshots trusted host byte limits before executing any workflow, so the
default catalog used by `/workflows` bounds `text-repeat` and literal `text-replace` with no
workflow-controlled opt-out; tighter host limits reach the node context independently of workflow
input. These per-operation bounds are not a root aggregate budget, snapshot-size limit, or CPU preemption.

## Shared local root snapshot authority

Each independent local provider execution creates a fresh snapshot authority from trusted host
limits; nested executions and concurrent sibling reservations share the same live authority and
balance, including run definition and input snapshots consumed before dispatch. Encoding stops
before building a complete oversized snapshot, returning a structured non-retryable refusal. The
root owns the authority's lifetime and closes it on completion; committed cancellation closes new
admissions across its children, though it does not interrupt child execution already admitted
elsewhere. A host composing lower-level services directly must explicitly supply the same
authority to its own orchestrator and every worker — persisted lineage cannot recreate or
authorize a budget on its own.

## Local regex isolation

The local Node provider runs the default text-replace regex operation in an isolated worker (a
child process on Bun), keeping lifecycle, storage and the snapshot authority in the parent; only a
fixed trusted bootstrap and plain string data cross the boundary. A result is accepted only after
normal worker exit, so a late result cannot authorize output persistence or downstream execution,
and worker startup failure never falls back to inline execution. Request and response strings
share a bounded UTF-8 transport ceiling. This isolates only the default regex operation — it is
not a security sandbox and does not cover custom nodes, other transforms, tools, or provider code;
direct lower-level compositions must supply their own isolation capability.
