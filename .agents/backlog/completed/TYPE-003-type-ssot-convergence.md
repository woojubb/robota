---
title: 'TYPE-003: 타입 SSOT 수렴: usage 트리플·status union·서브에이전트 미러 → 파생 타입'
status: done
completed: 2026-07-25
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
- Evidence (2026-07-25, agent-run): `robota -p` 헤드리스 1회 라이브 실행(anthropic
  claude-sonnet-4-6) 후 4개 지점 전부 동일 실측 — (1) provider 원시 페이로드
  `input_tokens 7646 / output_tokens 10`, (2) 세션 로그 정규화 usage
  `{inputTokens 7646, outputTokens 10, totalTokens 7656}` ×3 이벤트, (3) 영속 레코드
  usage-summary 엔트리(`IUsageSnapshot`) `promptTokens 7646 / completionTokens 10 /
totalTokens 7656`, (4) `summarizeUsageBySource` 리포트 및 `main:` 소스 버킷 동일
  트리플. 파생(alias/Exclude/Pick) 강제는 `type-ssot-parity.test.ts`(transport 패키지
  typecheck가 **tests** 포함)로 기계 고정.

## Completion Notes (2026-07-25)

- Item 1 — usage 트리플: `ITokenUsage`(agent-core) SSOT 확정. `ISessionUsageTotals`·
  `IBackgroundTaskUsage` → alias, 인라인 6곳(`IConversationResponse`/`IStreamingChunk`/
  `IOrchestrationStepResult`/`ISubagentJobResult`/`IExtendedAssistantMessage`/
  `IChatResponseData`) + framework 파라미터 1곳 → SSOT 참조, Partial 형상 2곳
  (`IPluginExecutionResult.usage`, `convertUsage`) → `Partial<ITokenUsage>`.
- Item 2 — status union/미러: `TSubagentJobStatus = Exclude<TBackgroundTaskStatus,
'paused'>`, `TSubagentJobMode` alias, `ISubagentJobState`는 공유 20필드 `Pick` 파생
  (로컬 선언은 type/status/promptPreview/currentTool/result/error 6필드, 각각 상이
  사유 문서화).
- Item 3 — 레코드 통합: `ISessionRecord = IInteractiveSessionRecord` alias.
  `unknown[]` 완화 미러(이미 plan/activeBranch 누락 드리프트)와 framework 파사드의
  `as unknown as` 캐스트 다리(DATA-006) 제거. 스토어 런타임 동작 불변.
- 동반 STRUCT-04: agent-session의 `@robota-sdk/agent-core` deps/devDeps 중복 선언 제거
  (레포 전수 스캔 잔존 0).
- 동반 RUNTIME-47(IPC usage 스키마 검증): CORE-024(#선행 PR)에서 이미 해소됨을 재검증 —
  `agent-subagent-runner/child-process-subagent-ipc.ts`의 `hasValidOptionalUsage`가
  result 메시지의 usage 트리플을 검증. 본 건에서 추가 작업 없음(alias 적용으로 타입은
  SSOT에 연결됨).
- 동반 CONTRACT-024(WS 연결상태 union 승격): 감사 시점 중복(구 `agent-web-ui`
  `TConnectionStatus` ↔ playground 훅 union)의 원 소재지 `agent-web-ui`가 GUI-007로
  해체되어 소유 범위 내 중복은 소멸. 잔존 변형은 `agent-transport-gui`(본 건 금지
  구역)·`agent-transport-webrtc-web`·`agent-playground`에 있으며 세 union은 의미가
  분화됨(error/pairing·failed/reconnecting) — 본 건 범위 밖으로 기록, 필요시 별도
  백로그로 승격할 것.
