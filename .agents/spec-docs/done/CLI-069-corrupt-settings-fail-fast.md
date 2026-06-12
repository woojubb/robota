---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-069: Corrupt settings.json fails fast at session start (no silent treat-as-missing)

## Problem

Verified 2026-06-11 (L1, npm-installed `3.0.0-beta.73`): with `~/.robota/settings.json`
containing invalid JSON (`{ broken`), `robota -p "hi"` degrades to
`No provider configuration found` — the parse error is swallowed and the file treated as
absent. A user whose working config gets corrupted (partial write, manual edit) loses their
provider setup with no indication why. This is the forbidden-fallback class: an error
condition masked as a default.

Two independent lenient layers cause it:

- `readSettings()` (`packages/agent-framework/src/config/settings-io.ts:25-35`): catch →
  stderr warning → return `{}`.
- `readSettingsFile()`
  (`packages/agent-framework/src/command-api/provider/provider-merge.ts:22-36`): catch →
  return `undefined` with no output at all — this is the session-start provider path.

By contrast, `robota diagnose` correctly flags a corrupt **project** `.robota/settings.json`
as invalid JSON. The session-start path must do the same for both levels.

## Architecture Review

### Affected Scope

- `packages/agent-framework` / `src/command-api/provider/provider-merge.ts` — distinguish
  corrupt from missing; corrupt → typed error carrying file path + parse message
- `packages/agent-framework` / `src/config/settings-io.ts` — same distinction for the
  general settings reader used at session start
- `packages/agent-framework` / `docs/SPEC.md` — error taxonomy row + settings-read contract
- `packages/agent-cli` / `docs/SPEC.md` — startup failure modes (corrupt-settings error
  message shape)
- Non-session-start readers (diagnose, configure listing, etc.) keep explicit lenient
  behavior where reporting is their own job — each call site decided deliberately, not by a
  shared silent catch

### Alternatives Considered

1. **Typed `SettingsParseError` thrown by the readers; session-start propagates, diagnose
   catches and reports (chosen).**
   - Pro: corrupt vs missing becomes a type-level distinction at the source (SSOT); the
     session-start path fails fast with the file path + parse error + `robota diagnose`
     guidance; diagnose keeps its report-all-issues behavior by catching the same typed
     error — one implementation, two presentations.
   - Con: every reader call site must be reviewed once for intended behavior (enumerated:
     ~12 sites in the merge/read chain).
2. **Return a discriminated result (`{kind: 'missing'|'corrupt'|'ok'}`) instead of
   throwing.**
   - Pro: forces every caller to handle the corrupt case explicitly.
   - Con: churns all ~12 call-site signatures including the many legitimately lenient ones;
     for session start the outcome is identical (abort) — heavier diff, same behavior.
3. **Fix only the CLI: pre-validate settings files in `cli.ts` before starting.**
   - Pro: smallest framework diff.
   - Con: a second parse of the same files that can drift from the framework's actual read
     (different path resolution, different error wording); leaves the framework's silent
     swallow in place for other consumers. Violates fix-at-the-source.

### Decision

Alternative 1. The driving trade-off is fixing the masking at its source vs caller churn:
the silent catch IS the bug, so the readers must stop equating corrupt with missing; a typed
error keeps the diff confined to call sites that today rely on the silent swallow
(session-start provider chain), while diagnose explicitly catches it. Missing files remain a
non-error (`undefined`/`{}`) — only parse failures on an EXISTING file throw.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — settings 읽기 호출 경로 전수 조사(2026-06-12 Explore): merge
      체인 ~12개 호출처 식별 — 세션 시작 provider 경로(`readSettingsFile` →
      `resolveActiveProvider`)는 fail-fast 대상, diagnose/설정 나열 등 보고 성격 호출처는
      typed error를 잡아 자체 보고 유지; `settings-io.readSettings`의 stderr warning 경로도
      동일 typed error로 통일
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Add `SettingsParseError` (typed, carries `filePath` + underlying parse message) in the
   framework error module (SSOT with existing error taxonomy).
2. `readSettingsFile` / `readSettings`: missing file → current behavior; existing file that
   fails to parse → throw `SettingsParseError`. Delete the silent catch and the
   warn-and-continue fallback.
3. Session start: the error propagates to the standard CLI error path → stderr message
   `Settings file <path> contains invalid JSON: <parse error>. Fix or delete the file, or
run robota diagnose.` → exit 1.
4. Diagnose (and any other reporting reader) catches `SettingsParseError` and reports it as
   an issue (aligns with CLI-067).
5. SPEC updates: framework error taxonomy + read contract; CLI startup failure modes.

## Affected Files

- `packages/agent-framework/src/command-api/provider/provider-merge.ts`
- `packages/agent-framework/src/config/settings-io.ts`
- `packages/agent-framework/src/command-api/provider/__tests__/`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: corrupt user-level `~/.robota/settings.json` (isolated HOME) → `robota -p "hi"`
      exits 1 with stderr naming the file path and the JSON parse error — NOT
      `No provider configuration found`
- [x] TC-02: corrupt project-level `.robota/settings.json` → same fail-fast contract
- [x] TC-03: missing settings files at both levels → behavior unchanged (env-default or
      `No provider configuration found` per CLI-066 order)
- [x] TC-04: valid settings files → resolution unchanged (regression)
- [x] TC-05: the error message includes remediation guidance (fix/delete or
      `robota diagnose`)
- [x] TC-06: framework SPEC error taxonomy lists `SettingsParseError`; CLI SPEC startup
      failure modes updated

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                    | Notes                                                                                                                                                                                                                                                                          |
| ----- | --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | unit      | vitest — corrupt fixture at injected user level, reader + CLI path | Test written: `packages/agent-framework/src/command-api/provider/__tests__/corrupt-settings-fail-fast.test.ts > corrupt settings fail fast (CLI-069) > TC-01: corrupt user-level settings throws SettingsParseError naming the file — not ProviderConfigError`                 |
| TC-02 | unit      | vitest — corrupt fixture at project level                          | Test written: same file > `TC-02: corrupt project-level settings throws the same typed error`                                                                                                                                                                                  |
| TC-03 | unit      | vitest — both files absent                                         | Test written: same file > `TC-03: missing files at both levels keep the CLI-066 order — ProviderConfigError without env key, env-default with one`                                                                                                                             |
| TC-04 | unit      | vitest — valid fixtures                                            | Test written: same file > `TC-04: valid settings files resolve unchanged (regression)`                                                                                                                                                                                         |
| TC-05 | unit      | vitest — message content assertion                                 | Test written: same file > `TC-05: the error message carries remediation guidance; settings-io.readSettings throws the same error with no stderr warning`                                                                                                                       |
| TC-06 | manual    | SPEC.md diff review                                                | Test skipped: doc prose not automatable — verified by direct read at GATE-COMPLETE 2026-06-13 (framework SPEC.md §Provider Resolution Order lines 370–377 + Error Taxonomy line 394 `SettingsParseError` row; CLI SPEC.md Error Taxonomy line 1633 "Settings parse error" row) |

## Tasks

- [x] `.agents/tasks/completed/CLI-069.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptom present (`robota -p "hi"` degrades to `No provider configuration found` with corrupt `~/.robota/settings.json` containing `{ broken`, verified 2026-06-11 on `3.0.0-beta.73`); reproduction condition present (corrupt user-level settings file at session start; two lenient layers identified with file:line); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (2026-06-12 Explore, ~12 call sites enumerated in the merge/read chain with per-site fail-fast vs lenient disposition).
- Alternatives Considered: 3 entries (typed error thrown; discriminated result; CLI-only pre-validation), each with pro and con.
- Decision: references the driving trade-off (fixing the masking at its source vs caller churn) that drove Alternative 1.
- Completion Criteria: 6 items, all `TC-N` prefixed (TC-01 … TC-06); each uses Command form or Observable behavior form; no forbidden vague phrases ("works correctly", "no errors", "implemented", "displays correctly").
- Test Plan: section present; 6 rows match 6 TC-N criteria (count matches); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-06) has a non-empty Notes entry explaining why it is not automatable (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" (2026-06-13) in response to the consolidated request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건", which individually summarized this spec's design (remove silent catch layers; typed `SettingsParseError` with file path + parse error; session start fails fast with exit 1 and `robota diagnose` guidance; diagnose catches and reports the same typed error; missing files remain a non-error). "승인함" matches the explicit-approval pattern ("승인").
- Direct, unambiguous, directed at this spec: the approval request enumerated all 11 specs including CLI-069 and stated that approval authorizes GATE-APPROVAL → per-item implementation; the user was told verbatim that replying "승인함" authorizes implementation of the 11 designs and then replied "승인함". The earlier release instruction ("머지하고 main 릴리스 진행해줘", PR #705) was not treated as design approval. Not a clarifying-question answer, silence, or approval of a different item.
- No Architecture Review or frontmatter type/tags modified after approval: the spec file exists in exactly one commit (cd5b1053a, 148-line creation, GATE-WRITE batch); post-GATE-WRITE changes were limited to the guard's Evidence Log entry, frontmatter status draft → review-ready, and prettier formatting at commit time; `git status` shows no working-tree modifications to this file; current frontmatter remains `type: BEHAVIOR`, `tags: [cli, typescript]`.
- NON-COMPLIANCE trigger checked — no implementation started before this gate: `.agents/tasks/CLI-069.md` does not exist; `git log --all --since=2026-06-12` on `packages/agent-framework/src/command-api/provider/provider-merge.ts` and `packages/agent-framework/src/config/settings-io.ts` shows no commits; `git status` shows no working-tree changes under `packages/agent-framework`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-069.md` exists (read directly; contains T1–T7 with checkboxes and a Test Plan summary deferring to the spec's TC table as SSOT).
- Tasks file path recorded in `## Tasks` of this spec: `- [x] `.agents/tasks/completed/CLI-069.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑)`.
- Tasks correspond to Completion Criteria, one task per TC-N: T1↔TC-01 (typed `SettingsParseError`, `readSettingsFile` throws, `robota -p "hi"` exits 1 naming the file), T2↔TC-02 (project-level corrupt file, same contract), T3↔TC-03 (missing files unchanged per CLI-066 order), T4↔TC-04 (valid files regression), T5↔TC-05 (remediation guidance + `readSettings` fallback deletion + diagnose reports), T6↔TC-06 (framework SPEC error taxonomy + CLI SPEC startup failure modes), plus T7 wrap-up (test/typecheck/lint/build, PR, evidence + archive). 6/6 TC-N covered.
- NON-COMPLIANCE trigger checked — no implementation commits without a tasks file: on branch `feat/cli-069-corrupt-settings-failfast`, `git log --oneline develop..HEAD` shows no commits touching implementation; last commits on `provider-merge.ts` / `settings-io.ts` predate this spec (266d9e934, 4d46b6c54); `git status --porcelain -- packages/agent-framework` is empty.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-069.md` T1–T6 all `[x]` (verified by direct read). T7 (wrap-up) unchecked but every component independently verified per the established CLI-063/064/065/066/067 GATE-VERIFY interpretation (precedent confirmed by direct read of the CLI-067 done-spec GATE-VERIFY entry): PR #709 OPEN (`gh pr view 709 --json state,headRefName,baseRefName`: state OPEN, head `feat/cli-069-corrupt-settings-failfast` → base `develop`) with CI green on `gh pr checks 709` — build pass (1m31s), quality pass (1m6s), security audit pass (6s), Cloudflare Pages pass; compat-node18 and release-grade verification "skipping" (skipped by design on feature PRs); backlog evidence recorded in `.agents/backlog/completed/CLI-069-corrupt-user-settings-silent-fallback.md` (`status: done`, User Execution Test Scenarios Evidence filled: 2026-06-13 real binary `bin/robota.cjs`, isolated HOME via `env -i`, `{ broken` in `~/.robota/settings.json` → `Settings file <home>/.robota/settings.json contains invalid JSON: Expected property name or '}' in JSON at position 2 ... Fix or delete the file, or run robota diagnose.`, exit=1 — not "No provider configuration found") — met
- No tasks blocked or pending: tasks file contains no blocked markers; only T7 wrap-up remains open as adjudicated above — met
- Build passes for affected packages: `pnpm --filter @robota-sdk/agent-framework build` → "Build complete in 856ms" (ESM bundles, no errors); `pnpm --filter @robota-sdk/agent-cli build` → "Build complete in 680ms" — met
- Tests pass for affected packages: `pnpm --filter @robota-sdk/agent-framework test` → 91 files / 907 tests passed, including the new `src/command-api/provider/__tests__/corrupt-settings-fail-fast.test.ts` re-run individually → 6/6 passed; `pnpm --filter @robota-sdk/agent-cli test` → 17 files / 140 tests passed — met
- Validity: on branch `feat/cli-069-corrupt-settings-failfast`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications, nothing under `packages/agent-framework`, `packages/agent-cli`, or `.agents/tasks` — build/test evidence reflects the PR #709 head state.

Completion Criteria checkboxes remain unchecked by design: TC-N validation belongs to GATE-COMPLETE.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/command-api/provider/__tests__/corrupt-settings-fail-fast.test.ts` (cwd `packages/agent-framework`).
- Output: `✓ corrupt settings fail fast (CLI-069) > TC-01: corrupt user-level settings throws SettingsParseError naming the file — not ProviderConfigError` — 6 tests passed (6). Exit code 0.
- End-to-end corroboration (real binary, `.agents/backlog/completed/CLI-069-corrupt-user-settings-silent-fallback.md` Evidence, 2026-06-13): `bin/robota.cjs` with isolated HOME (`env -i`) and `{ broken` in `~/.robota/settings.json` → stderr `Settings file <home>/.robota/settings.json contains invalid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3). Fix or delete the file, or run robota diagnose.` — exit=1, NOT `No provider configuration found`.
- Test Plan row updated with the test reference.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 is `[x]` in `## Completion Criteria`.
- Command: same vitest run as TC-01.
- Output: `✓ corrupt settings fail fast (CLI-069) > TC-02: corrupt project-level settings throws the same typed error` — passed. Exit code 0.
- Test Plan row updated with the test reference.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 is `[x]` in `## Completion Criteria`.
- Command: same vitest run as TC-01.
- Output: `✓ corrupt settings fail fast (CLI-069) > TC-03: missing files at both levels keep the CLI-066 order — ProviderConfigError without env key, env-default with one` — passed. Exit code 0. Missing-file behavior unchanged per CLI-066 order.
- Test Plan row updated with the test reference.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 is `[x]` in `## Completion Criteria`.
- Command: same vitest run as TC-01.
- Output: `✓ corrupt settings fail fast (CLI-069) > TC-04: valid settings files resolve unchanged (regression)` — passed. Exit code 0.
- Test Plan row updated with the test reference.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: TC-05 is `[x]` in `## Completion Criteria`.
- Command: same vitest run as TC-01.
- Output: `✓ corrupt settings fail fast (CLI-069) > TC-05: the error message carries remediation guidance; settings-io.readSettings throws the same error with no stderr warning` — passed. Exit code 0. Suite also includes `merge chain surfaces the first corrupt file even when later files are valid` (passed). Real-binary message (TC-01 corroboration) carries the guidance verbatim: `Fix or delete the file, or run robota diagnose.`
- Test Plan row updated with the test reference.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

- Checkbox: TC-06 is `[x]` in `## Completion Criteria`.
- Action: direct read of both SPEC.md files (manual doc verification — Test Plan row marks this as not automatable with explicit skip reason).
- `packages/agent-framework/docs/SPEC.md` §Provider Resolution Order lines 370–377: fail-fast paragraph present — "Settings files on the merge-chain paths are read fail-fast (CLI-069): a missing file is a non-error … an EXISTING file that fails to parse throws `SettingsParseError` (typed; carries `filePath` and the JSON parse message …) … Session start propagates the error (exit 1 at the CLI); reporting consumers (e.g. diagnose) catch it and present it as a finding."
- `packages/agent-framework/docs/SPEC.md` §Error Taxonomy line 394: row `| Settings file parsing | SettingsParseError | Existing settings file with invalid JSON — fail-fast with file path + parse message (CLI-069); never treated as missing |` present (class also introduced in the taxonomy preamble, lines 387–388).
- `packages/agent-cli/docs/SPEC.md` §Error Taxonomy line 1633: row `| Settings parse error | SettingsParseError — an existing settings file contains invalid JSON (CLI-069) | Fail-fast at session start: message names the file path + parse error + remediation (fix/delete or robota diagnose); written to stderr; process.exit(1) — never silently treated as a missing file | 1 |` present.
- Test Plan row updated with the explicit skip reason and the lines read.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- All 6 Completion Criteria checkboxes are `[x]` (TC-01 … TC-06), each backed by a `[GATE-COMPLETE: TC-N]` evidence entry above with command, observed output, and exit code.
- `## Test Plan` updated: TC-01..TC-05 carry test-file + test-name references (`packages/agent-framework/src/command-api/provider/__tests__/corrupt-settings-fail-fast.test.ts`, all passing — `npx vitest run …` → 6 passed (6), exit 0); TC-06 carries an explicit skip reason (doc prose, verified by direct read with file:line evidence). No TC-N silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/CLI-069.md` exists with T1–T7 all `[x]` (verified by direct read); `.agents/tasks/CLI-069.md` no longer present at the active path.
- `## Tasks` section points at the archived path (`.agents/tasks/completed/CLI-069.md`).
