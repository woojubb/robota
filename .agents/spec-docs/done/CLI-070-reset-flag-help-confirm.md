---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-070: `--reset` documented in help and guarded by confirmation

## Problem

Verified 2026-06-11 (L1, npm-installed `3.0.0-beta.73`): `robota --reset` exists (parsed at
`packages/agent-cli/src/utils/cli-args.ts:161`, dispatched at `src/cli.ts:85-88` via
`runResetConfig`, which deletes `~/.robota/settings.json` —
`src/startup/reset-config.ts:4-11`), but:

- `printHelp` (`cli-args.ts:57-101`) never mentions `--reset` — an undocumented destructive
  flag (`robota --help | grep reset` → no output).
- It deletes the user's provider configuration immediately: no confirmation prompt in a TTY,
  no `--yes` requirement in non-TTY. `robota --reset < /dev/null` silently destroys config.

## Architecture Review

### Affected Scope

- `packages/agent-cli` / `src/utils/cli-args.ts` — `printHelp` entry for `--reset` (and
  `--yes` interaction)
- `packages/agent-cli` / `src/startup/reset-config.ts` — confirmation matrix
  (TTY × `--yes`)
- `packages/agent-cli` / `src/cli.ts` — dispatch passes `yes` + TTY state; non-zero exit on
  refusal
- `packages/agent-cli` / `docs/SPEC.md` — flag table + destructive-action contract

### Alternatives Considered

1. **Confirmation matrix: TTY → y/N prompt (skippable with `--yes`); non-TTY → require
   `--yes`, otherwise refuse with exit 1 (chosen).**
   - Pro: safe by default in both modes; scriptable deliberately (`--yes`); matches the
     industry convention for destructive CLI flags; reuses the existing `--yes` flag
     (CLI-065).
   - Con: a breaking change for anyone scripting bare `--reset` — acceptable (unreleased
     project, and the old behavior is the hazard being removed).
2. **Trash/backup instead of delete (rename to `settings.json.bak`), no confirmation.**
   - Pro: recoverable without prompting.
   - Con: accumulates stale backups; "reset" that secretly keeps state contradicts the
     flag's contract; user still loses the active config without consenting.
3. **Remove `--reset` entirely.**
   - Pro: no destructive surface.
   - Con: the recovery path for corrupt/broken settings (see CLI-069 guidance) legitimately
     needs it; `robota --configure` re-setup flows reference starting clean.

### Decision

Alternative 1. The driving trade-off is safety vs scriptability: the matrix gives both —
interactive users get an explicit y/N naming the exact file to be deleted, scripts must opt
in with `--yes`. Refusal (non-TTY without `--yes`, or `n` answer) exits 1 and leaves the
file untouched.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `printHelp`의 기존 플래그 표기 형식(플래그/설명 2열) 확인,
      `--yes`는 CLI-065에서 파싱 존재 확인(`cli-args.ts`), 다른 파괴적 플래그 부재 확인
      (이 매트릭스가 첫 destructive-action 계약 — SPEC에 일반 계약으로 기록), TTY 판정은
      기존 init 비대화 판정(`process.stdin.isTTY`)과 동일 기준 재사용
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `printHelp`: add `--reset` row — `Delete ~/.robota/settings.json (provider profiles and
preferences). Asks for confirmation; use --yes to skip.`
2. `runResetConfig(options)`: receives `{ yes: boolean, isTTY: boolean, confirm? }`
   (confirm prompt injected for tests). Matrix: `yes` → delete; TTY+!yes → prompt
   `Delete <path>? [y/N]` (default N); !TTY+!yes → stderr refusal naming `--yes`, exit 1,
   no deletion.
3. `cli.ts` dispatch wires `--yes` + `process.stdin.isTTY` and maps refusal to exit 1.
4. SPEC: flag table + destructive-action confirmation contract.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/reset-config.ts`
- `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` (new or extended)
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `robota --help` output contains `--reset` with a description naming exactly
      what is deleted (help-content test, extends the flag-wiring guard family)
- [x] TC-02: non-TTY without `--yes` → refusal message naming `--yes`, exit 1, settings file
      still present
- [x] TC-03: `--reset --yes` → file deleted without any prompt, exit 0
- [x] TC-04: TTY prompt answered `n` (injected confirm) → no deletion, exit 1; answered `y`
      → deletion, exit 0
- [x] TC-05: `--reset` with no settings file present → reports nothing to delete, exit 0
      (no error on already-clean state)
- [x] TC-06: CLI SPEC.md documents the flag and the confirmation matrix

## Test Plan

| TC-ID | Test Type | Tool / Approach                                        | Notes                                                                                                                                                                                                  |
| ----- | --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | unit      | vitest — printHelp output assertion                    | Test: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > `TC-01: --help documents --reset with what it deletes and the --yes skip`            |
| TC-02 | unit      | vitest — `isTTY: false, yes: false`, temp HOME fixture | Test: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > `TC-02: non-TTY without --yes refuses, exits 1, file untouched`                      |
| TC-03 | unit      | vitest — `yes: true`, temp HOME fixture                | Test: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > `TC-03: --yes deletes without any prompt and exits 0`                                |
| TC-04 | unit      | vitest — injected confirm returning n / y              | Test: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > `TC-04: TTY prompt — n aborts with exit 1 and keeps the file; y deletes with exit 0` |
| TC-05 | unit      | vitest — empty temp HOME                               | Test: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > `TC-05: no settings file present reports nothing to delete and exits 0`              |
| TC-06 | manual    | SPEC.md diff review                                    | Test skipped: doc prose, not automatable — verified by direct read at GATE-COMPLETE (`packages/agent-cli/docs/SPEC.md:1041-1056`, "Destructive-action contract (CLI-070)" matrix)                      |

## Tasks

- [x] `.agents/tasks/completed/CLI-070.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` (valid, from 11-prefix list); `tags: [cli, typescript]` present.
- Problem — concrete symptom: `robota --help | grep reset` → no output, and `robota --reset < /dev/null` silently deletes `~/.robota/settings.json`; code locations cited (`cli-args.ts:161`, `cli.ts:85-88`, `reset-config.ts:4-11`).
- Problem — reproduction condition: verified 2026-06-11 on npm-installed `3.0.0-beta.73`, non-TTY stdin; no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (printHelp 2-column format, `--yes` parsing from CLI-065, no other destructive flags, TTY check reuses `process.stdin.isTTY`).
- Alternatives Considered: 3 entries (confirmation matrix / backup-rename / remove flag), each with explicit pro and con.
- Decision: references the driving trade-off (safety vs scriptability) and selects Alternative 1.
- Completion Criteria: 6 items, all prefixed TC-01..TC-06; each uses command form or observable behavior (exit codes, file presence, output content); no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly").
- Test Plan: section present; 6 rows match 6 TC-N criteria (count 6 = 6); every row has non-empty Test Type and Tool/Approach, no "TBD"; sole manual row (TC-06) has Notes explaining non-automatability (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` present with placeholder (`.agents/tasks/CLI-070.md` — to be created after GATE-APPROVAL); `## Evidence Log` present and empty before this first run; no `## Status` or `## Classification` sections in body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" (2026-06-13) to the consolidated design-approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건", after being told verbatim that replying "승인함" authorizes implementation of the 11 designs.
- Approval directed at this spec: the approval request individually summarized CLI-070's design (`--reset` added to help; confirmation matrix — TTY y/N prompt skippable with `--yes`, non-TTY without `--yes` refuses with exit 1 and leaves the file untouched), so "승인함" unambiguously covers this document. The earlier release instruction ("머지하고 main 릴리스 진행해줘") was correctly not treated as design approval; the answer to "그래서 뭐?" was a clarification, not the approval itself.
- No Architecture Review or frontmatter type/tags modified after approval: `git log` for this file shows only commit cd5b1053a (GATE-WRITE batch, pre-approval); post-GATE-WRITE changes were limited to the guard's Evidence Log entry, the draft → review-ready status upgrade, and prettier formatting; working tree clean for this file.
- NON-COMPLIANCE trigger not present: `.agents/tasks/CLI-070.md` does not exist (verified by ls), no uncommitted changes under `packages/agent-cli`, and the latest `packages/agent-cli/src` commits (CLI-074 #703, DEPS-001 #702, CLI-066 #700) belong to other specs — no implementation work for CLI-070 has started.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-070.md` exists on branch `feat/cli-070-reset-confirm` (read in full; references the spec as Test Plan SSOT).
- Tasks file path recorded in `## Tasks`: spec's Tasks section lists `.agents/tasks/CLI-070.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up).
- Tasks ↔ Completion Criteria correspondence (≥ one task per TC-N): T1→TC-01 (printHelp lists `--reset`), T2→TC-02 (non-TTY refusal, exit 1, file intact), T3→TC-03 (`--yes` deletion, exit 0), T4→TC-04 (injected confirm n/y branches), T5→TC-05 (idempotent clean state, exit 0), T6→TC-06 (SPEC.md flag + confirmation matrix); T7 is wrap-up (test/typecheck/lint/build, PR, evidence + archive) — all 6 TC-N covered.
- NON-COMPLIANCE trigger not present: `git status` for `packages/agent-cli` shows no modifications (only the spec move todo/ → active/ and the new tasks file); recent `packages/agent-cli/src` commits (CLI-067 #708, CLI-074 #703, DEPS-001 #702, CLI-066 #700, CLI-065 #699) belong to other specs — no implementation commits precede this tasks file.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-070.md` T1–T6 all `[x]` (verified by direct read). T7 (wrap-up) unchecked but every component independently verified per the established CLI-063..069 GATE-VERIFY interpretation (precedent confirmed by direct read of the CLI-069 done-spec GATE-VERIFY entry): PR #711 OPEN (`gh pr view 711 --json state,headRefName,baseRefName`: state OPEN, head `feat/cli-070-reset-confirm` → base `develop`) with CI green on `gh pr checks 711` — build pass (1m38s), quality pass (37s), security audit pass (7s), Cloudflare Pages pass; compat-node18 and release-grade verification "skipping" (skipped by design on feature PRs); backlog evidence recorded in `.agents/backlog/completed/CLI-070-reset-flag-undocumented.md` (`status: done`, User Execution Test Scenarios Evidence filled: 2026-06-13 real binary `bin/robota.cjs`, isolated HOME via `env -i` — `robota --help | grep -A1 -- --reset` shows the flag naming `~/.robota/settings.json` and the `--yes` skip; `robota --reset < /dev/null` → non-TTY refusal naming `--yes`, exit 1, file still present; `robota --reset --yes` → `Deleted <home>/.robota/settings.json`, exit 0) — met
- No tasks blocked or pending: tasks file contains no blocked markers; only T7 wrap-up remains open as adjudicated above — met
- Build passes for affected package: `pnpm --filter @robota-sdk/agent-cli build` → "Build complete in 679ms" (ESM bundles, no errors) — met
- Tests pass for affected package: `pnpm --filter @robota-sdk/agent-cli test` → 18 files / 145 tests passed, including the new `src/startup/__tests__/reset-config.test.ts` re-run individually → 5/5 passed (TC-01~TC-05: help content, non-TTY refusal, --yes deletion, injected y/N branches, clean state) — met
- Validity: on branch `feat/cli-070-reset-confirm`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications, nothing under `packages/agent-cli` or `.agents/tasks` — build/test evidence reflects the PR #711 head state.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/startup/__tests__/reset-config.test.ts` (cwd `packages/agent-cli`) — exit 0.
- Observed: `✓ --reset confirmation matrix (CLI-070) > TC-01: --help documents --reset with what it deletes and the --yes skip` (verbose reporter), suite 5/5 passed.
- End-to-end corroboration: `.agents/backlog/completed/CLI-070-reset-flag-undocumented.md` evidence — real binary `robota --help | grep -A1 -- --reset` shows `--reset    Delete ~/.robota/settings.json (provider profiles and preferences). Asks for confirmation; use --yes to skip`.
- Test reference recorded in Test Plan: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > TC-01.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/startup/__tests__/reset-config.test.ts` (cwd `packages/agent-cli`) — exit 0.
- Observed: `✓ --reset confirmation matrix (CLI-070) > TC-02: non-TTY without --yes refuses, exits 1, file untouched`.
- End-to-end corroboration: backlog evidence — `robota --reset < /dev/null; echo $?` → refusal message naming `--yes` ("Refusing without confirmation in non-interactive mode — pass --yes to proceed."), exit 1, file still present.
- Test reference recorded in Test Plan: same test file > TC-02.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/startup/__tests__/reset-config.test.ts` (cwd `packages/agent-cli`) — exit 0.
- Observed: `✓ --reset confirmation matrix (CLI-070) > TC-03: --yes deletes without any prompt and exits 0`.
- End-to-end corroboration: backlog evidence — `robota --reset --yes; echo $?` → `Deleted <home>/.robota/settings.json`, exit 0.
- Test reference recorded in Test Plan: same test file > TC-03.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/startup/__tests__/reset-config.test.ts` (cwd `packages/agent-cli`) — exit 0.
- Observed: `✓ --reset confirmation matrix (CLI-070) > TC-04: TTY prompt — n aborts with exit 1 and keeps the file; y deletes with exit 0` (both branches in one test via injected confirm).
- Test reference recorded in Test Plan: same test file > TC-04.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/startup/__tests__/reset-config.test.ts` (cwd `packages/agent-cli`) — exit 0.
- Observed: `✓ --reset confirmation matrix (CLI-070) > TC-05: no settings file present reports nothing to delete and exits 0`.
- Test reference recorded in Test Plan: same test file > TC-05.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in `## Completion Criteria`.
- Action: direct read of `packages/agent-cli/docs/SPEC.md` (manual doc verification per Test Plan).
- Observed: lines 1041-1043 document `robota --reset` deleting `~/.robota/settings.json`; lines 1045-1056 contain the "**Destructive-action contract (CLI-070)**" section with the full 5-row confirmation matrix (no-file → exit 0; TTY+no-yes → y/N prompt, exit 0/1; TTY+yes → delete; non-TTY+no-yes → refuse exit 1; non-TTY+yes → delete exit 0), plus the statement that the matrix is the general contract for destructive CLI flags. `grep -n -- "--reset" docs/SPEC.md` also shows the flag in the inline-flag dispatch list (line 871) and CLI usage example (line 897).
- Skip reason recorded in Test Plan: doc prose, not automatable — verified by direct read.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Completion Criteria: all 6 checkboxes (TC-01..TC-06) are `[x]`, and each has a matching `[GATE-COMPLETE: TC-N]` evidence entry above with exact command, observed output, and exit code.
- Test Plan: all 6 rows updated — TC-01..TC-05 carry exact test references (`packages/agent-cli/src/startup/__tests__/reset-config.test.ts` > `--reset confirmation matrix (CLI-070)` > TC-0N test names, verified against vitest verbose output, 5/5 passed, exit 0); TC-06 carries an explicit skip reason (doc prose, verified by direct read of SPEC.md:1041-1056).
- No TC-N silently unaddressed: every row has either a test reference or a skip reason.
- Tasks file archived: `.agents/tasks/completed/CLI-070.md` exists (T1–T7 all `[x]`, verified by direct read); `.agents/tasks/CLI-070.md` no longer exists (verified by ls).
- `## Tasks` section updated: points at `.agents/tasks/completed/CLI-070.md` (archived path).
