# Agent Command Workflows Specification

## Purpose

Provides the agent-cli `/workflows` command module — a bridge that surfaces the DAG workflow
engine inside the agent CLI by composing `@robota-sdk/dag-framework` in-process. Owns the
`workflows` command and its natural-language authoring pipeline.

## Non-goals / Boundaries

- Does not own DAG execution (`dag-framework`'s job), command contracts (`agent-framework` /
  `agent-interface-transport`'s job), or CLI composition (`agent-cli` registers this module).
- Owns no SSOT types of its own — it consumes command and DAG contracts from their owner packages.
- No standalone `save` verb: persistence is not a user-facing capability on this surface. `create`
  and `build` both end in a save; a separate `save <json>` verb would be an _import_ of externally
  supplied graph/node data, a different capability than what this surface unifies.

## Contract

`createWorkflowsCommandModule(...)` returns an `ICommandModule` whose dispatch reads a leading
subcommand token. Providers are created per invocation from explicit settings sources; an explicit
detached run retains its cancellation handle and terminal result only within its live command
host, which must stop and join active runs on shutdown; one-shot hosts refuse detached runs
because they cannot accept later operator commands. The workflow project capability is passed in
rather than discovered — absence of the project is a restriction rather than an implicit fallback
to `cwd`.

The subcommands are one surface sharing exactly one owner per shared concern (subcommand
registry, argument grammar, node catalog, authoring pipeline) rather than six independent copies —
this is a design invariant, not an implementation detail: an advertised subcommand cannot be
unroutable, and a subcommand's usage hint cannot drift from its actual usage text, because both are
derived from the same registry entry.

The node catalog used to _validate_ and _list_ a workflow is guaranteed to be the same catalog it
_runs_ against — both are built through the one workspace-runtime construction path, so a workflow
authored against workspace-local nodes cannot pass authoring only to fail validation or execution
with an unknown node type.

**`build` never executes.** It shares the same author-and-save pipeline as `create` (same argument
grammar, same provider seam, same catalog, same persistence) but stops after saving and reports the
path with next-step hints. No module reachable from `build`'s import path can construct a DAG
execution runtime — this is treated as a static, enforced property, not an incidental behavior — so
`build` is safe to expose as a lower-privileged, model-invocable action than `create`. A failure
before assembly (no provider, invalid or unassemblable spec) leaves nothing on disk.

**Provider seam.** Both authoring subcommands resolve their AI provider lazily per invocation from
injected settings/definitions; the module depends only on `agent-core`'s provider interfaces and
imports no concrete provider package. When no provider is injected, settings sources are required —
authoring never searches the process home for a provider profile.

## Invariants

- Errors are surfaced as failed `ICommandResult`s with a human-readable message, never silently
  swallowed; there is no fallback to `cwd`, generic filesystem access, or a default workflow when
  authority/mutation capability, a file, or a DAG is missing or invalid.
- The `workflows` command is model-invocable: an agent can author and run (or author and save) a
  workflow from a chat request, subject to the same privilege split between `create` and `build`.
- The built-in `text-repeat` operation enforces a fixed output-size ceiling before expanding output; a saved
  workflow cannot raise it, and `run` surfaces a violation as a failed command rather than an
  unbounded result.
- A saved composite workflow shares its parent's live task-snapshot allowance and per-operation
  output ceilings instead of resetting them by constructing its own runtime; only a trusted host,
  never saved workflow data, can configure that allowance, and independent `run` invocations get
  independent allowances.
- Cancelling or timing out a run propagates into any saved composite's child runtime, so an active
  prompt provider receives the abort signal across composite boundaries; cancellation and host
  shutdown wait for admitted local node calls and their child runtimes to settle, so a provider that
  ignores abort keeps completion pending instead of reporting success while its call is still active.
- The default text-replace regex operation runs in isolated execution outside the parent event loop,
  so a timeout or cancellation can interrupt it without leaking late output into snapshots or
  downstream nodes and without leaving a subsequent independent workflow unable to run; this
  guarantee covers only that default operation, not arbitrary custom node code.
