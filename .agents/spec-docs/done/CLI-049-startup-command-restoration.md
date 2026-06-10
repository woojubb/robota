---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-049: Startup command restoration — init/diagnose dispatch, first-run welcome, terminal warning (covers backlog CLI-049/050/051/052/056)

## Problem

The ARCH-002 slim-down refactor (commit `a12a3348d`) deleted `src/startup/preflight.ts` and
`src/startup/diagnose-command.ts` from `packages/agent-cli` without re-wiring the features they
dispatched. Four previously-shipped user-facing features are now dead:

1. **`robota init` unreachable** — `runInitCommand()` (`src/init/init-command.ts:74`) has zero
   call sites. Running `robota init` in any directory falls through to normal TUI startup
   instead of project initialization. Reproduce: `robota init` in a temp dir → TUI opens, no
   init flow.
2. **`robota diagnose` missing** — `diagnose-command.ts` was deleted entirely; SPEC.md:873/899
   still documents it and the first-run welcome text still recommends it. Reproduce:
   `robota diagnose` → TUI opens, no diagnostics.
3. **First-run welcome dead** — `isFirstRun()/markOnboarded()/printFirstRunWelcome()`
   (`src/startup/first-run.ts`) have zero call sites (was wired at old cli.ts:132-134).
   Reproduce: delete `~/.robota` onboarded marker, run `robota` → no welcome banner, marker not
   created.
4. **macOS Terminal.app warning dead** — `warnIfTerminalAppOnMacOS()`
   (`src/startup/terminal-check.ts`) has zero call sites. Reproduce: `TERM_PROGRAM=Apple_Terminal`
   on darwin, run `robota` → no CJK/IME warning.

Additionally `docs/SPEC.md` claims `src/startup/preflight.ts` exports
`handlePreflightCommands(args, ctx)` (SPEC.md:875, 1628) and lists `diagnose-command.ts`
(SPEC.md:873) — both files do not exist — and states `--system-prompt` is "parsed but not yet
connected" (SPEC.md:937) while `modes/print-mode.ts:53` already passes it (spec drift).

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/cli.ts` — composition root: add `init`/`diagnose` positional dispatch,
  first-run welcome + terminal warning before TUI render
- `packages/agent-cli/src/startup/diagnose-command.ts` — restored (from git history) with its own
  context type, `ITerminalOutput` injection, no deleted-module imports
- `packages/agent-cli/src/startup/first-run.ts` — `printFirstRunWelcome(terminal)` takes
  `ITerminalOutput` (CLIR-H01: no direct `process.*` in startup modules)
- `packages/agent-cli/src/startup/terminal-check.ts` — `warnIfTerminalAppOnMacOS(terminal)` same
  injection
- `packages/agent-cli/docs/SPEC.md` — remove preflight/diagnose stale module rows, document
  cli.ts dispatch list, correct the `--system-prompt` note
- `.agents/backlog/` — 14 new audit backlog files + README index (documentation payload of this PR)

### Alternatives Considered

**A. Restore `preflight.ts` dispatcher as it was before `a12a3348d`**

- Pro: smallest diff vs old code; one place for all pre-provider commands
- Con: reintroduces an indirection layer that ARCH-002 deliberately removed; current cli.ts
  already dispatches help/version/check-update/reset/session-analyze/user-local inline, so a
  second dispatcher would split the dispatch table across two files

**B. Inline dispatch in `cli.ts` composition root (init/diagnose as new positional branches)**

- Pro: consistent with the post-ARCH-002 architecture where cli.ts is the single composition
  root and dispatch table; no new module; SPEC describes one dispatch list
- Con: cli.ts grows by ~20 lines; init needs `providerDefinitions` so its branch must sit after
  `buildCommandSetup()`

**C. Register init/diagnose as SDK command modules (slash-command style)**

- Pro: uniform command infrastructure
- Con: init/diagnose are provider-free preflight commands that must run before provider setup;
  command modules execute inside an initialized session — wrong lifecycle stage

### Decision

**B 채택** — cli.ts is already the sole dispatch table after ARCH-002; adding two positional
branches keeps a single source of dispatch truth and avoids resurrecting the indirection that
the refactor removed. The trade-off (cli.ts grows slightly) is acceptable because each branch is
a thin delegation, matching the existing help/version/reset branches. Startup modules receive
`ITerminalOutput` instead of writing to `process.stderr` directly, per CLIR-H01.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-cli only (startup modules + composition root + SPEC)
- [x] Sibling scan 완료 — cli.ts의 기존 positional 분기(`session analyze`, `user-local`) 및
      flag 분기(help/version/checkUpdate/reset) 패턴 확인; init/diagnose는 동일 패턴으로 추가.
      first-run/terminal-check는 renderApp 직전 TUI 경로에만 적용 (print 모드 오염 방지)
- [x] 대안 최소 2개 검토 완료 — A(preflight 복원)/B(인라인 분기)/C(command module) 3안 검토
- [x] 결정 근거 문서화 완료 — Decision 섹션 참조

## Solution

1. Restore `src/startup/diagnose-command.ts` from `a12a3348d^` with:
   - own `IDiagnoseContext { version, terminal, cwd }` (no `IPreflightContext` import)
   - all six checks preserved: Node version, CLI version, API key (incl. DASHSCOPE), settings
     JSON validity, terminal, network reachability (provider-aware endpoint)
2. `cli.ts`: add `if (args.positional[0] === 'diagnose')` branch (after `reset`, before
   user-local) calling `runDiagnoseCommand({ version, terminal, cwd })` and returning.
3. `cli.ts`: add `if (args.positional[0] === 'init')` branch after `buildCommandSetup()` calling
   `runInitCommand(cwd, terminal, { yes: args.yes, onProviderSetup })` where `onProviderSetup`
   delegates to `runInteractiveProviderSetup` (PM-033 behavior preserved), then returning.
4. `first-run.ts`: `printFirstRunWelcome(terminal: ITerminalOutput)`; `cli.ts` TUI path (just
   before `renderApp`) runs `if (isFirstRun()) { printFirstRunWelcome(terminal); markOnboarded(); }`.
5. `terminal-check.ts`: `warnIfTerminalAppOnMacOS(terminal: ITerminalOutput)`; called in the TUI
   path just before `renderApp`.
6. `docs/SPEC.md`: replace preflight/diagnose stale rows with the cli.ts dispatch list; correct
   the `--system-prompt` connection note to reflect print-mode + TUI wiring (CLI-027).
7. Commit the 14 audit backlog files + README index in this PR.

## Affected Files

- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/startup/diagnose-command.ts` (restored)
- `packages/agent-cli/src/startup/first-run.ts`
- `packages/agent-cli/src/startup/terminal-check.ts`
- `packages/agent-cli/src/startup/__tests__/diagnose-command.test.ts` (new)
- `packages/agent-cli/src/startup/__tests__/first-run.test.ts` (new)
- `packages/agent-cli/src/startup/__tests__/terminal-check.test.ts` (new)
- `packages/agent-cli/docs/SPEC.md`
- `.agents/backlog/CLI-049…CLI-062 files + README.md`

## Completion Criteria

- [x] TC-01: `node packages/agent-cli/bin/robota.js init` in a temp dir prints the init flow
      ("project initialization" header) and exits without launching the TUI
- [x] TC-02: `node packages/agent-cli/bin/robota.js diagnose` prints the 6-check diagnostic
      report (Node.js version / robota version / API key / Settings file / Terminal / Network
      lines) and exits without launching the TUI
- [x] TC-03: with the onboarded marker absent, TUI startup path calls
      `printFirstRunWelcome` + `markOnboarded` (unit-verified); with marker present, neither is called
- [x] TC-04: with `platform=darwin` and `TERM_PROGRAM=Apple_Terminal`, TUI startup emits the
      Terminal.app warning via the injected terminal; with `TERM_PROGRAM=iTerm.app`, no warning
- [x] TC-05: `rg -n "preflight" packages/agent-cli/docs/SPEC.md` exits non-zero (no stale refs),
      and SPEC.md no longer claims `--system-prompt` is unconnected
- [x] TC-06: `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`
      exit 0 with the new dispatch/startup tests included

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                                   | Notes                                                                                                                                                                                                           |
| ----- | ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | E2E        | built bin 실행 (`node bin/robota.js init`) + stdout 검증          | TTY 프롬프트는 `--yes`로 비대화 경로 사용. Test skipped (automated): E2E manual evidence recorded in `[GATE-COMPLETE: TC-01]`; dispatch covered by build + run, init internals by existing `init-command` tests |
| TC-02 | E2E + unit | built bin 실행 + `diagnose-command.test.ts` (체크 함수 단위 검증) | Test: `packages/agent-cli/src/startup/__tests__/diagnose-command.test.ts` > "TC-02: prints all six diagnostic check labels and a summary line"                                                                  |
| TC-03 | unit       | vitest — first-run 게이팅 로직 (marker 존재/부재 → 호출 여부)     | 마커 경로는 tmp HOME으로 격리. Test: `packages/agent-cli/src/startup/__tests__/first-run.test.ts` > "TC-03: isFirstRun is true without marker and false after markOnboarded"                                    |
| TC-04 | unit       | vitest — terminal-check (`TERM_PROGRAM` 매트릭스 → 출력 여부)     | `process.platform` mock. Test: `packages/agent-cli/src/startup/__tests__/terminal-check.test.ts` > 3 cases (darwin+Apple_Terminal warns, darwin+iTerm silent, linux silent)                                     |
| TC-05 | static     | `rg` 검사 — SPEC.md 내 preflight/미연결 주석 부재                 | Test skipped: documentation criterion — static `rg` check only, no unit test applicable (evidence in `[GATE-COMPLETE: TC-05]`)                                                                                  |
| TC-06 | build/test | `pnpm --filter @robota-sdk/agent-cli build && … test`             | Test: full suite run — `pnpm --filter @robota-sdk/agent-cli build && … test`, exit 0 (evidence in `[GATE-COMPLETE: TC-06]`)                                                                                     |

## Tasks

- Tasks file: `.agents/tasks/completed/CLI-049.md` (8 tasks T1–T8, all complete, archived 2026-06-10)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-10

**Status upgrade:** draft → review-ready

- Frontmatter: YAML block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli, typescript]` present.
- Problem: 4 concrete symptoms with specific commands/outputs (init falls through to TUI, diagnose missing, first-run welcome dead, Terminal.app warning dead), each with an explicit reproduction condition; no TBD/TODO or vague single-sentence text.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (existing cli.ts positional/flag branch patterns identified, TUI-path-only placement noted).
- Alternatives Considered: 3 entries (A preflight restore / B inline dispatch / C command modules), each with pro and con.
- Decision: adopts B and explicitly references the driving trade-off (single dispatch table vs. ~20-line cli.ts growth).
- Completion Criteria: 6 items, all TC-N prefixed (TC-01–TC-06); each uses Command form or Observable behavior form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly" absent).
- Test Plan: section present; 6 rows — TC-N count matches Completion Criteria (6 = 6); every row has non-empty Test Type and Tool/Approach; no "TBD"; no rows with Tool "manual", so manual-justification Notes requirement is N/A.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present and empty at gate run; no `## Status` or `## Classification` sections in body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-10

**Status upgrade:** review-ready → approved

- Explicit approval present: after being presented the 14 audit backlog items (CLI-049~CLI-062) covering exactly this spec's scope, the user stated verbatim on 2026-06-10: "cjk 관련된 것 빼고 나머지 모두 진행해줘. pr을 올리면서 머지하며 작업해줘. feature 브랜치 -> develop -> main" — a direct "진행해줘" authorization, not a clarifying-question answer or silence.
- Approval directed at this spec: the spec covers backlog CLI-049/050/051/052/056. The CJK exclusion maps to CLI-061 (Korean IME last-character drop) and CLI-062 (CJK cursor positioning) — both CJK input-behavior items in `packages/agent-transport`. CLI-052 is a startup call-site restoration in `packages/agent-cli` (same dead-dispatch cluster as 049/050/051); its warning text mentions CJK but the work is wiring restoration, so all five items fall inside "나머지 모두" (everything else).
- No Architecture Review or frontmatter type/tags modified after approval: last Evidence Log entry before this gate is GATE-WRITE (same date); spec document content unchanged since approval per caller confirmation; frontmatter remains `type: BEHAVIOR`, `tags: [cli, typescript]`.
- NON-COMPLIANCE trigger checked — not fired: `git status` shows no `packages/agent-cli` source modifications, no implementation commits, and `.agents/tasks/CLI-049.md` does not exist yet (correctly deferred to GATE-IMPLEMENT). Working tree changes are documentation only (.agents/backlog files, this spec, evals lessons).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-10

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-049.md` exists with 8 tasks — T1 (TC-02: restore diagnose-command.ts + unit tests), T2 (TC-01: init positional dispatch), T3 (TC-02: diagnose positional dispatch), T4 (TC-03: first-run welcome wiring + tests), T5 (TC-04: terminal-check wiring + tests), T6 (TC-05: SPEC.md sync), T7 (TC-06: build + test green, local CI), T8 (audit backlog files commit + evidence).
- Tasks file path recorded in `## Tasks` section: placeholder replaced with `.agents/tasks/CLI-049.md` reference at this gate run.
- Task ↔ Completion Criteria coverage: every TC-N has at least one task — TC-01→T2, TC-02→T1/T3, TC-03→T4, TC-04→T5, TC-05→T6, TC-06→T7 (6/6 covered; T8 is supplementary documentation payload).
- NON-COMPLIANCE trigger checked — not fired: `git log` shows no implementation commits since approval (HEAD `05beb9f2e` is evals housekeeping); `git status` shows no `packages/agent-cli` source changes; tasks file exists before any implementation work.
- Note: tasks file header references the spec at `.agents/spec-docs/active/` while the document currently resides in `todo/` — anticipates the in-progress stage move performed by the pipeline; not a gate criterion.

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-10

**Command:** `node packages/agent-cli/bin/robota.cjs init --yes` in a fresh mktemp dir
**Observed:** printed "robota project initialization" header, "Created: .robota/settings.json", "Created: AGENTS.md", "Initialization complete." — exited without TUI, exit code 0. Both files verified present afterwards.
**Test:** E2E run above; dispatch path covered by build + manual run (init flow internals covered by existing `init-command` tests).

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-10

**Command:** `node packages/agent-cli/bin/robota.cjs diagnose` in a fresh mktemp dir
**Observed:** printed "robota diagnose" report with all six labels (Node.js version v24.13.0 ✓, robota version 3.0.0-beta.73 ✓, API key ✗ no key, Settings file ✓ global, Terminal ⚠ Apple_Terminal, Network api.anthropic.com reachable 15ms ✓) and summary "✗ 1 issue(s) found." — exited without TUI, exit code 0.
**Test:** `packages/agent-cli/src/startup/__tests__/diagnose-command.test.ts` > "TC-02: prints all six diagnostic check labels and a summary line" (network check injected via `IDiagnoseDependencies`).

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-10

**Command:** fresh `HOME`, valid provider settings, `TERM_PROGRAM=Apple_Terminal`, run `robota` (TUI); then re-run with marker present.
**Observed:** first run printed the boxed "Welcome to robota!" banner before the TUI logo and created `$HOME/.robota/onboarded`; second run printed no banner (`grep -c "Welcome to"` → 0).
**Test:** `packages/agent-cli/src/startup/__tests__/first-run.test.ts` > "TC-03: isFirstRun is true without marker and false after markOnboarded" + banner content test.

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-10

**Command:** same TUI runs as TC-03 with `TERM_PROGRAM=Apple_Terminal` vs `TERM_PROGRAM=iTerm.app`.
**Observed:** Apple_Terminal run printed "⚠ macOS Terminal.app detected: CJK/IME input may be unstable." before the TUI; iTerm run printed neither warning nor banner (grep count 0). The duplicate unconditional warning in `bin/robota.cjs` was removed so the warning now appears once, only in the TUI path (diagnose/init/print runs are clean).
**Test:** `packages/agent-cli/src/startup/__tests__/terminal-check.test.ts` > 3 cases (darwin+Apple_Terminal warns, darwin+iTerm silent, linux silent).

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-10

**Command:** `rg -n "preflight" packages/agent-cli/docs/SPEC.md`
**Observed:** exit code 1 (no matches). Stale rows for args-to-options/config-phase/provider-setup/session-setup/update-notice also removed; `--system-prompt` note now describes the actual print-mode wiring via `HeadlessInteractionChannel` (CLI-027).
**Test:** static check (rg), recorded here — documentation criterion, no unit test applicable.

### [GATE-COMPLETE: TC-06] — ✅ | 2026-06-10

**Command:** `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli typecheck && pnpm --filter @robota-sdk/agent-cli lint && pnpm --filter @robota-sdk/agent-cli test`
**Observed:** build complete (4 files, 109.21 kB), typecheck 0 errors, lint 0 errors (28 pre-existing warnings), Test Files 10 passed, Tests 93 passed. Note: the package build script was broken on develop (`@robota-sdk/agent-web` stale name after the agent-web-ui rename); fixed in `package.json` build script + `scripts/copy-web-assets.mjs` as part of this work.
**Test:** full suite run above; exit code 0.

### [GATE-VERIFY] — ✅ PASS | 2026-06-10

**Status upgrade:** in-progress → verifying

- Tasks file completion: tasks file located at archived path `.agents/tasks/completed/CLI-049.md` (already archived per `## Tasks` section; original path `.agents/tasks/CLI-049.md` superseded) — all 8 tasks T1–T8 marked `[x]`.
- No blocked or pending tasks: 8/8 checked, no blocked/pending markers or open notes in the tasks file.
- Build passes for affected package: `pnpm --filter @robota-sdk/agent-cli build` → "Build complete" (ESM 4 files, total 109.21 kB), exit code 0. Scope note: only agent-cli is affected per `## Affected Files`; repo-wide build not required for this gate.
- Tests pass for affected package: `pnpm --filter @robota-sdk/agent-cli test` → Test Files 10 passed (10), Tests 93 passed (93), exit code 0.
- Observation (non-blocking): GATE-COMPLETE TC-01–TC-06 evidence entries were recorded ahead of this gate; status remained `in-progress` so no status upgrade was bypassed — final GATE-COMPLETE pass still pending.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-10

**Status upgrade:** verifying → done

- Completion Criteria checkboxes: all 6 TC-N items (TC-01–TC-06) are `[x]` — verified in `## Completion Criteria`.
- Per-TC evidence entries: `[GATE-COMPLETE: TC-01]` through `[GATE-COMPLETE: TC-06]` all present in Evidence Log, each with the exact command, observed output, and exit code where applicable (TC-01 exit 0, TC-02 exit 0, TC-05 rg exit 1 = expected non-zero, TC-06 exit 0).
- Test Plan coverage: every TC-N row now carries a test reference or explicit skip reason in Notes — TC-01 skip (manual E2E evidence; dispatch covered by build+run, init internals by existing init-command tests), TC-02 `diagnose-command.test.ts` > "TC-02: prints all six diagnostic check labels and a summary line" (verified present, line 10), TC-03 `first-run.test.ts` > "TC-03: isFirstRun is true without marker and false after markOnboarded" (verified present, line 19), TC-04 `terminal-check.test.ts` > 3 cases (verified: 3 `it(` blocks), TC-05 skip (documentation criterion, static rg check only), TC-06 full suite run exit 0. No TC-N silently unaddressed.
- TC-05 independently re-verified by this guard: `rg -n "preflight" packages/agent-cli/docs/SPEC.md` → exit 1 (no matches).
- Tasks file archived: `.agents/tasks/completed/CLI-049.md` exists (8/8 tasks `[x]`, 0 unchecked); original `.agents/tasks/CLI-049.md` no longer exists.
- `## Tasks` section reflects archived path: references `.agents/tasks/completed/CLI-049.md` (8 tasks T1–T8, all complete, archived 2026-06-10).
