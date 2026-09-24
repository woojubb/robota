# Agent Command Workflows Specification

## Purpose

Provides the agent-cli `/workflows` command module — a bridge that surfaces the DAG workflow
engine inside the agent CLI by composing `@robota-sdk/dag-framework` in-process. Owns the
`workflows` command, its subcommand dispatch (`create`, `build`, `list`, `catalog`, `validate`,
`run`), and the natural-language authoring pipeline behind `create` and `build`.

## Non-goals / Boundaries

- Does not own DAG execution (`dag-framework`'s job), command contracts (`agent-framework` /
  `agent-interface-transport`'s job), or CLI composition (`agent-cli` registers this module).
- Owns no SSOT types of its own — it consumes command and DAG contracts from their owner packages.
- No standalone `save` verb: persistence is not a user-facing capability on this surface. `create`
  and `build` both end in a save; a separate `save <json>` verb would be an _import_ of externally
  supplied graph/node data, a different capability than what this surface unifies.

## Contract

`createWorkflowsCommandModule(...)` returns an `ICommandModule` whose dispatch reads a leading
subcommand token. It holds no state: providers are created per invocation from explicit settings
sources, and the workflow project capability is passed in rather than discovered — absence of the
project is a restriction for every subcommand rather than an implicit fallback to `cwd`.

The six subcommands are one surface sharing exactly one owner per shared concern (subcommand
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
imports no concrete provider package. When no provider is injected, settings sources are required;
authoring does not search the process home for a provider profile.

## Invariants

- Errors are surfaced as failed `ICommandResult`s with a human-readable message, never silently
  swallowed; there is no fallback to `cwd`, generic filesystem access, or a default workflow when
  authority/mutation capability, a file, or a DAG is missing or invalid.
- The `workflows` command is model-invocable: an agent can author and run (or author and save) a
  workflow from a chat request, subject to the same privilege split between `create` and `build`.

The supported sync catalog's `text-repeat` rejects output beyond the runtime's default 4 MiB UTF-8
ceiling before expanding it, including when a saved workflow attempts to supply higher limits.
`run` surfaces that rejection as a failed command. This is a per-operation output bound, separate
from the existing trusted file-read bound; it is not an aggregate workflow budget or CPU preemption.

Saved composite workflows inherit the parent's live task snapshot authority and per-operation
byte ceilings through their injected runner. Parent and child accepted task input/output snapshots
therefore consume the same cumulative allowance; a child cannot reset it by constructing its local
runtime. Independent `/workflows run` invocations receive independent allowances. Trusted hosts may
configure snapshot allowances, while saved workflow data cannot. This is persisted task snapshot
admission after serialization, not generation-time memory protection or CPU preemption.

## Regex CPU interruption boundary

The default sync catalog's text-replace regex executes outside the parent event loop.
Task timeout or cancellation joins that operation's isolated execution exit before returning its failure,
preventing its late output from reaching snapshots or downstream nodes. A subsequent independent
workflow remains executable. Registry overrides retain their own handler semantics. This guarantee
is limited to the default regex operation, not the entire sync catalog or custom node code.

Bun source and standalone artifacts use a child process running the same fixed pure operation,
while Node uses a worker thread. Startup failure has no inline fallback. Operation DTOs have a
4 MiB UTF-8 transport ceiling, separate from text-repeat's pre-expansion ceiling and the root's
cumulative persisted snapshot admission budget. None is a general process memory limit.

Bun product reliability remains contingent on the host's native filesystem authority: its existing
macOS native finalizer failure also occurs without regex execution. A standalone operation probe
does not establish end-to-end product support in the presence of that host failure.
