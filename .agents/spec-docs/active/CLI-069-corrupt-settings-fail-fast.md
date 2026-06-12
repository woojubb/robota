---
status: in-progress
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

- [ ] TC-01: corrupt user-level `~/.robota/settings.json` (isolated HOME) → `robota -p "hi"`
      exits 1 with stderr naming the file path and the JSON parse error — NOT
      `No provider configuration found`
- [ ] TC-02: corrupt project-level `.robota/settings.json` → same fail-fast contract
- [ ] TC-03: missing settings files at both levels → behavior unchanged (env-default or
      `No provider configuration found` per CLI-066 order)
- [ ] TC-04: valid settings files → resolution unchanged (regression)
- [ ] TC-05: the error message includes remediation guidance (fix/delete or
      `robota diagnose`)
- [ ] TC-06: framework SPEC error taxonomy lists `SettingsParseError`; CLI SPEC startup
      failure modes updated

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                    | Notes                                                                 |
| ----- | --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| TC-01 | unit      | vitest — corrupt fixture at injected user level, reader + CLI path | typed error + message assertion                                       |
| TC-02 | unit      | vitest — corrupt fixture at project level                          | same contract                                                         |
| TC-03 | unit      | vitest — both files absent                                         | regression vs CLI-066 order                                           |
| TC-04 | unit      | vitest — valid fixtures                                            | regression                                                            |
| TC-05 | unit      | vitest — message content assertion                                 | guidance text                                                         |
| TC-06 | manual    | SPEC.md diff review                                                | doc prose — verified by direct read at GATE-COMPLETE, not automatable |

## Tasks

- [ ] `.agents/tasks/CLI-069.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up)

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
- Tasks file path recorded in `## Tasks` of this spec: `- [ ] `.agents/tasks/CLI-069.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up)`.
- Tasks correspond to Completion Criteria, one task per TC-N: T1↔TC-01 (typed `SettingsParseError`, `readSettingsFile` throws, `robota -p "hi"` exits 1 naming the file), T2↔TC-02 (project-level corrupt file, same contract), T3↔TC-03 (missing files unchanged per CLI-066 order), T4↔TC-04 (valid files regression), T5↔TC-05 (remediation guidance + `readSettings` fallback deletion + diagnose reports), T6↔TC-06 (framework SPEC error taxonomy + CLI SPEC startup failure modes), plus T7 wrap-up (test/typecheck/lint/build, PR, evidence + archive). 6/6 TC-N covered.
- NON-COMPLIANCE trigger checked — no implementation commits without a tasks file: on branch `feat/cli-069-corrupt-settings-failfast`, `git log --oneline develop..HEAD` shows no commits touching implementation; last commits on `provider-merge.ts` / `settings-io.ts` predate this spec (266d9e934, 4d46b6c54); `git status --porcelain -- packages/agent-framework` is empty.
