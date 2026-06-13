---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-072: System prompt reports the actual permission mode, not a trust-level label

## Problem

Observed 2026-06-11 (L3, real provider): `robota -p "Change greet.js ..." --dry-run`
(normalized to `--permission-mode plan`) correctly blocked the edit, but the model's reply
explained the block as "permission mode is set to **moderate**".

Cause located (2026-06-12 investigation, upgrading the backlog's low-confidence guess to
confirmed): `packages/agent-framework/src/context/system-prompt-section-providers.ts:51`
injects `` `- **Trust level:** ${TRUST_LEVEL_LABELS[trustLevel]}` `` into the system prompt.
`trustLevel` defaults to `moderate` and is a separate axis from the active permission mode
(`TRUST_TO_MODE` mapping at `packages/agent-core/src/permissions/types.ts:22-26`). Under
`--permission-mode plan` the prompt still says "Trust level: moderate", so the model
truthfully repeats the only mode-like label it was given — wrong relative to the active
mode.

## Architecture Review

### Affected Scope

- `packages/agent-framework` / `src/context/system-prompt-section-providers.ts` — the
  section reports the active `TPermissionMode` (SSOT type from agent-core)
- `packages/agent-framework` / section provider wiring — the section must receive the
  active permission mode (today it receives only `trustLevel`)
- `packages/agent-framework` / `docs/SPEC.md` — system-prompt section contract
- No agent-core changes — `TPermissionMode` and `TRUST_TO_MODE` already exist

### Alternatives Considered

1. **Replace the trust-level line with the active permission mode line (chosen).**
   - Pro: the model is told the same mode name the permission gate actually enforces —
     explanation accuracy by construction; one fewer conflated concept in the prompt;
     `TPermissionMode` is the SSOT the status bar and gate already use.
   - Con: any prompt-content test pinning "Trust level:" must be updated.
2. **Keep the trust line, add a separate "Permission mode:" line.**
   - Pro: preserves trust-level information.
   - Con: two adjacent mode-like labels invite exactly the conflation observed — the model
     quoted the wrong one once already; trust level is an internal derivation input, not a
     contract the model needs.
3. **Fix only the denial payload (tool error message), leave the system prompt.**
   - Pro: targets the message the model quotes at denial time.
   - Con: investigation shows the wrong label enters via the system prompt, not the denial
     payload; the stale "moderate" would keep leaking into any mode-related explanation,
     denial or not.

### Decision

Alternative 1. The driving trade-off is one authoritative label vs information
completeness: the model only needs the enforced mode, and giving it two labels is the
failure mode. The line becomes `- **Permission mode:** <active TPermissionMode>` fed from
the same resolved mode the permission gate uses. `TRUST_LEVEL_LABELS` usage in this section
is removed; if no other consumer remains, the constant is deleted (no-deprecated rule).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `TRUST_LEVEL_LABELS` 소비처 grep: 본 섹션 외 소비처 존재 여부를
      구현 시 재확인하여 잔존 소비처 없으면 상수 삭제(미배포 — deprecated 금지 규칙);
      system-prompt 섹션 제공자들의 입력 배선 확인 — permissionMode는 게이트/상태바에서
      이미 해소된 값을 동일 소스로 주입
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Thread the resolved `TPermissionMode` into the system-prompt section provider input
   (same resolved value the permission gate enforces — single source).
2. `system-prompt-section-providers.ts:51`: replace the trust-level line with
   `- **Permission mode:** ${permissionMode}`.
3. Remove `TRUST_LEVEL_LABELS` from this section; delete the constant if orphaned.
4. Update prompt-content tests; SPEC section contract row.

## Affected Files

- `packages/agent-framework/src/context/system-prompt-section-providers.ts`
- `packages/agent-framework/src/context/__tests__/` (prompt-content tests)
- `packages/agent-framework/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: with permission mode `plan`, the generated system prompt contains
      `Permission mode: plan` and does NOT contain `Trust level:`
- [x] TC-02: each `TPermissionMode` value is interpolated verbatim (parameterized over the
      mode union — no hardcoded subset)
- [x] TC-03: full prompt-assembly regression — other sections unchanged
      (`pnpm --filter @robota-sdk/agent-framework test` green)
- [x] TC-04: framework SPEC.md documents the section's permission-mode line and the removal
      of the trust-level line

## Test Plan

| TC-ID | Test Type | Tool / Approach                                     | Notes                                                                                                                                                                                                                            |
| ----- | --------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit      | vitest — section provider with mode `plan`          | Test written: `packages/agent-framework/src/__tests__/system-prompt-builder.test.ts > includes the active permission mode and no trust-level label (CLI-072)` — positive `- **Permission mode:** plan` + negative `Trust level:` |
| TC-02 | unit      | vitest — parameterized over `TPermissionMode` union | Test written: `packages/agent-framework/src/__tests__/system-prompt-builder.test.ts > interpolates every TPermissionMode value verbatim (CLI-072 TC-02)` — all 4 union values (plan/default/acceptEdits/bypassPermissions)       |
| TC-03 | unit      | vitest — existing prompt assembly suite             | Test written: full `@robota-sdk/agent-framework` suite (92 files / 912 tests green at GATE-COMPLETE); `TRUST_LEVEL_LABELS` grep over `packages/agent-framework/src` → zero hits (deleted)                                        |
| TC-04 | manual    | SPEC.md diff review                                 | Test skipped (doc prose, not automatable): verified by direct read at GATE-COMPLETE — `packages/agent-framework/docs/SPEC.md:1003` "Permission Mode section (CLI-072)" bullet                                                    |

## Tasks

- [x] `.agents/tasks/completed/CLI-072.md` — archived at GATE-COMPLETE (T1~T5 complete, TC-01~TC-04 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptom present (`robota -p "Change greet.js ..." --dry-run` → model reply says "permission mode is set to **moderate**" while actual mode is `plan`); reproduction condition present (any run under `--permission-mode plan`, root cause at `system-prompt-section-providers.ts:51`); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan item `[x]` with completion evidence (TRUST_LEVEL_LABELS consumer grep + section provider input wiring noted); Alternatives Considered has 3 entries, each with pro and con; Decision references the driving trade-off (one authoritative label vs information completeness).
- Completion Criteria: all 4 items have TC-N prefixes (TC-01–TC-04); at least 1 criterion per sub-item (prompt content, mode union coverage, regression, SPEC doc); each uses Command form or Observable behavior form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: `## Test Plan` section present; 4 rows match the 4 TC-N entries in Completion Criteria (count matches: 4 = 4); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-04) has a non-empty Notes entry explaining why automation is not possible (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder (tasks file to be created after GATE-APPROVAL); `## Evidence Log` section present and empty before this first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: after the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건" (which individually summarized CLI-072: trust-level line replaced with `Permission mode: <active mode>` fed from the gate-enforced resolved mode, `TRUST_LEVEL_LABELS` deleted if orphaned), the user was told verbatim that replying "승인함" authorizes implementation of the 11 designs, and replied exactly: "승인함" (2026-06-13).
- Direct, unambiguous, directed at this spec: the approval responds to the batch request that explicitly includes CLI-072's design summary; it is not an answer to a clarifying question, not silence, and not approval of a different item. The earlier release instruction ("머지하고 main 릴리스 진행해줘", executed as docs-only release PR #705) was correctly not treated as design approval.
- No Architecture Review or frontmatter type/tags modified after approval: the spec file has exactly one commit (cd5b1053a, the GATE-WRITE batch); the only post-GATE-WRITE changes were the guard's Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting — all prior to approval. Frontmatter remains `type: BEHAVIOR`, `tags: [cli, typescript]`.
- NON-COMPLIANCE trigger (implementation before this gate) not present: `.agents/tasks/CLI-072.md` does not exist (`ls` → No such file or directory); `git status --porcelain -- packages/agent-framework packages/agent-core` is clean; last commit touching `system-prompt-section-providers.ts` is the unrelated REFACTOR-024 rename (8cac18921).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-072.md` exists (`ls -la` → 1666 bytes, created 2026-06-13).
- Tasks file path recorded in `## Tasks`: the spec's Tasks section lists `.agents/tasks/CLI-072.md` — T1~T5 (TC-01~TC-04 매핑 + wrap-up).
- Tasks correspond to Completion Criteria (one task per TC-N): T1 ↔ TC-01 (permission-mode line rendered, no `Trust level:` under mode `plan`); T2 ↔ TC-02 (parameterized interpolation over the `TPermissionMode` union); T3 ↔ TC-03 (prompt-assembly regression, `trustLevel` → `permissionMode`, full framework suite green, orphaned `TRUST_LEVEL_LABELS` deletion); T4 ↔ TC-04 (framework SPEC.md documents the line change); T5 = wrap-up (verify/PR/scenario evidence) beyond the TC minimum.
- NON-COMPLIANCE trigger (implementation commits without tasks file) not present: branch `feat/cli-072-permission-mode-prompt` has only spec/tasks doc changes; `git status --porcelain -- packages/agent-framework packages/agent-core` is clean; last commit touching `system-prompt-section-providers.ts` remains the unrelated REFACTOR-024 rename (8cac18921).

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-072.md` T1–T4 all `[x]` (verified by direct read). T5 (wrap-up) unchecked but every component independently verified per the established CLI-063..070 GATE-VERIFY interpretation (precedent confirmed by direct read of the CLI-069 and CLI-070 done-spec GATE-VERIFY entries): PR #712 OPEN (`gh pr view 712 --json state,headRefName,baseRefName`: state OPEN, head `feat/cli-072-permission-mode-prompt` → base `develop`) with CI green on `gh pr checks 712` — build pass (1m28s), quality pass (50s), security audit pass (6s), Cloudflare Pages pass; compat-node18 and release-grade verification "skipping" (skipped by design on feature PRs); backlog evidence recorded in `.agents/backlog/completed/CLI-072-permission-denial-mode-name.md` (`status: done`, User Execution Test Scenario Evidence filled: 2026-06-13 real binary + real Anthropic provider, isolated HOME, `--dry-run` → permission mode `plan`, mode question answered `plan`, dry-run edit explanation describes plan-mode restrictions without misnaming the mode, edit stays blocked) — met
- No tasks blocked or pending: tasks file contains no blocked markers (grep for "blocked" → no hits); only T5 wrap-up remains open as adjudicated above — met
- Build passes for affected package: `pnpm --filter @robota-sdk/agent-framework build` → "Build complete in 853ms" (ESM bundles, no errors) — met
- Tests pass for affected package: `pnpm --filter @robota-sdk/agent-framework test` → 92 files / 912 tests passed, including the CLI-072 assertions in `src/__tests__/system-prompt-builder.test.ts` (parameterized `- **Permission mode:** ${mode}` over the union at line 76-77; explicit `plan` and `acceptEdits` content assertions at lines 83-88) — met
- Note on approved scope: `ISystemPromptParams.trustLevel` → `permissionMode` replacement and `TRUST_LEVEL_LABELS` deletion match the approved Decision (Alternative 1 incl. no-deprecated cleanup); five test files migrated from trustLevel values to TRUST_TO_MODE-equivalent permissionMode values, all green in the 912-test run above.
- Validity: on branch `feat/cli-072-permission-mode-prompt`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications, nothing under `packages/agent-framework` or `.agents/tasks` — build/test evidence reflects the PR #712 head state.

Completion Criteria checkboxes remain unchecked by design: TC-N validation belongs to GATE-COMPLETE.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/__tests__/system-prompt-builder.test.ts` (cwd `packages/agent-framework`).
- Observed output: `Test Files 1 passed (1)`, `Tests 26 passed (26)`; exit code 0.
- Test reference: `packages/agent-framework/src/__tests__/system-prompt-builder.test.ts > includes the active permission mode and no trust-level label (CLI-072)` (line 82) — asserts `buildSystemPrompt({ permissionMode: 'plan' })` contains `- **Permission mode:** plan` and does NOT contain `Trust level:` (positive + negative content assertion, verified by direct read of the test source).

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run src/__tests__/system-prompt-builder.test.ts` (cwd `packages/agent-framework`) — same run as TC-01.
- Observed output: `Tests 26 passed (26)`; exit code 0.
- Test reference: `packages/agent-framework/src/__tests__/system-prompt-builder.test.ts > interpolates every TPermissionMode value verbatim (CLI-072 TC-02)` (line 73) — parameterized loop over `const modes: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions']` (the full `TPermissionMode` union, no hardcoded subset), asserting `- **Permission mode:** ${mode}` verbatim and no `Trust level:` for each mode (verified by direct read of the test source).

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 is `[x]` in `## Completion Criteria`.
- Command: `pnpm --filter @robota-sdk/agent-framework test`.
- Observed output: `Test Files 92 passed (92)`, `Tests 912 passed (912)`, duration 2.64s; exit code 0 — full prompt-assembly regression green, other sections unchanged.
- Orphan cleanup confirmed: `grep -rn "TRUST_LEVEL_LABELS" packages/agent-framework/src` → zero hits, exit code 1 — constant deleted per the no-deprecated rule.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 is `[x]` in `## Completion Criteria`.
- Action: direct read of `packages/agent-framework/docs/SPEC.md` (manual doc verification per Test Plan — not automatable).
- Observed: line 1003, "Context Loading (SDK-Specific)" section, bullet "**Permission Mode section (CLI-072)**" — documents that `buildSystemPrompt()` renders `- **Permission mode:** <mode>` from `ISystemPromptParams.permissionMode` (the active `TPermissionMode` resolved as `options.permissionMode ?? TRUST_TO_MODE[config.defaultTrustLevel] ?? 'default'`), that the former `Trust level:` line is removed, and that `TRUST_LEVEL_LABELS` is deleted.
- Test Plan row marked as explicit skip (doc prose) with the direct-read reference above.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- All 4 Completion Criteria checkboxes are `[x]` (TC-01–TC-04), each backed by a `[GATE-COMPLETE: TC-N]` evidence entry above with exact command, observed output, and exit code.
- `## Test Plan` updated: TC-01/TC-02/TC-03 rows carry test references (file path + test name / full-suite run + grep), TC-04 row carries an explicit skip reason (doc prose, direct read at `docs/SPEC.md:1003`). No TC-N is silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/CLI-072.md` exists with T1–T5 all `[x]`; the un-archived path `.agents/tasks/CLI-072.md` no longer exists (`ls` → No such file or directory, exit 1). The spec `## Tasks` section points at the archived path.
- User-execution corroboration (done-gate): `.agents/backlog/completed/CLI-072-permission-denial-mode-name.md` is `status: done` with real-provider evidence (2026-06-13, real binary + real Anthropic provider, isolated HOME): `robota -p "What is your current permission mode? ..." --dry-run` → answer `plan`; dry-run edit explanation describes plan-mode restrictions without misnaming the mode and the edit stays blocked.
