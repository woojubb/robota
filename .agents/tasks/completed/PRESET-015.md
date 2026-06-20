# PRESET-015: 전환 시 명령 모듈 라이브 재선택 — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-015-live-command-module-reselection.md`

## Plan

- [x] TC-01: `SystemCommandExecutor.replaceCommands([cmdA])` → `listCommands()` exactly `[cmdA]`
- [x] TC-02: disable list removes that module's commands from the rebuilt executor
- [x] TC-03: allowlist keeps only that module's commands
- [x] TC-04: `applyPresetToSession(..., { disabledCommandModules: ['x'] })` → `applyCommandModuleSelection(undefined, ['x'])` + applied has 'commandModules'
- [x] TC-05: no module fields → not called + 'commandModules' in skipped
- [x] TC-06: context without `applyCommandModuleSelection` → no throw
- [x] TC-07: framework build + test + typecheck + harness:scan (deps direction) pass
- [x] `SystemCommandExecutor.replaceCommands`
- [x] framework-owned `selectCommandModules` filter helper (NO agent-command import)
- [x] skill router retains module set + `reapplyCommandModuleSelection`
- [x] `ICommandHostContext.applyCommandModuleSelection?` + InteractiveSession wiring + orchestrator group

## Test Plan

Live command-module re-selection. `SystemCommandExecutor.replaceCommands` swaps the command set; the
skill router retains the modules it was given and `reapplyCommandModuleSelection` re-filters via the
framework-owned `selectCommandModules` (allow-then-deny; NO agent-command dependency) and rebuilds the
executor. Exposed as `ICommandHostContext.applyCommandModuleSelection?`; `applyPresetToSession`
re-applies the command-module group, reporting applied/skipped. Verified by executor unit test
(replaceCommands), pure-filter + rebuild tests (the SessionSkillRouter has ~12 collaborators so the
two-step it performs is tested directly), orchestrator spy tests (applied/skip/optional-safe), and
build/test/typecheck/scan (incl. dependency-direction) smoke. Re-selection is relative to the
session-start module set (documented limitation); enableParallelSubagents → PRESET-016,
selfVerification → PRESET-017.
