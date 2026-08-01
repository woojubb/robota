---
title: 'CORE-019: 컴팩션 실패 시 히스토리 원본 보존 + 에러 전파 (원자적 영속화)'
status: done
created: 2026-07-04
completed: 2026-07-04
priority: high
urgency: now
area: packages/agent-session
depends_on: []
---

# 컴팩션 실패 시 히스토리 원본 보존 + 에러 전파 (원자적 영속화)

Re-audit P1-4 (RUNTIME-15 + RUNTIME-45 흡수). 컴팩션 summary 무효 시 '(compaction failed)'
마커로 clearHistory() 후 치환하고 계속 진행 — append-only/No-Fallback 동시 위반 데이터 오염.
세션 영속화도 비원자 writeFileSync.

## What

1. clearHistory() 이전에 summary 무효 시 throw — 히스토리 무손상 보존.
2. 세션 영속화 temp+rename 원자화 (RUNTIME-45).

## Test Plan

- 무효 summary 주입 시 원본 무손상 + 에러 표면화; 영속화 원자성 테스트.

## User Execution Test Scenarios

- agent-executable. 라이브 세션에서 컴팩션 실패 유도(불가 시 fault-injection 지점 명시) 후
  세션 로그 원본 무손상 실측.
- Evidence: **PASSED 2026-07-04** — live probe `scratch/src/core-019-user-execution.ts`
  (gitignored scratch workspace; recipe: `pnpm --filter robota-scratch run run src/core-019-user-execution.ts`,
  key from the gitignored agent-cli `.env`, model claude-haiku-4-5). Real turn persisted a session,
  then the fault-injection point (provider.chat wrapped to return tool_use-shaped non-string
  content on the compaction summarization call — the exact RUNTIME-15 trigger) made
  `session.compact()` reject with `CompactionError`. Output:
  `historyPreserved=true filePreserved=true rejected=CompactionError tmpResidue=none` /
  `CORE-019-OK` — in-memory history AND the persisted session file were byte-identical to the
  pre-compaction snapshot, and a follow-up real turn re-persisted atomically with no `.tmp`
  residue.

## Implementation Evidence (2026-07-04)

- SPEC first: `packages/agent-session/docs/SPEC.md` — new § Compaction Failure Contract
  (validate-before-clear, history untouched on failure, errors propagate), `save()` atomicity
  in the SessionStore method table, `CompactionError` added to Public API Surface and Error
  Taxonomy.
- `packages/agent-session/src/compaction-orchestrator.ts` — `CompactionError` class; invalid
  summary (non-string or empty/whitespace) now throws BEFORE any caller can clear history;
  `'(compaction failed)'` marker fallback deleted.
- `packages/agent-session/src/session-store.ts` — `save()` writes to a same-directory
  `*.pid.tmp` file then `renameSync` into place; temp file removed on rename failure.
- Tests (TDD, red→green): `compaction-failure-preservation.test.ts` (orchestrator contract),
  `session-compaction.test.ts` (Session-level: history untouched, no clear/inject on failure),
  `session-store-atomic.test.ts` (roundtrip/no-residue/failed-save-preserves-previous),
  `session-store-atomic-mechanism.test.ts` (pins temp-path write + same-dir rename shape).
  agent-session suite 85/85 green; typecheck 0 errors; lint 0 errors.
