# PRESET-016: 전환 시 enableParallelSubagents 라이브 게이팅 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-016-parallel-subagents-gate.md`

## Plan

- [x] TC-01: `Session({enableParallelSubagents:false})` → getter false; default → true
- [x] TC-02: `setParallelSubagentsEnabled(false)` → getter false
- [x] TC-03: agent tool with `isParallelSubagentsEnabled: () => false` → no dispatch, disabled result
- [x] TC-04: gate `() => true` / unset → dispatch proceeds (spawn spy called)
- [x] TC-05: `applyPresetToSession(..., { enableParallelSubagents:false })` → `setParallelSubagentsEnabled(false)` + applied
- [x] TC-06: omitted → not called + in skipped; runtime without method → no throw
- [x] TC-07: agent-session + agent-framework build + test + typecheck + harness:scan pass
- [x] SessionBase gate flag (default true) + get/set; ISessionOptions.enableParallelSubagents
- [x] IAgentToolDeps gate predicate + agent-tool execute gate + disabled result
- [x] wireSessionDeps predicate wiring; ICommandSessionRuntime seam + orchestrator group

## Test Plan

Live runtime gate for `enableParallelSubagents` (NOT always-construct — default path unchanged). The
session holds a mutable `parallelSubagentsEnabled` (default `true` = current behavior); the agent tool's
executor refuses dispatch (returns a JSON disabled result via `stringifyParallelSubagentsDisabled`, no
throw) when the deps gate predicate returns false; `wireSessionDeps` binds the predicate to the session
flag (only present when the agent runtime was built at assembly). `ICommandSessionRuntime.
setParallelSubagentsEnabled?` exposes it; `applyPresetToSession` re-applies the group. Verified by
session unit tests (default/toggle), agent-tool dispatch-gate tests (refused vs. proceeds, single+batch),
orchestrator spy tests (applied/skip/optional-safe), and build/test/typecheck/scan smoke. Sessions started
without the runtime can't live-enable parallel (documented; next session). selfVerification → PRESET-017.
