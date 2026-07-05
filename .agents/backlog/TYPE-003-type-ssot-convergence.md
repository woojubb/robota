---
title: 'TYPE-003: 타입 SSOT 수렴: usage 트리플·status union·서브에이전트 미러 → 파생 타입'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-interface-transport, packages/agent-executor, packages/agent-remote-client
depends_on: []
---

# 타입 SSOT 수렴: usage 트리플·status union·서브에이전트 미러 → 파생 타입

Re-audit P2-12 (CONTRACT-002/003/011/012/024 + RUNTIME-47). usage 트리플 명명 3종+인라인 4곳,
status union 이중 선언(값 복사 실증), ISubagentJobState ~20필드 수동 미러, ISessionRecord
unknown[] 완화 미러+캐스트 다리. SPEC 확정 선행.

## What

1. ITokenUsage(agent-core) usage SSOT 확정, 나머지 alias/extends 수렴.
2. TSubagentJobStatus alias; ISubagentJobState Pick/Omit 파생.
3. ISessionRecord ← IInteractiveSessionRecord 통합(캐스트 다리 제거).
4. 동반: WS 연결상태 union 승격(CONTRACT-024), IPC usage 스키마 검증, agent-session deps 중복
   선언 정리(STRUCT-04).

## Test Plan

- 전량 typecheck(파생이므로 컴파일러가 전 소비자 검증); 캐스트 다리 제거 회귀.

## User Execution Test Scenarios

- agent-executable. 라이브 1회 실행으로 usage 값이 provider→세션 로그→summarizeUsageBySource
  전 지점 동일 실측.
- Evidence: (record after execution)
