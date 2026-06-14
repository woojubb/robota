---
status: done
type: BEHAVIOR
tags: [cli]
---

# HIST-001: 대화 히스토리 append-only — 개수 기반(100) 절단 제거

## Problem

라이브 에이전트 대화 히스토리가 **채팅 메시지 100개를 넘으면 가장 오래된 메시지를 조용히 버린다.**
`SimpleConversationHistory.addMessage`가 매 추가마다 `applyMessageLimit()`를 호출하고, 이 메서드는
`maxMessages`(=100) 초과 시 `nonSystem.slice(-available)`로 오래된 비시스템 메시지를 `entries`에서
삭제한다(`conversation-store-history.ts`). 라이브 경로 확정: `robota.ts` `new ConversationHistory()` →
`DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 100` → `new ConversationStore(100)` →
`SimpleConversationHistory({ maxMessages: 100 })`.

이는 **개수 기반 절단**으로, 토큰/크기 무관하게 발생한다 — 작은 도구 호출이 많은 세션은 토큰 사용이
1%여도 메시지 100개를 넘으면 초기 대화가 사라진다. 모델이 초기 맥락을 "잊는" 심각한 정확성 버그다.

이는 같은 코드베이스의 문서화된 설계와 **정면 모순**한다:

- `conversation-store.ts`: "History is append-only", "History records everything — text is always
  preserved. Context savings is compaction's responsibility, not history's."
- 메모리 원칙 `feedback_history_append_only`: 히스토리는 append-only + read-only, edit/delete 없음.

올바른 컨텍스트 관리는 **크기 기반 compaction**이다(`compaction-orchestrator` → `session-history-ops`가
`clearHistory()` 후 `[Context Summary]` 주입; 토큰 83.5%에서 auto, 또는 manual). 개수 절단은 이를
우회해 요약 없이 정보를 잃는다.

**재현 조건:** `DEFAULT_MAX_MESSAGES_PER_CONVERSATION === 100`이고 `applyMessageLimit`가 `addMessage`에서
호출됨. 101번째 채팅 메시지 추가 시 가장 오래된 비시스템 메시지가 `getMessages()`에서 사라진다.

## Architecture Review

### Affected Scope

- `packages/agent-core/src/managers/conversation-history-manager.ts` — `DEFAULT_MAX_MESSAGES_PER_CONVERSATION` 100 → 0(무제한·append-only)
- `packages/agent-core/src/managers/conversation-store.ts` — `ConversationStore` 생성자 기본값 100 → 0
- (테스트) `packages/agent-core/src/managers/conversation-store-history.test.ts` 또는 신규 — append-only 보존 단언

> `applyMessageLimit` 메커니즘 자체는 보존하되(명시적 opt-in용, `maxMessages > 0`), **라이브 기본값을
> 무제한(0)** 으로 바꿔 개수 절단을 끈다. `maxMessages <= 0`이면 `applyMessageLimit`는 early-return(무동작).

### Alternatives Considered

1. **100 캡을 더 큰 수로 상향.**
   - Con: 여전히 개수 기반 절단 — 큰 수도 결국 잘림; 원칙(모든 데이터 보존) 위배. Rejected.
2. **라이브 기본값을 무제한(0)으로 하여 append-only, 크기 기반 compaction이 컨텍스트 관리.**
   - Pro: 문서화된 설계·메모리 원칙 충족; 정보 손실 없음; 컨텍스트는 요약(compaction)으로 경계; `maxMessages`
     메커니즘은 명시 opt-in으로 유지(무회귀).
   - Con: compaction이 꺼져 있고 메시지가 극단적으로 많으면 메모리 증가 — 그러나 auto-compact 기본 ON,
     이전(데이터 소실)보다 훨씬 안전.

### Decision

**Alternative 2.** 라이브 대화 히스토리 기본을 무제한(append-only)으로. 개수 기반 절단 OFF. 컨텍스트는
크기 기반 auto/manual compaction(요약)으로만 관리. `applyMessageLimit`는 명시적 `maxMessages > 0` opt-in
시에만 동작(예: 격리된 bounded 버퍼). 트레이드오프: 이론적 메모리 증가를 감수하고, 모든 데이터 보존 +
문서화된 append-only 설계 일치 + 모델의 맥락 손실 제거.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-core(conversation manager/store)
- [x] Sibling scan 완료 — compaction-orchestrator/session-history-ops(요약 기반 컨텍스트 관리), conversation-store 주석(append-only 의도) 확인
- [x] 대안 최소 2개 검토 완료 — 2개(캡 상향 / 무제한)
- [x] 결정 근거 문서화 완료 — 문서/원칙 일치 + 데이터 보존 + compaction 위임 근거 기록

## Solution

1. `DEFAULT_MAX_MESSAGES_PER_CONVERSATION` 100 → 0 (주석: 0 = 무제한·append-only; 컨텍스트는 크기 기반 compaction이 관리).
2. `ConversationStore` 생성자 기본값 100 → 0 (동일 주석).
3. 테스트: 기본(무제한) 스토어가 100개 초과(예: 150개) 메시지를 모두 보존; 명시적 `maxMessages > 0`은 여전히 trim(메커니즘 보존).

## Affected Files

- `packages/agent-core/src/managers/conversation-history-manager.ts`
- `packages/agent-core/src/managers/conversation-store.ts`
- `packages/agent-core/src/managers/conversation-store-history.test.ts` (신규 또는 확장)

## Completion Criteria

- [x] TC-01: 기본 `ConversationStore`(무제한)에 150개 채팅 메시지 추가 후 `getMessages().length === 150`(가장 오래된 것 포함 모두 보존)임을 단언하는 단위 테스트 통과
- [x] TC-02: `DEFAULT_MAX_MESSAGES_PER_CONVERSATION === 0`이고 `new ConversationHistory()`(기본)로 얻은 스토어가 150개 메시지를 모두 보존함을 단언하는 단위 테스트 통과
- [x] TC-03: 명시적 `new ConversationStore(3)`은 여전히 최근 메시지만 유지(메커니즘 opt-in 보존)함을 단언하는 단위 테스트 통과
- [x] TC-04: `pnpm --filter @robota-sdk/agent-core build` + `test` + `pnpm typecheck` → exit 0 (기존 테스트 무회귀); `harness:scan` 통과

## Test Plan

Type BEHAVIOR + tags cli → append-only 보존(무제한 기본) + opt-in trim 유지 단위 테스트 + 빌드/테스트/타입체크/스캔.

| TC-ID | Test Type              | Tool / Approach                                      | Notes    |
| ----- | ---------------------- | ---------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — 무제한 스토어 150개 보존 단언               |          |
| TC-02 | RULE (unit)            | vitest — 기본 매니저 경로 150개 보존 단언            |          |
| TC-03 | RULE (unit)            | vitest — 명시적 캡(3)은 trim 유지 단언               |          |
| TC-04 | CI pipeline smoke test | `pnpm build` + `test` + `typecheck` + `harness:scan` | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 장기 세션 맥락 보존:** 전제: 프로바이더 설정. 실행: `robota`로 도구 호출이 많은 긴 작업을
  진행해 채팅 메시지가 100개를 넘기게 한 뒤, 초기 대화에서 언급한 사실을 다시 질문. 기대: 모델이 초기
  맥락을 여전히 알고 답함(개수 절단으로 잊지 않음). 컨텍스트가 커지면 크기 기반 compaction이 요약으로 처리.
  정리: 없음. Evidence: 100+ 메시지 후 초기 사실 회상 확인(구현 후 기록).

환경: 실제 프로바이더 키 필요(로컬). 단위 테스트로 보존 로직 검증.

## Tasks

- [x] [.agents/tasks/HIST-001.md](../../tasks/HIST-001.md) — task breakdown (TC-01..TC-04)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: BEHAVIOR`, `tags: [cli]`). Problem documents the exact silent
100-message drop (`applyMessageLimit` on every `addMessage`), the confirmed live path
(`robota.ts` → `DEFAULT_MAX_MESSAGES_PER_CONVERSATION=100` → ConversationStore → SimpleConversationHistory),
and the contradiction with the code's own append-only comments + `feedback_history_append_only`.
Architecture Review: 4 checklist items `[x]`; Sibling scan cites compaction-orchestrator/session-history-ops;
2 Alternatives with Con/Pro; Decision records data-preservation + compaction-delegation. Completion
Criteria TC-01..TC-04 command-form/observable; Test Plan rows match TC set 1:1.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "100개 제한 문제는 큰 오류입니다. … 모든 데이터는 보존되어야 하고
context로 처리되어야 … context가 많아지면 사이즈에 따라 자동 또는 수동 compact를 해야 하는 일이지 100개
같은 제한으로 자르는 것은 심각한 오류입니다" — directly authorizes removing the count-based cap and managing
context by size-based compaction. Reinforced by the standing `feedback_history_append_only` principle. No
post-approval drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/HIST-001.md` created and linked. One task per Completion Criterion (TC-01..TC-04)
plus the two default-change tasks. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-core build` → exit 0. agent-core test → exit 0, 48 files
(incl. 3 new append-only cases). Dependent packages `pnpm --filter agent-session --filter agent-framework
--filter agent-executor test` → exit 0 (14/99/11 files), no regressions. `pnpm typecheck` → exit 0
(monorepo). `pnpm harness:scan` → exit 0, 25/25. No package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] agent-core vitest (`conversation-history-manager.test.ts`) — default `ConversationStore` retains all 150 messages; `messages[0].content === 'message 0'` (oldest preserved).
- [GATE-COMPLETE: TC-02] vitest — `new ConversationHistory().getConversationStore(...)` (the live manager path) retains all 150 messages.
- [GATE-COMPLETE: TC-03] vitest — `new ConversationStore(3)` still trims to the last 3 (`['m3','m4','m5']`) — explicit opt-in bounded buffer preserved.
- [GATE-COMPLETE: TC-04] agent-core build + test + dependent-package tests + `pnpm typecheck` + `pnpm harness:scan` all exit 0; no test asserted the former 100-drop, so no regressions.
- Behavior: the live conversation history is now append-only (count cap off by default); context size is managed solely by size-based compaction (auto at 83.5% / manual), which summarizes rather than dropping. Matches the documented design and `feedback_history_append_only`.
