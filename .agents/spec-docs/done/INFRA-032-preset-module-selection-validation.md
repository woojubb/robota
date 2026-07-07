---
status: done
type: RULE
tags: [cli]
---

# INFRA-032: Surface unknown preset command-module names (ARL-03)

## Problem

A preset's `enabledCommandModules` / `disabledCommandModules` are filtered by
`applyModuleSelection` (`packages/agent-command/src/default/default-command-modules.ts:52-66`) against
each module's `name` — the long `agent-command-*` form (e.g. `agent-command-editor`). A preset author
who writes the plausible **short** command name (`disabledCommandModules: ["editor"]`) — or misspells a
name — gets **no match, no error, no notice**: the module stays enabled and the intent is silently
dropped. There is a test that even encodes the silent behavior
(`default-command-modules.test.ts` — `enabledCommandModules: [HELP, 'does-not-exist']`). Surfaced as
ARL-03 by the architecture-refresh pass; the name vocabulary was documented in the agent-preset SPEC by
the earlier doc pass, but nothing surfaces a mismatch at runtime.

**The same defect exists on a second entry point.** The session-time `/preset` switch runs the
**byte-identical** `selectCommandModules` (`agent-framework/src/commands/command-module-selection.ts:12-27`)
via `SessionSkillRouter.reapplyCommandModuleSelection` — it drops unknown names just as silently. So the
filter/detection logic is **duplicated** across `agent-command`'s `applyModuleSelection` and
`agent-framework`'s `selectCommandModules`, and the bug reproduces on both `robota --preset x` (startup)
and in-session `/preset x`.

**Reproduction condition:** create `~/.robota/presets/x.json` with `"disabledCommandModules": ["editor"]`.
Run `robota --preset x` → `/editor` is still available, no message. Also switch in-session with
`/preset x` → same silent no-op. Same typo, two silent drops.

## Architecture Review

### Affected Scope

- **`agent-framework`** (`commands/command-module-selection.ts`) — the **lower shared layer**
  (`agent-command` depends on `agent-framework`, not vice versa; verified). Owns `selectCommandModules`.
  Gains the **single** pure detection primitive
  `findUnknownModuleNames(availableNames, enabled, disabled): readonly { name; kind }[]`, and is the SSOT
  both entry points reuse.
- **`agent-command`** (`default-command-modules.ts`): its `applyModuleSelection` is **byte-identical** to
  `selectCommandModules` — collapse the duplicate by delegating to the framework function (allowed edge
  command→framework). `createDefaultCommandModules` **returns** `{ modules, unknownModuleNames }` (via the
  shared primitive) instead of only `modules`.
- **`agent-cli`** (composition root, owns terminal UX): `buildCommandSetup` forwards the
  `unknownModuleNames` up to `cli.ts`, which writes a **non-fatal terminal notice** per unknown, mirroring
  the existing external-preset error reporting (`cli.ts:179` `terminal.writeError('Skipped external preset "…": …')`).
- **Session `/preset` path (same defect, in scope):** `SessionSkillRouter.reapplyCommandModuleSelection`
  (`agent-framework`) already holds the full `allCommandModules` set — call `findUnknownModuleNames` there
  and surface the unknowns in the `/preset` command result, so an in-session switch is no longer silent.
- Docs: `agent-command`, `agent-framework`, `agent-preset` SPECs. A `.changeset` (all three are published).

### Alternatives Considered

1. **One shared pure `findUnknownModuleNames` in `agent-framework`; return the unknowns as data on both
   paths; the CLI/`/preset`-result surface the notice; collapse the duplicate filter (chosen).** The
   detection lives once, in the lower shared layer next to `selectCommandModules`; `agent-command` reuses
   it (and delegates its identical filter to `selectCommandModules`), the startup path returns
   `{ modules, unknownModuleNames }` up to the CLI, and the session path surfaces the same via the
   `/preset` result.
   - _Pro:_ single source of both the filter and the detection (removes an existing duplicate rather than
     adding a third copy); fixes the defect on **both** entry points; pure data returned (no I/O threaded
     into the library); non-fatal.
   - _Con (cost):_ touches agent-framework + agent-command + agent-cli + the `/preset` result path;
     `createDefaultCommandModules`'s return type changes (2 callers) → changeset.
2. **Optional `onUnknownModuleName(name, kind)` callback on `createDefaultCommandModules`, startup path
   only.** _Rejected —_ (a) it fixes only ONE of the two identical entry points (in-session `/preset`
   stays silent); (b) threading an I/O reporting hook into a library call is a worse shape than returning
   data; (c) it leaves the `applyModuleSelection` ↔ `selectCommandModules` duplication in place. The
   "non-breaking return type" it buys is illusory — `buildCommandSetup`'s signature changes either way.
3. **Hardcode a canonical `COMMAND_MODULE_NAMES` constant + a standalone validator.** _Rejected —_ a
   hand-maintained name list is a parallel SSOT that drifts when a module is added/renamed; derive the set
   from the built modules instead.
4. **Throw / hard-fail on an unknown name.** _Rejected —_ too aggressive: a preset typo in a _disable_
   list must not abort the CLI. The finding asks for a detectable **notice**, not a fatal error.

### Decision

**Alternative 1.** Add the single pure `findUnknownModuleNames` to `agent-framework` (beside
`selectCommandModules`); collapse `agent-command`'s duplicate `applyModuleSelection` to delegate to
`selectCommandModules` and reuse the primitive; `createDefaultCommandModules` returns
`{ modules, unknownModuleNames }`; `buildCommandSetup` forwards them and `cli.ts` writes a non-fatal
terminal notice; `SessionSkillRouter.reapplyCommandModuleSelection` surfaces the same unknowns in the
`/preset` result. Detection is owned once in the lower shared layer; the shells (CLI startup + `/preset`
command) do the user-facing I/O. Both entry points are covered; the pre-existing filter duplication is
removed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework (shared primitive + owner), agent-command (delegate + return unknowns), agent-cli (startup notice), framework `/preset` result (session notice), 3 SPECs + changeset
- [x] Sibling scan 완료 — the filter exists in TWO byte-identical copies (`applyModuleSelection` @ agent-command, `selectCommandModules` @ agent-framework); both entry points (startup `--preset`, session `/preset` via `SessionSkillRouter`) drop unknowns silently — verified by rg + call-chain trace; the fix covers both and collapses the duplicate
- [x] 대안 최소 2개 검토 완료 — 4 alternatives; 3 rejected (startup-only callback fixes one path + keeps the duplicate; parallel name-list SSOT; over-aggressive throw)
- [x] 결정 근거 문서화 완료 — detection SSOT belongs in the lower shared layer (agent-framework) both paths reuse; return pure data, shells do I/O; fix both entry points; non-fatal

## Solution

1. Add pure `findUnknownModuleNames(availableNames: readonly string[], enabled?, disabled?): readonly { name: string; kind: 'enabled' | 'disabled' }[]` to `agent-framework/src/commands/command-module-selection.ts`, beside `selectCommandModules`. Single source of the detection.
2. Collapse the duplicate: `agent-command`'s `applyModuleSelection` delegates to `selectCommandModules` (allowed edge command→framework); `createDefaultCommandModules` computes `unknownModuleNames` via `findUnknownModuleNames(builtModuleNames, enabled, disabled)` and returns `{ modules, unknownModuleNames }` (updating its 2 callers).
3. `buildCommandSetup` (`command-setup.ts`) forwards `unknownModuleNames` up; `cli.ts` writes a non-fatal terminal notice per unknown (mirroring `cli.ts:179`), e.g. `Preset command-module "<name>" (<enabled|disabled>) matched no module — expected the agent-command-* form; ignored.`
4. Session path: in `SessionSkillRouter.reapplyCommandModuleSelection`, call `findUnknownModuleNames(allCommandModuleNames, enabled, disabled)` and surface the unknowns in the `/preset` command result (so an in-session `/preset` switch reports them).
5. Tests: update the agent-command test that encodes the silent case to assert the returned `unknownModuleNames`; add a framework unit test for `findUnknownModuleNames`; add a CLI-notice test and a `/preset`-result test.
6. Update `agent-framework` + `agent-command` SPECs (single detection primitive; `applyModuleSelection` delegates; `createDefaultCommandModules` return shape) and cross-reference the agent-preset SPEC vocabulary note; add a `.changeset` (agent-framework/agent-command/agent-cli); mark ARL-03 resolved.
7. Build/typecheck/full-repo typecheck/affected tests + `pnpm harness:scan` 45/45.

## Affected Files

- `packages/agent-framework/src/commands/command-module-selection.ts` (add `findUnknownModuleNames`)
- `packages/agent-command/src/default/default-command-modules.ts` (delegate filter; return `{ modules, unknownModuleNames }`)
- `packages/agent-command/src/startup/command-setup.ts` (agent-cli) or wherever `buildCommandSetup` lives — forward unknowns
- `packages/agent-cli/src/cli.ts` — write the non-fatal terminal notice
- `packages/agent-framework/src/interactive/interactive-session-skill-router.ts` (`reapplyCommandModuleSelection`) + the `/preset` command result path — surface session-time unknowns
- tests: `agent-command` default-command-modules, `agent-framework` selection unit, agent-cli notice, `/preset` result
- new `.changeset/*.md` (agent-framework/agent-command/agent-cli — behavior addition)
- `packages/agent-framework/docs/SPEC.md`, `packages/agent-command/docs/SPEC.md`, `packages/agent-preset/docs/SPEC.md`
- `.agents/architecture-remediation-log.md` (ARL-03 → Resolved)

## Completion Criteria

- [ ] TC-01: `agent-framework` exports a single pure `findUnknownModuleNames(availableNames, enabled, disabled)` returning `{ name, kind }` for every enabled/disabled entry matching no available name (and `[]` when all match); unit-tested.
- [ ] TC-02: `agent-command`'s `applyModuleSelection` no longer duplicates the filter body — it delegates to `agent-framework`'s `selectCommandModules`; `rg` shows one filter implementation, not two.
- [ ] TC-03: `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`; module filtering for known names is unchanged (existing enable/disable tests pass); `unknownModuleNames` is empty when all names match.
- [ ] TC-04: Startup `robota --preset x` with an unknown `disabledCommandModules` name (e.g. `"editor"`) emits a non-fatal terminal notice naming the entry + kind; the CLI does not abort.
- [ ] TC-05: In-session `/preset x` with the same unknown name surfaces the unknown in the `/preset` command result (no longer silent).
- [ ] TC-06: No parallel/hardcoded module-name list is introduced; detection derives from the built module `name` set.
- [ ] TC-07: `pnpm build`, `pnpm typecheck`, affected tests, full-repo typecheck, and `pnpm harness:scan` (45/45) all green; a `.changeset` covers the change.
- [ ] TC-08: `agent-framework`/`agent-command`/`agent-preset` SPECs updated; ARL-03 marked resolved in the remediation log.

## Test Plan

Test strategy (RULE + cli): unit for the shared detection primitive + the delegation; startup CLI
terminal-notice assertion; session `/preset`-result assertion; structural for single-filter + no
parallel list; green gate incl. changeset.

| TC-ID | Test Type  | Tool / Approach                                                                                                | Notes                             |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| TC-01 | Unit       | vitest — `findUnknownModuleNames` returns `{name,kind}` per unmatched name                                     | agent-framework primitive         |
| TC-02 | Unit       | vitest — `applyModuleSelection` delegates to `selectCommandModules`; one filter impl                           | duplicate collapsed               |
| TC-03 | Unit       | vitest — `createDefaultCommandModules` returns `{modules, unknownModuleNames}`; known-name filtering unchanged | return shape + regression         |
| TC-04 | Unit/CLI   | vitest — startup notice emitted for an unknown preset module name; no abort                                    | mirrors external-preset reporting |
| TC-05 | Unit       | vitest — in-session `/preset` result surfaces the unknown name                                                 | session path no longer silent     |
| TC-06 | Structural | `rg` — no hardcoded COMMAND_MODULE_NAMES list; detection from built module names                               | no parallel SSOT                  |
| TC-07 | Build/CI   | `pnpm build && pnpm typecheck && pnpm test` (affected) + full typecheck + scan + changeset                     | green gate                        |
| TC-08 | Structural | SPEC (framework/command/preset) + remediation-log diff review                                                  | docs in sync                      |

## Tasks

- [x] `.agents/tasks/INFRA-032.md` — created

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter: `---`; `status: draft`; `type: RULE` (valid); `tags: [cli]`.
Problem: concrete symptom (preset `disabledCommandModules: ["editor"]` silently ignored; a test encodes the silent case) + reproduction condition; no TBD.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` (applyModuleSelection is the create-time filter; framework command-module-selection is a separate duplicate, noted out-of-scope; CLI is where preset delta + module set meet); 4 alternatives with pro/con (3 rejected); Decision references the detection-where-names-live / I/O-in-shell / non-fatal trade-off.
Completion Criteria: TC-01..TC-06, all TC-N-prefixed, observable form.
Test Plan: present; 6 rows matching TC-01..TC-06; each has Test Type + Tool; no "manual" rows.
Structure: Tasks placeholder; Evidence Log empty; no `## Status`/`## Classification` in body.

### [Design Review] — proposal-reviewer | 2026-07-07

- Round 1 → **REVISE**: startup-only callback fixed just ONE of two byte-identical entry points (session `/preset` still silent), mislayered detection into agent-command (a 3rd duplicate), and rejected return-data on a discounted backward-compat basis; no changeset.
- Round 2 → **ENDORSE**: shared `findUnknownModuleNames` in agent-framework (lower shared layer both paths reuse), duplicate collapsed via allowed command→framework delegation, both entry points covered (return-data), changeset added. Decision sound + rule-aligned (dep direction, SSOT, no silent fallback). 3 non-blocking nits noted for implementation (buildCommandSetup path is agent-cli; the `applyCommandModuleSelection` seam/`IPresetApplicationResult` return-type change; caller count).

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user rule): approved when the neutral proposal-reviewer ENDORSEs a sound, rule-aligned recommendation. Reviewer returned `REVIEW VERDICT: ENDORSE`. No Architecture Review / type / tags changed after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
`.agents/tasks/INFRA-032.md` created (T1–T… mapped to TC-01..TC-08; includes Test Plan / 검증 + the 3 reviewer nits). Path recorded in `## Tasks`.

### [GATE-VERIFY] — ✅ PASS | 2026-07-07

**Status upgrade:** in-progress → verifying
TC-01: `findUnknownModuleNames` added to agent-framework + exported (root + commands index); 5-case unit test. TC-02: `applyModuleSelection` delegates to `selectCommandModules` — the `allow.has/deny.has` filter body exists ONLY in framework (rg); no hardcoded name list. TC-03: `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`; all callers updated; known-name filtering unchanged. TC-04: startup `cli.ts` writes non-fatal terminal notice per unknown (agent-cli test). TC-05: session `/preset` result surfaces unknowns via the `applyCommandModuleSelection` seam (`void → readonly IUnknownCommandModuleName[]`) + `IPresetApplicationResult.unknownCommandModules` (preset-application + preset-command tests). TC-06: no parallel list. TC-07: `.changeset/surface-unknown-preset-command-modules.md` (framework/command/cli minor); build + full-repo typecheck + affected tests (framework 1043, command 213, cli 166) + `pnpm harness:scan` 45/45 all green. TC-08: 3 SPECs + remediation-log (ARL-03 → Resolved) updated.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-07

**Status upgrade:** verifying → done
All TC-01..TC-08 satisfied. Unmatched preset command-module names are now surfaced as non-fatal notices on BOTH the startup `--preset` and in-session `/preset` paths; detection is a single pure primitive in the lower shared layer (agent-framework), and the byte-identical filter duplicate is collapsed. proposal-reviewer ENDORSE (after 1 REVISE that caught the missed second entry point + mislayered detection); implemented by architecture-implementer; full-repo typecheck green.
