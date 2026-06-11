---
status: in-progress
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

- [ ] TC-01: `runInitCommand` with `yes: true`, existing AGENTS.md+settings → no prompt
      function invoked, output contains "Init cancelled.", files byte-identical, resolves
      without error
- [ ] TC-02: `runInitCommand` with `yes: true`, `.claude/` present, no existing files →
      migration skipped (default N), `.robota/settings.json` created from plain template,
      resolves without error
- [ ] TC-03: `CI=true` (no `yes`) behaves identically to TC-01/TC-02 paths
- [ ] TC-04: non-TTY stdin, no `yes`, prompt required → error message contains the question
      text and `Re-run with --yes`; no "API key" text; CLI exits 1
- [ ] TC-05: TTY + no `yes` → prompts fire exactly as before (regression on interactive path)
- [ ] TC-06: SPEC.md init section documents per-prompt defaults and `--yes`/CI semantics

## Test Plan

Derived strategy (FLOW + cli): process integration test; prompt matrix via unit tests with
injected prompt/TTY state.

| TC-ID | Test Type | Tool / Approach                                            | Notes                            |
| ----- | --------- | ---------------------------------------------------------- | -------------------------------- |
| TC-01 | unit      | vitest — runInitCommand with temp dir + mock terminal      | prompt spy asserts zero calls    |
| TC-02 | unit      | vitest — temp dir with .claude fixture                     |                                  |
| TC-03 | unit      | vitest — CI env injected (stub via parameter, not stubEnv) | worker-thread env gotcha applies |
| TC-04 | unit      | vitest — injected non-TTY state, assert error text         |                                  |
| TC-05 | unit      | vitest — injected TTY state with scripted prompt answers   |                                  |
| TC-06 | manual    | SPEC.md diff review                                        | doc change — reviewed in PR diff |

## Tasks

- [x] `.agents/tasks/CLI-065.md` — 생성 완료 (T1~T7, TC-01~TC-06 매핑)

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
