# PRESET-014: 전환 시 페르소나/시스템 프롬프트 라이브 재적용 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-014-live-persona-reapply.md`

## Plan

- [x] TC-01: `rebuildSystemMessage(agents, claude, { persona })` reflects the new persona
- [x] TC-02: persona override persists across a later override-less rebuild (mutable currentPersona)
- [x] TC-03: `applyPresetToSession(..., { persona })` → `ctx.applyPersona` called + applied has 'persona'
- [x] TC-04: no persona → `applyPersona` not called + 'persona' in skipped
- [x] TC-05: context without `applyPersona` (optional) → no throw
- [x] TC-06: `TResolvedPresetOptions` (persona) assignable to `IPresetApplicationOptions`
- [x] TC-07: framework build + framework/preset test + `pnpm typecheck` exit 0
- [x] create-session-runtime: mutable currentPersona + 3-arg `rebuildSystemMessage`
- [x] interactive-session: `applyPersona` method (recompose from tracked entries → updateSystemMessage)
- [x] host-context: `ICommandHostContext.applyPersona?` + orchestrator persona group

## Test Plan

Live persona re-application. `rebuildSystemMessage` closure tracks a mutable `currentPersona` and
accepts a persona override (3rd arg); `InteractiveSession.applyPersona` recomposes from the tracked
AGENTS.md/CLAUDE.md entries (same source as the staleness refresh precedent) and propagates via
`updateSystemMessage`. Exposed as `ICommandHostContext.applyPersona?`; `applyPresetToSession`
re-applies the persona group, reporting applied/skipped. Verified by framework unit tests (override
reflected + persisted), orchestrator spies (applied/skip/optional-safe), agent-preset type-compat,
and build/test/typecheck/scan smoke. Command-module / execution-capability live re-application is
OUT OF SCOPE (deferred to PRESET-015 — not feasible without registry-mutability + runtime rebuild).
