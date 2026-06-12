---
status: review-ready
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

- [ ] TC-01: with permission mode `plan`, the generated system prompt contains
      `Permission mode: plan` and does NOT contain `Trust level:`
- [ ] TC-02: each `TPermissionMode` value is interpolated verbatim (parameterized over the
      mode union — no hardcoded subset)
- [ ] TC-03: full prompt-assembly regression — other sections unchanged
      (`pnpm --filter @robota-sdk/agent-framework test` green)
- [ ] TC-04: framework SPEC.md documents the section's permission-mode line and the removal
      of the trust-level line

## Test Plan

| TC-ID | Test Type | Tool / Approach                                     | Notes                                                                 |
| ----- | --------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | unit      | vitest — section provider with mode `plan`          | positive + negative content assertion                                 |
| TC-02 | unit      | vitest — parameterized over `TPermissionMode` union | exhaustive via type-derived list                                      |
| TC-03 | unit      | vitest — existing prompt assembly suite             | regression                                                            |
| TC-04 | manual    | SPEC.md diff review                                 | doc prose — verified by direct read at GATE-COMPLETE, not automatable |

## Tasks

- [ ] `.agents/tasks/CLI-072.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptom present (`robota -p "Change greet.js ..." --dry-run` → model reply says "permission mode is set to **moderate**" while actual mode is `plan`); reproduction condition present (any run under `--permission-mode plan`, root cause at `system-prompt-section-providers.ts:51`); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan item `[x]` with completion evidence (TRUST_LEVEL_LABELS consumer grep + section provider input wiring noted); Alternatives Considered has 3 entries, each with pro and con; Decision references the driving trade-off (one authoritative label vs information completeness).
- Completion Criteria: all 4 items have TC-N prefixes (TC-01–TC-04); at least 1 criterion per sub-item (prompt content, mode union coverage, regression, SPEC doc); each uses Command form or Observable behavior form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: `## Test Plan` section present; 4 rows match the 4 TC-N entries in Completion Criteria (count matches: 4 = 4); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-04) has a non-empty Notes entry explaining why automation is not possible (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder (tasks file to be created after GATE-APPROVAL); `## Evidence Log` section present and empty before this first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.
