---
status: done
type: FLOW
tags: [cli, typescript]
---

# CLI-065: `init --yes` must complete non-interactively

## Problem

Reproduced 2026-06-11 on npm-installed `3.0.0-beta.73` (product verification L1, non-TTY
stdin):

- In a directory with `.claude/`: `robota init --yes` still fires the migration prompt and
  dies with `Cannot prompt for input: stdin is not a TTY`, followed by unrelated guidance
  ("Set your API key via environment variable instead: ANTHROPIC_API_KEY=<key> robota").
- With existing `AGENTS.md` + `.robota/settings.json`: the overwrite prompt fires the same
  way (exit 1).

SPEC (`packages/agent-cli/docs/SPEC.md:1021`) promises prompts are skipped when "`--yes`
flag or `CI=true` environment is detected", and `IInitOptions.yes` JSDoc says "Skip all Y/n
prompts and use defaults". Root cause: `askYesNo` call sites at
`src/init/init-command.ts:95` (overwrite) and `:107` (migration) never consult
`options.yes`; only the provider-setup prompt (line 152) checks `yes`/CI.

## Architecture Review

### Affected Scope

- `packages/agent-cli` / `src/init/init-command.ts` — gate all three prompts on
  `options.yes` / `CI=true`; pre-check TTY before prompting with a question-specific error
- `packages/agent-cli` / `src/init/__tests__/` — prompt-matrix unit tests
- `packages/agent-cli` / `docs/SPEC.md` — init non-interactive contract (defaults per prompt)

### Alternatives Considered

1. **Gate each `askYesNo` call site on `yes`/CI and apply the documented default answer
   (chosen).**
   - Pro: matches the existing JSDoc contract verbatim ("use defaults"); defaults are safe —
     overwrite=N preserves existing files (idempotent re-run prints "Init cancelled."),
     migrate=N produces the plain template; smallest correct change.
   - Con: `--yes` does not mean "answer yes to everything" — must be documented clearly to
     avoid surprise (it means "non-interactive with defaults").
2. **`--yes` answers literal yes to every prompt.**
   - Pro: matches the flag's common connotation.
   - Con: makes `init --yes` destructive (silently overwrites existing AGENTS.md/settings) —
     violates the safe-by-default expectation for a scaffolding command and contradicts the
     existing JSDoc.
3. **Replace prompts with flags (`--overwrite`, `--migrate`).**
   - Pro: maximal explicitness.
   - Con: new surface area for a rare path; still needs the `--yes` semantics fix anyway.

### Decision

Alternative 1. A central `confirm(question, { defaultAnswer })` helper inside init-command
resolves: `yes`/CI → return default without prompting; non-TTY without `yes` → throw a typed
error naming the question (no API-key guidance); TTY → prompt as today. Defaults: overwrite
N, migrate N, provider-setup N (existing behavior preserved).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — agent-cli 내 promptInput 사용처 전수: init-command(본 결함),
      configure 플로우(대화식 전제 — TTY 요구가 정당, API-key 안내도 그 맥락에선 적절),
      session picker(TUI 전용) — init만 수정 대상
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Add a private `confirm(question: string, defaultAnswer: boolean)` in init-command.ts:
   - `options.yes === true || process.env['CI'] === 'true'` → log the auto-answer
     (`"<question> → <Y/N> (--yes)"`) and return `defaultAnswer`.
   - stdin not a TTY → throw `InitPromptUnavailableError` with the question text; caller
     prints `Cannot ask "<question>" in a non-interactive shell. Re-run with --yes to accept
defaults.` and exits 1.
   - otherwise → `askYesNo` as today.
2. Route all three call sites (overwrite :95, migrate :107, provider setup :152) through it;
   delete the ad-hoc `isCI && !options.yes` special-case.
3. SPEC: init section documents the per-prompt defaults and `--yes`/CI semantics.

_Correction during implementation (within the approved Decision): the provider-setup prompt
is an optional trailing step that fires after init has already completed — throwing
`InitPromptUnavailableError` there would exit 1 on an init that succeeded (files created).
Non-TTY without `--yes` therefore skips that one prompt (default N, same outcome as the
documented default) instead of erroring; the overwrite and migration prompts keep the strict
typed-error behavior exactly as specified. Documented in the SPEC table and covered by a
dedicated test._

## Affected Files

- `packages/agent-cli/src/init/init-command.ts`
- `packages/agent-cli/src/init/__tests__/init-command.test.ts`
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `runInitCommand` with `yes: true`, existing AGENTS.md+settings → no prompt
      function invoked, output contains "Init cancelled.", files byte-identical, resolves
      without error
- [x] TC-02: `runInitCommand` with `yes: true`, `.claude/` present, no existing files →
      migration skipped (default N), `.robota/settings.json` created from plain template,
      resolves without error
- [x] TC-03: `CI=true` (no `yes`) behaves identically to TC-01/TC-02 paths
- [x] TC-04: non-TTY stdin, no `yes`, prompt required → error message contains the question
      text and `Re-run with --yes`; no "API key" text; CLI exits 1
- [x] TC-05: TTY + no `yes` → prompts fire exactly as before (regression on interactive path)
- [x] TC-06: SPEC.md init section documents per-prompt defaults and `--yes`/CI semantics

## Test Plan

Derived strategy (FLOW + cli): process integration test; prompt matrix via unit tests with
injected prompt/TTY state.

| TC-ID | Test Type | Tool / Approach                                            | Notes                            | Test reference / skip reason                                                                                                                                           |
| ----- | --------- | ---------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit      | vitest — runInitCommand with temp dir + mock terminal      | prompt spy asserts zero calls    | `packages/agent-cli/src/init/__tests__/init-command.test.ts` > `TC-01: yes + existing files → no prompt, "Init cancelled.", files untouched`                           |
| TC-02 | unit      | vitest — temp dir with .claude fixture                     |                                  | same file > `TC-02: yes + .claude present in clean dir → migration skipped, plain template written`                                                                    |
| TC-03 | unit      | vitest — CI env injected (stub via parameter, not stubEnv) | worker-thread env gotcha applies | same file > `TC-03: CI=true behaves like --yes (defaults, no prompts)`                                                                                                 |
| TC-04 | unit      | vitest — injected non-TTY state, assert error text         |                                  | same file > `TC-04: non-TTY without yes → error names the question and suggests --yes`                                                                                 |
| TC-05 | unit      | vitest — injected TTY state with scripted prompt answers   |                                  | same file > `TC-05: TTY without yes → prompts fire as before (interactive regression)` and `TC-05: TTY overwrite y + migrate n imports nothing and recreates files`    |
| TC-06 | manual    | SPEC.md diff review                                        | doc change — reviewed in PR diff | Test skipped: doc-only change, no executable surface — verified by direct review of `packages/agent-cli/docs/SPEC.md` "Non-interactive semantics" table (PR #699 diff) |

## Tasks

- [x] `.agents/tasks/completed/CLI-065.md` — archived at GATE-COMPLETE (T1~T7 all done, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: FLOW` is one of the 11 allowed values; `tags: [cli, typescript]` present.
- Problem: concrete symptom present (`robota init --yes` fires migration/overwrite prompts and dies with `Cannot prompt for input: stdin is not a TTY`, exit 1); reproduction condition present (npm-installed 3.0.0-beta.73, non-TTY stdin, dir with `.claude/` or existing AGENTS.md+settings); root cause cited with file:line; no TBD/TODO or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (promptInput call-site enumeration: init-command, configure flow, session picker — init only); Alternatives Considered has 3 entries, each with pro and con; Decision selects Alternative 1 and references the driving trade-off (safe defaults / existing behavior preserved vs. destructive literal-yes).
- Completion Criteria: 6 items, all TC-N prefixed (TC-01..TC-06); each uses command or observable-behavior form (specific inputs, outputs, exit codes, file states); no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") used as criteria.
- Test Plan: section present; 6 rows match 6 TC-N entries (count matches); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-06) has a non-empty Notes entry explaining why ("doc change — reviewed in PR diff").
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` present and empty before this entry (first GATE-WRITE run); no `## Status` or `## Classification` sections in the body.
- TC-N count confirmed: Completion Criteria 6 = Test Plan 6.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied "승인함" (verbatim) on 2026-06-11 in response to the design-summary message "## 설계안 요약 (승인 요청)" covering CLI-063/064/065/066.
- Direct, unambiguous, directed at this spec: the summary explicitly presented CLI-065's key decision — `--yes` = "skip prompts and apply documented defaults" (not "answer yes to everything"), overwrite default N (idempotent "Init cancelled." exit 0 on re-run), migration default N, question-naming error for non-TTY prompts without `--yes` — and flagged it as "의미론 결정 포함"; the message asked for approval of all 4 items ("4건 승인해 주시면 GATE-APPROVAL → 구현(TDD) → PR 순서로 진행합니다") and "승인함" approved all four including this one, given after the spec content was authored and summarized.
- No post-approval modification: Architecture Review section and frontmatter `type: FLOW` / `tags: [cli, typescript]` unchanged since GATE-WRITE; no edits to the spec between approval and this gate run.
- No premature implementation: `.agents/tasks/CLI-065.md` does not exist; `git status` shows no changes under `packages/agent-cli/` — no implementation work started before this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-12

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-065.md` exists with tasks T1–T7 (T1–T6 implementation/test tasks, T7 build/lint/test + PR wrap-up).
- Tasks file path recorded in spec: `## Tasks` section references `.agents/tasks/CLI-065.md` with the T1~T7 / TC-01~TC-06 mapping note.
- Task-to-criteria correspondence: one task per TC-N — T1→TC-01 (yes:true + existing files, no prompt, "Init cancelled."), T2→TC-02 (yes:true + .claude, migration default N), T3→TC-03 (CI=true parity), T4→TC-04 (non-TTY error contract), T5→TC-05 (interactive TTY regression), T6→TC-06 (SPEC.md doc update); all 6 Completion Criteria covered.
- NON-COMPLIANCE check (no implementation before tasks file): `git status --porcelain -- packages/agent-cli/` is clean; last commit touching `src/init/init-command.ts` is 78d27a47a (2026-05-25), prior to spec approval (2026-06-11) — no implementation commits exist for this item.

### [GATE-VERIFY] — ✅ PASS | 2026-06-12

**Status upgrade:** in-progress → verifying

- Tasks complete: `.agents/tasks/CLI-065.md` T1–T6 all `[x]`. T7 (wrap-up: build/typecheck/lint/test green + PR to develop + backlog evidence) is unchecked pending merge, but every component of T7's text was independently verified: PR #699 OPEN (`feat/cli-065-init-yes` → `develop`, title "fix(cli): init --yes completes non-interactively with documented defaults (CLI-065)"); backlog evidence recorded in `.agents/backlog/completed/CLI-065-init-yes-ignores-prompts.md` (status: done, real-binary non-TTY evidence dated 2026-06-12); build/typecheck/lint/test green (below). Merge itself happens after gates — same interpretation accepted in the CLI-063/064 GATE-VERIFY runs.
- No tasks blocked or pending: T1–T6 done; T7 substance satisfied as above; nothing blocked.
- Build passes: `pnpm --filter @robota-sdk/agent-cli build` → "Build complete in 672ms" (only affected package per Affected Files).
- Tests pass: `pnpm --filter @robota-sdk/agent-cli test -- --run src/init/__tests__/init-command.test.ts` → 8/8 passed; full suite `pnpm --filter @robota-sdk/agent-cli test` → 14 files / 127 tests passed. `pnpm typecheck` (agent-cli) → 0 errors; `pnpm lint` → 0 errors (30 warnings).
- Implementation matches approved Decision: unified `confirm(question, defaultAnswer, ctx)` helper in `src/init/init-command.ts` (yes/CI → log auto-answer + return default; non-TTY → throw exported `InitPromptUnavailableError` with message `Cannot ask "<question>" in a non-interactive shell. Re-run with --yes to accept the defaults.`; TTY → prompt); all three call sites routed through it; `cli.ts:121-125` init dispatch catches and exits 1 printing the message (no API-key text).
- In-Decision correction verified within bounds: provider-setup prompt on non-TTY without `--yes` skips with default N instead of throwing — outcome identical to the approved default (N), applies only to the optional trailing step that fires after init already completed (guard at init-command.ts:205), the two pre-completion prompts (overwrite, migrate) keep the strict typed-error behavior exactly as specified; documented in spec ## Solution and in the SPEC.md table; covered by dedicated test "provider setup prompt skips with a notice on non-TTY instead of failing a completed init".
- TC-06 spot-check: `packages/agent-cli/docs/SPEC.md` "robota init" section contains the "Non-interactive semantics" table (lines ~1044-1054) with per-prompt Default / `--yes` or `CI=true` / non-TTY columns and the "`--yes` means non-interactive with documented defaults, NOT answer-yes-to-everything" clarification.
- Test-to-criteria mapping confirmed in `src/init/__tests__/init-command.test.ts`: TC-01 through TC-05 test names present (TC-05 has two variants) plus two provider-setup default-N cases — 8 tests total.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-12

- Command: `pnpm --filter @robota-sdk/agent-cli test -- --run src/init/__tests__/init-command.test.ts` (fresh run by GATE-COMPLETE guard)
- Output: `✓ src/init/__tests__/init-command.test.ts (8 tests)` — `Test Files 1 passed (1)`, `Tests 8 passed (8)`; exit code 0.
- Test reference: `packages/agent-cli/src/init/__tests__/init-command.test.ts` > `TC-01: yes + existing files → no prompt, "Init cancelled.", files untouched` (passed in the run above).
- Real-binary corroboration: `.agents/backlog/completed/CLI-065-init-yes-ignores-prompts.md` records `robota init --yes` re-run with existing files → exit 0, `Overwrite existing files? → N`, executed 2026-06-12 against the fixed build.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-12

- Command: same fresh test run as TC-01 (`pnpm --filter @robota-sdk/agent-cli test -- --run src/init/__tests__/init-command.test.ts`), 8/8 passed, exit 0.
- Test reference: same file > `TC-02: yes + .claude present in clean dir → migration skipped, plain template written` (passed).
- Real-binary corroboration: backlog evidence — `robota init --yes` in clean dir + `.claude/` → exit 0, migration prompt auto-answered N, plain-template `.robota/settings.json` created.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-12

- Command: same fresh test run, 8/8 passed, exit 0.
- Test reference: same file > `TC-03: CI=true behaves like --yes (defaults, no prompts)` (passed; CI env injected via parameter per Test Plan note).

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-12

- Command: same fresh test run, 8/8 passed, exit 0.
- Test reference: same file > `TC-04: non-TTY without yes → error names the question and suggests --yes` (passed; asserts question text + `Re-run with --yes`, no API-key text).
- Exit-1 path: `cli.ts` init dispatch catches `InitPromptUnavailableError` and exits 1 (verified at GATE-VERIFY, cli.ts:121-125); real-binary corroboration in backlog evidence — `robota init` without `--yes`, files exist, non-TTY → exit 1 with `Cannot ask "Overwrite existing files?" ...` message.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-12

- Command: same fresh test run, 8/8 passed, exit 0.
- Test references: same file > `TC-05: TTY without yes → prompts fire as before (interactive regression)` and `TC-05: TTY overwrite y + migrate n imports nothing and recreates files` (both passed).

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-12

- Action: direct read of `packages/agent-cli/docs/SPEC.md` (`grep -n -A 20 "Non-interactive semantics"`), fresh at this gate run.
- Result observed: "Non-interactive semantics" table at SPEC.md lines 1044-1054 with one row per prompt (overwrite, migrate, provider-setup), columns Default / `With --yes or CI=true` / `Non-TTY without --yes`, plus the clarification "`--yes` means \"non-interactive with documented defaults\", NOT \"answer yes to everything\"" and the no-API-key-text note.
- Test skipped (per Test Plan): doc-only change with no executable surface — verified by direct review; included in PR #699 diff.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-12

**Status upgrade:** verifying → done

- Completion Criteria: TC-01..TC-06 all verified above with fresh evidence and checked `[x]` (6/6).
- Test Plan: every TC-N row now carries a test reference (TC-01..TC-05, with TC-05 covering two test variants) or an explicit skip reason (TC-06 manual doc review) — no TC-N silently unaddressed.
- Fresh verification run: `pnpm --filter @robota-sdk/agent-cli test -- --run src/init/__tests__/init-command.test.ts` → 8/8 passed, exit 0 (2026-06-12).
- Tasks file archived: `.agents/tasks/CLI-065.md` → `.agents/tasks/completed/CLI-065.md` (T1–T7 all `[x]`; T7 components — build/typecheck/lint/test green, PR #699 to develop with green CI, backlog evidence in `.agents/backlog/completed/CLI-065-init-yes-ignores-prompts.md` status done — verified at GATE-VERIFY and re-confirmed here).
- `## Tasks` section updated to reference the archived path.
- PR #699 CI green (build pass, quality pass; Cloudflare Pages preview failure is the known non-blocking docs-preview check).
