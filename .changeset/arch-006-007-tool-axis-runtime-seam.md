---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-cli': minor
---

ARCH-006 + ARCH-007 — the capability-pack TOOL axis reaches parity with the command and subagent axes,
and `robota` consumes the composition kernel's RUNTIME SEAM instead of only its materials.

- **`@robota-sdk/agent-framework` (ARCH-006)** — the default tool set is no longer hard-coded.
  `createSession` accepts `defaultTools`, which REPLACES the `createDefaultTools()` tier (`[]` suppresses
  it entirely) — the tool-axis mirror of NEUT-003's `builtInAgents` seam for subagents. The assembled
  list `defaultTools ⊕ additionalTools ⊕ goalTool` is now **deduplicated by tool name, first occurrence
  wins**, the same rule `AgentDefinitionLoader` applies within the subagent built-in tier. So a
  contributed tool with a NEW name is additive, a contributed tool that mirrors a framework default is
  deduped rather than listed twice, and a product can hand its whole tool surface to its capability
  packs. A name collision keeps the framework default and drops the contribution: the default tier is
  built WITH the session context (`cwd` supplies `agent-tools`' working-directory path guard, plus the
  sandbox client and retrieval adapter) and an already-constructed contribution carries none of it, so
  replacement is expressible only through the explicit `defaultTools` seam — never as a side effect of a
  collision. The edit-checkpoint wrap now covers the assembled set, so a pack-contributed `Write`/`Edit`
  is checkpointed too. Option threaded through `ICreateSessionOptions` / `IInitOptions` /
  `IInteractiveSessionStandardOptions`. Absent `defaultTools` and absent a duplicate name, every existing
  path is byte-identical.
- **`@robota-sdk/agent-product` (ARCH-007)** — `buildRuntimeOptions` no longer overwrites a
  caller-supplied `commandModules`. A shell that has already narrowed the merged `base ⊕ packs` superset
  (as `robota` does with its preset's enabled/disabled delta) keeps that selection; the assembled set is
  overlaid only when the caller left it unset — the same rule `permissionMode` already followed.
- **`@robota-sdk/agent-cli` (ARCH-007)** — `startCli` now routes through
  `product.buildRuntimeOptions(...)`. The shell resolves its own session inputs and the kernel lays the
  product-owned materials on top: the packs' tools (`additionalTools`), the packs' subagents
  (`agentDefinitions`), and the default preset's permission posture when `--permission-mode` left it
  unset. The hand-threaded `product.subagents` path and the three per-surface
  `args.permissionMode ?? resolvedPreset.permissionMode` expressions are gone — every surface binds to
  the one kernel result.

End-user `robota` behavior is unchanged: the assembled command-module set, provider surface, tool set,
subagent roster, preset resolution, and permission posture all match the pre-change assembly.
