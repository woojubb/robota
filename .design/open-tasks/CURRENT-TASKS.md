# 현재 진행 작업 (1-2주 목표)

> 즉시 실행해야 할 핵심 작업들입니다. 우선순위 순으로 정렬되어 있습니다.

## 📅 업데이트: 2025-10-16

---

## 🚨 Priority 0: 이벤트 서비스 표준화

### 목표
- `EventService`가 **context 기반 absolute ownerPath**를 표준으로 사용하도록 리팩터링한다.
- prefix 기반 로직을 제거하고, 핸들러가 **`context.ownerPath`만으로** 이벤트 출처/관계를 판별하도록 한다.

### 작업 항목
1. **기반 정리**
   - [x] `ActionTrackingEventService` 제거(새 구조에서는 사용 금지)
   - [x] 사용처 목록화 및 제거 계획 수립:
      - [x] `packages/agents/src/core/robota.ts` (기존 `src/agents/`에서 이동 완료)
        - [x] `ActionTrackingEventService` 생성 분기 제거, 기본 EventService + ownerType='agent' 주입
        - [x] agent 이벤트 emit 시 ownerPath 기반 context helper 도입 (필요 시 즉시 계산)
        - [x] `agentOwnerContext` 필드 제거, helper가 ownerPath를 매번 조합
        - [x] 파일 경로 이동 및 관련 import 업데이트(`src/core/` 사용)
      - [x] `packages/agents/src/services/execution-service.ts`
        - [x] `maybeClone` 로직 대체: ownerType 인자 전달 + ownerPath append
        - [x] legacy `clone({ ownerPrefix })` 호출 제거
      - [x] `packages/team/*` deprecated 취소(팀 관련 MCP 도구 유지). “팀 패키지 제거” 목표는 더 이상 유효하지 않음.
      - [ ] `apps/web/src/lib/playground/robota-executor.ts`, `apps/examples/26-playground-edge-verification.ts` 등
        - [x] Playground 환경에서 EventService를 직접 생성하지 말고 SDK에서 주입받은 것을 사용
        - [x] 테스트/예제 코드도 ownerPath 기반 context로 업데이트
   - [x] 외부 re-export(`ContextualEventService` 등) deprecated 공지 및 향후 제거 계획 추가
   - [x] 기본 `EventService`에 `emit(eventType, payload, context)` 시그니처 표준화
   - [x] `SilentEventService` 제거 및 추상 클래스화
     - [x] `DEFAULT_ABSTRACT_EVENT_SERVICE` 단일 기준으로 통일(`DEFAULT_EVENT_SERVICE` 제거)
     - [x] DI 기본값을 Abstract no-op으로 교체 (agents/core/robota, execution-service, team container, delegated-agent relay, assign-task, create-team)
     - [x] Tools/Playground DI 전환 잔여
     - [x] **1순위: ToolExecutionService + Tools/Playground DI(ownerPath-only) 잔여 마감**
       - 배경(현상)
         - `ExecutionService`는 tool call 단위로 `ownerPath`를 만들고(`buildToolOwnerContext`), tool-call scoped `EventService`를 만들 수 있음(`ensureToolEventService`).
         - 하지만 현재 `ToolExecutionService`/`ToolExecutionContext` 경로에는 **tool-call scoped EventService를 Tool 실행까지 전달할 “단일 타입/경로”가 부재**하여, ownerPath-only 설계를 끝까지 관철하기 어려운 상태.
         - Web Playground(`apps/web`)는 아직 `ActionTrackingEventService`/Bridge를 직접 생성하는 코드가 존재하여 “Playground에서 EventService 직접 생성 금지” 목표와 충돌.

       - 결정(단일 경로, No-Fallback)
         - **[필수] Tool 실행 컨텍스트에 EventService를 타입 안전하게 포함시키는 단일 설계로 고정**
           - `packages/agents/src/interfaces/` 레이어에 `EventService`(또는 `EventServiceInterface`)와 `OwnerPathSegment`/`EventContext` 최소 타입을 두고,
           - `packages/agents/src/services/event-service.ts`는 이를 구현/확장(또는 재-export)하며,
           - `ToolExecutionContext`에 `eventService?: EventService`를 추가하여 **tool call마다 ownerPath-bound instance를 전달**한다.
         - 금지: Tool/Workflow 연결을 위해 ID 파싱/추론/정규식 사용, 지연 연결, 캐시 기반 추론, fallback 경로(대체 구현) 추가.

       - 작업 체크리스트(파일/함수 단위)
         - SDK(agents)
           - [x] `packages/agents/src/interfaces/*`
             - [x] `EventService` 최소 계약을 인터페이스 레이어로 이동/신설 (`interfaces/event-service.ts`)
             - [x] `ToolExecutionContext`에 `eventService?: EventService` 추가 (타입 안전)
             - [x] `unknown` 제거: `Record<string, unknown>`/index signature 제거 후 `ContextData`/`UniversalValue` 기반으로 치환
           - [x] `packages/agents/src/services/execution-service.ts`
             - [x] tool call마다 `ensureToolEventService(...)`로 scoped EventService를 만든 뒤, 해당 인스턴스를 `ToolExecutionContext.eventService`로 주입해 Tool 실행까지 전달
             - [x] payload에는 domain data만 유지, 계층/출처 정보는 context(ownerPath)로만 전달
            - [x] `packages/agents/src/services/tool-execution-service.ts`
             - [x] `Date.now()`/`Math.random()` 기반 executionId 생성 제거(상위에서 제공된 toolCallId 사용, executionId 미제공 시 fail-fast)
             - [x] `assignTask` 전용 분기/로그 제거(도구 중립)
             - [x] Batch/Single 실행에서 `ToolExecutionContext.eventService` pass-through 완료
             - [x] `RelayMcpTool`: `context.eventService`를 단일 진실로 사용하도록 전환 (options 기반 의존 제거)
              - [x] 기타 Tool 구현체(`getEventService()` 의존) 점검 후 `context.eventService` 우선/필수 규칙으로 전환 (현 코드 기준: `RelayMcpTool`만 대상)

         - Playground(web)
          - [x] `apps/web/src/lib/playground/robota-executor.ts`
            - [x] `ActionTrackingEventService`/BridgeEventService 직접 생성 제거
            - [x] DI-only: `EventService`/`WorkflowEventSubscriber`를 외부에서 주입받아 사용 (executor 내부 new 금지)
            - [x] `console.*` 제거 후 logger DI 사용

       - 완료 조건(이 항목만)
         - [x] Tool/Playground 코드에서 **EventService 직접 생성 경로가 0**이 된다(DI-only).
         - [x] Tool이 agent를 생성하는 경우에도 ownerPath-only로 연결된다(툴 세그먼트 포함 ownerPath를 그대로 이어받고 `{ type: 'agent', id }`만 append).
         - [x] 이벤트명 하드코딩 금지(소유 모듈 상수만 사용), prefix/ID 파싱/추론/지연 연결/폴백 없음.
     - [x] `SilentEventService` 파일 삭제: `AbstractEventService`가 기본 no-op 구현을 내장하고, 필요 시 `DEFAULT_ABSTRACT_EVENT_SERVICE` 상수로 제공
     - [x] SilentEventService 잔여 참조 0건 확인 및 문서/코드에서 관련 문구 제거 (삭제가 목표, deprecated 문구 금지)
     - [x] Context binder 규약 적용: `bindWithOwnerPath` 단일 헬퍼 도입, createContextBoundInstance 단순화(ownerPath-only), 필수 필드 미제공 시 throw(노-폴백), prefix/ID 파싱/캐시 금지
2. **Context 구조 도입**
   - [ ] `OwnerType`, `OwnerPathSegment` 타입 정의 (`type`, `id?`)
   - [ ] EventService clone 시 `ownerPath`(부모→자식) 자동 append 로직 구현
   - [ ] emit 호출부 전수 조사: context에 `ownerType`, `sourceId` 등 공통 필드만 넣도록 리팩터링
   - [ ] EventContext helper 정비
     - [ ] `buildOwnerContext(ownerType, ownerId, extraSegments?)` 헬퍼 추가로 context 생성 책임 집중
     - [ ] 각 emit 지점이 parentExecutionId, thinkingId 등 ID 필드를 payload가 아닌 context metadata/segment에만 기록하도록 규칙화
     - [ ] 핸들러 측에서 `context.ownerPath`만으로 source ID를 복구할 수 있도록 테스트 케이스 추가
3. **핸들러 업데이트**
   - [x] 핸들러에서 prefix 기반 분기를 제거하고 `context.ownerPath` 기반 helper로 출처 판별 — 2025-11-30 Tool/Agent handler path-only refactor
  - [x] Path-only 검증: Guarded 예제 26/27 실행 후 로그/노드 수 점검
     - 배경/의도(리팩토링 검증)
       - 지금까지의 ownerPath-only/DI 리팩토링이 **이론적으로 타당하다면**, Guarded 예제(시나리오 재생 기반)를 “쉽게” 구현/유지할 수 있어야 한다.
       - 반대로, 예제를 구현하기 어렵거나 이상한 예외/누락 edge가 반복된다면 그것은 “예제 문제”가 아니라 **리팩토링 설계의 누락/모순을 드러내는 신호**로 취급한다.
       - 따라서 이 단계의 목표는 “예제 구현” 자체가 아니라 **리팩토링 설계를 실제로 검증하고, 개선점/더 나은 방향을 도출**하는 것이다.

     - 결정(단일 경로 / No-Fallback)
       - 선택: **2) 26은 deprecated로 잠그고, 새로운 guarded 예제로 분리**
       - `apps/examples/26-playground-edge-verification.ts`는 **실행 즉시 실패**하도록 잠금(재실행 방지).
       - 검증용 실행 파일:
         - `apps/examples/26-guarded-edge-verification.ts`
         - `apps/examples/27-continued-conversation-edge-verification.ts`
       - 자동화/스크립트는 위 guarded 파일만 호출하도록 고정한다(legacy 26 파일 호출 금지).

     - 실행 방식(Guarded)
       - 예제 실행은 **scenario playback(offline) 기반**으로만 수행한다.
       - `SCENARIO_PLAY_ID` 필수, `SCENARIO_PLAY_STRATEGY=sequential` 고정(리팩토링으로 인한 request-hash coupling 방지).
       - 예제 실패(비정상 exit) 또는 로그에 `[STRICT-POLICY]` / `[EDGE-ORDER-VIOLATION]` 포함 시 **검증 스크립트는 실행하지 않는다**(가드).

     - 산출물/입력 파일(검증 스크립트 불변)
       - 예제는 `apps/examples/data/real-workflow-data.json`를 생성/갱신한다.
       - 검증은 `apps/examples/utils/verify-workflow-connections.ts`(골드 스탠다드, 수정 금지)로만 판정한다.

     - 체크리스트(코드/문서)
       - [x] `apps/examples/26-playground-edge-verification.ts` 실행 방지(즉시 throw) + deprecated 의도 주석 추가
       - [x] Guarded 예제 파일 분리
         - [x] `apps/examples/26-guarded-edge-verification.ts` 생성(시나리오 재생 → 워크플로우 데이터 생성)
         - [x] `apps/examples/27-continued-conversation-edge-verification.ts` 생성(continued conversation 시나리오 기반)
       - [x] `apps/examples/utils/run-and-verify-workflow.ts`가 guarded 예제만 실행하도록 전환(legacy 26 호출 제거, timeout 제거)
       - [x] `apps/examples/package.json` 스크립트에서 legacy 26 호출 제거
      - [x] Guarded 예제 26 실행(가드) + verify 통과
      - [x] Guarded 예제 27 실행(가드) + verify 통과
      - [x] 결과 기록(노드/엣지 수, 실패 시 rule 위반 유형) 및 리팩토링 개선점 제안 정리
4. **문서 & 검증**
   - [x] `.design/event-system` 문서 업데이트 (prefix 제거, ownerPath 규칙)
   - [x] CURRENT-TASKS 진행 기록 추가 및 전환 조건 명시
5. **Payload/emit 헬퍼 단순화**
   - [ ] DOM 이벤트 모델처럼 `BaseEventData` + 파생 타입(Execution/Tool/Agent)을 정의하여 필드를 역할별로 분리
   - [x] `emitExecutionEvent<T extends ExecutionEventData>`/`emitToolEvent<T extends ToolEventData>` 헬퍼를 제네릭으로 재작성하고 context 생성만 담당하도록 축소 (2025-11-30)
   - [x] `ServiceEventData`에서 `rootExecutionId`, `parentExecutionId`, `executionLevel`, `path`, `thinkingId` 등 ownerPath로 유추 가능한 필드를 제거
   - [ ] **ExecutionService 단계**
     1. [ ] `execution.start`/`user_message`/`assistant_message_*` payload 최소화 (이미 진행 중)  
     2. [x] Tool emit(`tool.call_*`, `tool_results_*`)에서 context로 이전 가능한 필드 제거 — 2025-11-30 ExecutionService emit helper 개편  
     3. [x] 스트리밍 모드 emit도 동일하게 정리 — 2025-11-30 ExecutionService emit helper 개편  
     4. [x] ToolExecutionService 요청에 필요한 계층 정보는 metadata로 유지하되, emit payload와 혼동되지 않도록 주석/타입 분리 — 2025-11-30 ToolExecutionService ownerPath/metadata 리팩터  
     5. [x] ExecutionService emit 헬퍼 단일화: `emitExecution`/`emitTool` → `emitWithContext`로 공통 처리, 호출부에서는 도메인 데이터만 전달 (2025-12-05)
   - [ ] **Tool/Agent emit 단계**
     1. 각 도메인 emit helper를 새 타입으로 업데이트  
     2. payload에는 고유 데이터만 유지, 계층 정보는 context ownerPath로 전달  
     3. 필요 시 Agent/Tool 측에서 공통 helper (예: `buildAgentOwnerContext`) 도입
   - [ ] **Context ownerPath-only 규칙 수립**
     1. ExecutionService payload에서 `metadata.rootExecutionId`, `metadata.parentExecutionId`, `metadata.executionId`, `metadata.conversationId` 등 ownerPath에서 파생 가능한 필드를 전부 제거  
     2. ToolExecutionService와 각 Tool 구현에 “context.ownerPath 외에는 계층 정보 제공 금지” 규칙 명시 (ownerType/ownerId/sourceId는 context에서만 제공)  
     3. 핸들러/검증 코드에 `getNearestOwner(ownerPath, targetType)` 헬퍼 추가 후 `rootExecutionId` 등 기존 필드 의존 제거  
     4. `.design/event-system/event-payload-normalization.md`에 “context=ownerPath-only, payload=domain data-only” 원칙과 예시 추가  
     5. Guard 예제 26/27 실행으로 ownerPath-only 설계가 기존 그래프와 동일하게 작동하는지 검증
   - [ ] **EventService 인스턴스 소유자 고정화 + source 자동화**
     1. [x] ExecutionService 실행 시점에 EventService를 `ownerType='agent'`, `ownerId=conversationId`로 바운드하고, 실행 종료/스트리밍 종료 후 scope를 초기화한다.  
     2. [x] ToolExecutionService/ExecutionService가 tool call마다 tool-call scoped `context.eventService`를 ToolExecutionContext로 전달한다(DI-only, ownerPath-only).  
     3. [x] `emitExecutionEvent`/`emitToolEvent`/`Robota.emitAgentEvent` helper에서 payload에 `sourceType`, `sourceId`, `timestamp`를 수동 전달하지 않고, owner-bound EventService가 자동으로 채우도록 정리했다.  
     4. [x] EventService는 내부 `ownerContext`를 통해 `ownerType/sourceId`를 고정하고, `emit` 호출 시 `context.ownerPath`와 병합하여 `ownerPath`를 자동 연장한다. timestamp는 `data.timestamp ?? new Date()`로 일괄 처리하고, payload에는 들어가지 않도록 강제했다.  
     5. [x] `.design/event-system/event-payload-normalization.md`에 “EventService 인스턴스=단일 owner, emit helper 자동 source/timestamp” 규칙을 명시하고, Guard 예제 문서에도 동일한 체크리스트를 추가한다.  
     6. [ ] 완료 조건: `ExecutionService`, `ToolExecutionService`, `Robota`, `SubAgentEventRelay`, `team/create-team` 등 EventService 주입 지점 전부가 owner-context-bound 인스턴스만 사용하며, lint/rg 기준 `sourceType:` 수동 전달이 전부 제거된다. (현재 ExecutionService/Robota/SubAgentRelay 적용 완료, Team/ToolExecutionService 남음)
  - [x] **Workflow 핸들러 단계**
    1. [x] `context.ownerPath` 기반으로 handler들이 노드/엣지를 생성한다(폴백/추론/지연 연결 없음).  
    2. [x] 기존 `parentExecutionId/rootExecutionId` 참조를 제거하고 ownerPath-only로 고정한다.  
    3. [x] Guard 예제 26/27 실행으로 회귀 테스트 PASS
6. **이벤트 데이터 정규화 수준 평가**
   - [x] 이벤트 종류별(payload 구조) 전체 목록 작성: execution.*, agent.*, tool.*, team.* 각각 필드 표로 정리
   - [x] 각 필드가 context에서 파생 가능한지 여부를 체크리스트로 표시하고, “payload 필수/선택/제거 가능” 라벨링
   - [x] 공통 메타데이터(`metadata`, `parameters`)에 허용되는 키 집합을 정의하고, 자유형 객체가 필요한 경우 사유를 문서화
    - [ ] 정규화 제안서 작성: 
      - [x] 기본 스키마 초안(JSON Schema 수준)과 예시 payload 추가
      - [x] context로 이동할 필드, payload에 유지할 필드 목록을 대응표로 작성
   - [ ] Guard 예제 26/27 실행 전후 비교로 정규화가 Node/Edge 생성에 미치는 영향 평가
   - [x] 평가 결과를 `.design/event-system` 폴더에 별도 문서로 정리하고 CURRENT-TASKS에 링크
     - 문서: `.design/event-system/event-payload-normalization.md`

---

## 🔥 Priority 1: Agent Event Normalization (진행중)

### 목적
- `.design` 전역 문서를 최신 상태로 유지하고, CURRENT-TASKS 단일 소스로 계획을 집중한다.
- 중복 계획/구버전/비어 있는 섹션을 식별하여 주석으로 표시한 뒤, 실제 내용을 최신 정보로 교체한다.

### 실행 단계
1. **스코프 매핑**
   - [ ] `.design` 루트 하위 디렉터리 전수 조사 (open-tasks, event-system, planning, web, remote, robota-saas-website 등)
   - [ ] 각 파일별 업데이트 시점/주요 주제 요약 작성
   - [ ] CURRENT-TASKS와 직결되는 문서 우선순위 지정

2. **상태 분류**
   - [ ] 중복 항목: CURRENT-TASKS와 동일한 체크리스트/플랜이 반복되는 경우
   - [ ] 구버전 항목: 완료된 사실과 상충하거나 오래된 일정
   - [ ] 빈 섹션: 템플릿만 존재하고 내용이 비어 있는 경우
   - [ ] 진행 보류: 실행 계획이 없는 선언적 항목

3. **주석 표시 계획**
   - [ ] 각 문제 구간 직후 `<!-- TODO: CURRENT-TASKS 중복 → 통합 필요 -->` 형태의 주석 초안 작성 (한국어)
   - [ ] 주석에는 “무엇이 구식인지/어디로 통합할지/누락 정보”를 간단 요약
   - [ ] 주석 추가 순서는 Priority 1 관련 문서 → 이벤트 규격 문서 → 웹/원격 계획 문서 순

4. **업데이트 및 주석 제거**
   - [ ] 주석에 적힌 항목부터 최신 정보로 갱신
   - [ ] 내용 갱신 직후 해당 주석 삭제
   - [ ] 갱신 완료한 문서는 README나 CURRENT-TASKS에서 링크 업데이트

5. **검증/보고**
   - [ ] `rg "<!-- TODO"`로 남은 주석이 없는지 확인
   - [ ] 최신화된 문서 목록/주요 변경점/후속 TODO를 CURRENT-TASKS 진행 기록에 추가

### 참고 명령어
```bash
cd /Users/jungyoun/Documents/dev/robota/.design
rg "<!-- TODO" -n
rg "Priority" -g"*.md"
```

---

## 🔥 Priority 1: Agent Event Normalization (진행중)

### 완료된 단계
- [x] 단계 1: Agent가 스스로 올바른 이벤트 emit 보장
- [x] 단계 2: Agent.created에서 Agent 노드 생성
- [x] 단계 4: Tool 핸들러의 Agent 노드 중복 생성 방지
- [x] 단계 5: 도구측 대리 이벤트 발행 제거
- [x] 단계 6: 예제 26 동작/데이터 동등성 확인
- [x] 단계 7: 최종 정리 (Tool 핸들러 분기 삭제)

### 남은 작업

      - [ ] context 전파 규칙
        - [ ] ExecutionService가 Agent를 생성할 때 현재 scenario context를 복제해 child agent에 주입
        - [ ] Provider Recorder/Mock는 기존대로 context만 받으면 자동으로 동작하므로, Tool mock → Agent → Provider로 이어지는 체인이 완성
      - [ ] 검증/감시
        - [ ] playback 모드에서 실제 Tool/Provider 호출이 발생하면 즉시 예외
        - [ ] scenario step 소비 여부(tracking) → replay 후 미사용 step 존재 시 실패 처리
  - [ ] 추가 세분화:
    - [ ] Mock Provider 응답 시퀀스 로더 구현 계획 (파일→메모리→provider)
    - [ ] Recorder가 파일에 append 시 concurrency/ordering을 어떻게 보장할지 결정 (예: timestamp-based filename)
    - [ ] Scenario 관리 CLI 초안 (`pnpm scenario:record`, `pnpm scenario:play`)
    - [ ] 예제별 기본 시나리오 목록 정의 및 문서화
    - [ ] Mock Provider 사용 시 Guarded 실행 절차(옵션 플래그, 환경변수 등) 문서화
    - [ ] Recorder/Playback 모드 구분 명시:
      - [ ] `recordScenarioId` 설정 시: 실제 AI Provider를 호출하고 응답을 저장, Mock Provider는 단순 래퍼 역할
      - [ ] `mockScenarioId` 설정 시: 저장된 응답만 재생하고 실제 Provider 호출 금지(데이터 미존재 시 즉시 실패)
      - [ ] 두 옵션이 동시에 설정되지 않도록 검증 로직 포함
  - [x] 1) 시나리오 JSON 스키마 세부 정의
    - [ ] 루트 구조: `{ "scenarioId": string, "version": 1, "steps": Step[] }`
    - [ ] Step 필드:
      - [ ] `stepId`: `"agent-exec-1"`, `"tool-call-2"` 등 명시적 식별자
      - [ ] `request`: provider 호출 입력(payload, metadata, executionId, conversationId, temperature 등)
      - [ ] `response`: LLM/Tool 결과 전체(텍스트, tokens, usage, streamChunks 배열)
      - [ ] `timestamp`: epoch number, 순차 검증용
      - [ ] `tags`: `["assignTask","round1"]` 등 필터용
    - [ ] Stream 대응: `response.stream` 배열(각 chunk content + index)와 `response.final` 동시 저장
    - [ ] Hash 필드: `requestHash`(prompt 기반 md5)로 입력 동일성 검증
    - [ ] 파일 예시: `apps/examples/scenarios/26-guard-round1.json`
  - [x] 2) Recorder 래퍼 설계
    - [ ] `ScenarioRecordingAIProvider` (decorator) 생성: 내부에 실제 provider 인스턴스 보관
    - [ ] `recordScenarioId` 제공 시에만 활성화, 없으면 즉시 실제 provider만 반환
    - [ ] 실행 순서:
      1. 입력 payload + metadata 수집 → hash 계산
      2. 실제 provider 실행 → 결과 획득
      3. `ScenarioStore.append(record)` 호출해 JSON step 추가 (동시에 write lock)
    - [ ] Recorder 옵션:
      - [ ] `AgentConfig.recordScenarioId`
      - [ ] `ScenarioRecordOptions.persistRawPrompt` (PII 포함 시 암호화 고려)
    - [ ] 실패 시 정책:
      - [ ] 파일 쓰기 실패 → 테스트 중단 (no-fallback)
      - [ ] hash 충돌 발생 → 경고 후 기존 step 비교(동일 응답이면 skip, 다르면 오류)
  - [x] 3) Mock Provider(Playback) 세부 계획
    - [ ] `MockAIProvider`는 `mockScenarioId` 필수, 없으면 생성 자체를 막음
    - [ ] ScenarioStore가 메모리에 로드한 steps 배열에서 `requestHash` 또는 `stepId`로 매칭
    - [ ] 일치 항목 없으면 즉시 예외(`ScenarioMissingError`) 던져 Guard 실패로 이어지게 함
    - [ ] Stream 응답: 저장된 `response.stream` 배열을 순서대로 yield
    - [ ] 사용 옵션:
      - [ ] `AgentConfig.mockScenarioId`
      - [ ] `AgentConfig.mockStepStrategy`: `sequential`/`byHash` 중 택
    - [ ] Mock Provider 사용 시 실제 provider 인스턴스 생성 금지(불필요 비용 방지)
  - [x] 4) Scenario 저장소/CLI/옵션 wiring
    - [ ] 저장소 구조:
      - [ ] `apps/examples/scenarios/README.md`에 사용법 정리
      - [ ] 파일명 규칙: `<example>-<scenario>-v<timestamp>.json`
      - [ ] `.gitkeep` 유지 + 대형 파일 관리(필요 시 git-lfs 고려)
    - [ ] ScenarioStore 유틸:
      - [ ] `ScenarioStore.load(scenarioId)` → steps 배열
      - [ ] `ScenarioStore.append(scenarioId, step)` → atomic append
    - [ ] CLI 초안:
      - [ ] `pnpm scenario:record --example=26 --scenario=mandatory-delegation`
      - [ ] `pnpm scenario:play --example=26 --scenario=mandatory-delegation`
  - [ ] Execution wiring:
    - [x] `apps/examples/26-playground-edge-verification.ts`에서 env 플래그 기반 Recorder/Mock provider 주입 (추후 공용 AgentConfig 옵션으로 승격 예정)
    - [x] Guarded 예제 실행 스크립트에서 동일 env 플래그를 사용해 record/play 모드 선택
    - [ ] README에 dev flow 문서화 (Recorder→Playback→Guard 순서)

#### 단계 3: execution_start 상태 전이 우선 (하위 호환)

**목표**
- `agent.execution_start` 이벤트가 기존 Agent 노드의 상태만 전이하도록 정규화한다.
- Legacy 임시 생성 로직은 “노드를 찾을 수 없을 때만” 작동하도록 격리하고 단계 6.5에서 제거할 준비를 한다.

##### 완료 현황
- [x] **이벤트 흐름 및 영향 범위 재구성** – emit 지점과 payload 필드를 모두 문서화하여 `agent.created` ↔ `agent.execution_start` 간 의존성을 명확히 했다.
- [x] **기존 노드 재활용 조건 정의** – `agentNodeIdMap`/`WorkflowState` 매핑을 1차 키로 사용하고, 필요 시 `getAllNodes()`를 read-only로 스캔하여 sourceId가 일치하는 단일 노드만 허용하도록 규칙을 확정했다.
- [x] **임시 생성 하위호환 블록 분리** – 모든 탐색 경로가 실패했을 때만 fallback을 실행하고, 경고 로그 및 `// TODO(step 6.5)` 주석을 추가하여 제거 대기 상태로 표시했다.
- [x] **상태 전이 데이터 시나리오 정리** – snapshot 확보 → 상태 갱신 → originalEvent 병합 → WorkflowState 재연결 → history append 순서를 확정하고 예외 케이스(idempotent 처리, partial data)를 정의했다.
- [x] **검증 시나리오/빌드 준비** – 워크플로우/팀/에이전트 빌드 순서와 Guarded 예제 26 실행 포인트를 정리했으며, 노드/엣지 카운트와 logger.warn 모니터링 기준을 설정했다.
- [x] **체크리스트 & 진행 로그 운영 규칙** – 완료 항목 요약 방식, 범위 변경 메모, Guard 결과 링크 기록 규칙을 마련했다.
- [x] **Guard 실패 가설/재현 정리** – start node 3개, 컴포넌트 단절, timestamp 충돌 등 핵심 가설을 실제 데이터로 재현해 원인(부모 엣지 누락, WorkflowState 미스매치, timestamp 규칙 부재)을 문서화했다.
- [x] **Mock AI Provider + Recorder 구축** – `ScenarioRecordingProvider`/`ScenarioMockAIProvider`와 `apps/examples/scenarios/*.json` 저장소를 완성하고, Guarded 예제 26을 record/play 양 모드로 PASS했다. (환경 변수, hash 기반 매칭, fail-fast 정책 포함)

##### 시뮬레이션 개요 (실행 흐름 요약)
- 상세 시뮬레이션 문서는 `.design/event-system/agent-execution-start-stage3.md`에 정리되어 있습니다.
- 핵심 이벤트/요구 사항 요약:

| 순서 | 이벤트 | 생성/갱신 대상 | 필수 엣지 | Timestamp |
| --- | --- | --- | --- | --- |
| 1 | `execution.user_message` | `user_message` 루트 | 없음 | `ts0` |
| 2 | `execution.assistant_message_start` (round1) | `thinking_round1` | `user_message → thinking (processes)` | `ts0 + 1` |
| 3 | `tool.call_start` | `tool_call` | `thinking_round1 → tool_call (invokes)` | `ts0 + 2` |
| 4 | `agent.created` (delegated) | 하위 Agent 노드 | `tool_call → agent (spawn)` | `ts_child` |
| 5 | `agent.execution_start` | 기존 Agent 노드 상태 전이만 | 엣지 없음 | `ts_child + ε` |
| 6 | `execution.assistant_message_complete` (delegated) | delegated agent response | `agent_thinking → response (return)` | 증가 |
| 7 | `tool.call_response_ready` | `tool_response` | `delegated response → tool_response (result)` | parent 증가 |
| 8 | `execution.tool_results_ready` | `tool_result` | 모든 `tool_response → tool_result (result)` | `parent + ε` |
| 9 | `execution.assistant_message_start` (round2) | `thinking_round2` | `tool_result → thinking_round2 (analyze)` | `parent + 2ε` |
| 10 | `execution.assistant_message_complete` (final) | 최종 response | `thinking_round2 → response (return)` | 증가 |

- Timestamp 규칙: 동일 path 내 신규 노드는 직전 노드보다 최소 +1, round2 thinking은 `tool_result`보다 항상 커야 함.
- WorkflowState 규칙: `agent.created`에서 map을 등록하고, `agent.execution_start`는 동일 sourceId 노드만 갱신한다(연결 정보 부족 시 즉시 실패, No-Fallback).

##### 남은 작업
1. **이론 시뮬레이션 기록**
  - [x] assignTask fork 시나리오(user_message → thinking → tool_call → delegated agent → tool_result → thinking_round2 → response)를 표/다이어그램으로 정리하고 Path-only 조건을 명시한다.
    - 문서: `.design/event-system/assign-task-fork-scenario.md`
  - [x] 각 이벤트의 edge 타입, timestamp 공식, WorkflowState 업데이트 요건을 정의하여 “start node 1개·단일 컴포넌트·순차 timestamp” 조건을 체크한다.
  - [x] 시나리오별(예제 26/27) 차이를 비교하고, 필요한 수정 포인트 목록을 `.design` 문서에 요약한다.
2. **구현/검증 순서**
   1. 코드 준비
      - [ ] `agent-event-handler.ts`에 `updateAgentExecutionState(event)` 헬퍼 추가 (status 갱신, WorkflowState 연동, logger.warn fallback).
        - [ ] 입력 검증: `sourceId` 누락 시 즉시 에러 throw (No fallback).
        - [ ] `AgentNodeLookupResult` 타입 도입: `{ agentNodeId, sourceId, executionId, rootExecutionId }`.
        - [ ] `WorkflowState`와 `agentNodeIdMap`에서 재활용 노드를 찾고, 실패 시 `findAgentNodeBySourceId()` read-only 스캔 사용.
        - [ ] 상태 업데이트 순서: `status→originalEvent merge→statusHistory append→WorkflowState set`.
      - [ ] `workflow-state.ts`에 `getOrCreateAgentNode(sourceId)` / `setAgentForExecutionSafe(executionId, agentNodeId)` 등 헬퍼 구현.
        - [ ] `getOrCreateAgentNode`는 fallback 시 노드 생성 + logger.warn을 호출하고, 생성 경로에 `// TODO(step 6.5)` 주석 추가.
        - [ ] `setAgentForExecutionSafe`는 executionId 없을 때 root 기반으로만 갱신하며, 기존 값과 다르면 debug 로그를 남긴다.
        - [ ] timestamp helper(`ensureTimestampGreater(nodeId)`) 도입 여부 평가 및 필요 시 구현.
      - [ ] fallback 분기에는 `// TODO(step 6.5): remove legacy fallback` 주석과 `[LEGACY-FALLBACK]` warn 로그를 박고, 사용 시 Scenario 로그에 남기도록 설계.
   2. 빌드/테스트 스크립트
      - [ ] 아래 순서를 하나의 shell 스크립트로 작성해 CURRENT-TASKS에 경로를 명시:
        ```
        pnpm --filter @robota-sdk/workflow build &&
        pnpm --filter @robota-sdk/team build &&
        pnpm --filter @robota-sdk/agents build &&
        cd apps/examples &&
        FILE=26-playground-edge-verification.ts && \
        HASH=$(md5 -q "$FILE") && \
        OUT=cache/26-playground-edge-verification-$HASH-guarded.log && \
        STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?
        ```
      - [ ] 실패 시 `tail -n 120 "$OUT"`을 첨부하고, STRICT-POLICY/EDGE-ORDER-VIOLATION 존재 여부를 체크하는 명령 포함.
   3. 결과 보고 포맷
      - [ ] 진행 기록 섹션에 붙일 표 템플릿:
        | 날짜 | 빌드 결과 | Guard 결과 | Agent 노드 수 | WARN 로그 | 비고 |
      - [ ] fallback 경고 발생 시 scenario 로그 파일 경로와 fallback 횟수를 함께 기록.
   4. 전환 조건 정의
      - [ ] “fallback warn 0회, Guard PASS 2회 연속”을 단계 6.5 진입 조건으로 명시.
      - [ ] 조건 충족 시 Priority 1 섹션에 “Stage3 → Stage6.5 hand-off ready” 메모 추가.
3. **이벤트 서비스 표준화**
   - [x] `ActionTrackingEventService` 제거하고, 기본 `EventService`를 ownerPath context 기반으로 고정한다.
   - [ ] emit 시그니처를 `emit(eventType, payload, context)`로 통일하고, context에는 `ownerPath`와 공통 필드(`ownerType`, `sourceId` 등)만 포함한다. 계층별 특수 필드는 허용하지 않는다.
   - [ ] `ownerPath`는 `Array<{ type: OwnerType; id?: string }>`와 같이 타입/클래스를 명확히 선언하고, EventService clone 시 부모 → 자식 순서로 `{ type: ownerType, id: ownerId }` segment를 append하여 자동 확장한다.
   - [ ] 각 소유자는 `new EventService({ ownerType: 'execution' })` 또는 `ownerContextProvider`로 자신이 속한 타입을 명시하고, 동일한 context 구조를 유지한다. 필요 시 helper로 `appendOwnerSegment(ownerType, ownerId)` 제공.
   - [ ] prefix 자동 부착/검증 로직을 제거하고, 이벤트 핸들러는 `context.ownerPath`와 공통 필드를 기반으로 출처를 판별하도록 업데이트한다. path helper(`getNearestOwner(ownerPath, 'execution')`)를 제공해 필요한 ID를 가져온다.
4. **Scenario Recorder 확장** (상세 설계: `.design/event-system/scenario-recorder-expansion.md`)
   1. 환경 스냅샷
      - [ ] `ScenarioEnvironment` 인터페이스 정의 (`scenarioId`, `version`, `environment: { agentConfig, toolRegistry, executionContext }`).
      - [ ] `ScenarioStore.saveEnvironment()` 구현: scenario JSON의 루트에 environment를 1회만 기록하고, playback 시 로드하여 AgentConfig/ToolRegistry를 초기화.
   2. Tool Recorder/Mock
      - [ ] `ScenarioToolRecorder` 클래스 작성: Tool 실행 직전에 `recordToolCall(step)` 호출, 결과/오류/childContext 저장.
      - [ ] `ScenarioToolMock` 클래스 작성: playback 모드에서 step을 sequential/byHash 전략으로 찾아 반환, step 미존재 시 `ScenarioMissingError`.
   3. CLI/README
      - [ ] `pnpm scenario:record --example=26 --scenario=mandatory-delegation` 스크립트 추가 (환경 변수 세팅 포함).
      - [ ] `pnpm scenario:play ...`, `pnpm scenario:verify ...` 명령 작성 및 README에 실행 플로우(Recorder→Playback→Guard) 문서화.
      - [ ] concurrency/ordering 안내: 동일 scenario에 동시 append 금지, timestamp 기반 파일명 규칙 명시.
   4. Guard 통합
      - [ ] Guard 스크립트가 `SCENARIO_RECORD_ID`/`SCENARIO_PLAY_ID`를 감지해 Recorder/Mock를 자동 주입하도록 업데이트.
      - [ ] playback 모드에서 실제 Provider/Tool 호출 감지 시 즉시 실패하도록 감시 로직 추가 (`assertNoRealCalls()`).
      - [ ] scenario step 소비 여부 추적 후, 미사용 step이 남으면 “[SCENARIO-UNUSED] …” 경고를 띄우고 실패 처리.

#### 단계 6.5: 단일 전환 단계 (Decision Gate)
- [ ] Agent 핸들러: `agent.execution_start`는 상태 전이만 (노드 생성 절대 금지)
- [ ] 단계 3의 "없을 때만 임시 생성" 하위호환 로직 완전 제거
- [ ] 팀/툴 발행자: `tool.agent_execution_started` emit 완전 제거
- [ ] 상수 제거: `packages/team/src/events/constants.ts`
- [ ] 빌드/가드/검증 (원샷 검증)

#### 단계 6.6: Fork/Join round2 thinking 연결 교정
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `execution.assistant_message_start`에서 연결 소스 결정 규칙 교정
  - [ ] 동일 `rootExecutionId` 내 최신 thinking 노드 찾기 (Path-Only)
  - [ ] `tool_result` 중 `parentThinkingNodeId` 일치하면 `analyze` 엣지
  - [ ] 미발견 시 `user_message → thinking` (processes)
- [ ] 빌드/가드/검증
- [ ] round2 연결 검증: `tool_result → thinking_round2 (analyze)`

#### 단계 8: Subscriber Path Map Reader (선택, 우선순위 낮음)
- [ ] `PathMapReader` 객체 설계 (읽기 전용)
- [ ] 명시 필드만으로 인덱스 구축
- [ ] Agent 핸들러 등에 적용
- [ ] `getAllNodes()` 직접 스캔과 결과 동등성 검증

#### 단계 9: base-* → abstract-* 마이그레이션 (신규)
- [ ] 1차 스캔: `packages/agents/src/abstracts/base-*.ts` 전수 조사 후 사용 빈도 낮은 순으로 우선순위 확정<br/>(후보: `base-plugin.ts`, `base-module.ts`, `base-executor.ts`, `base-ai-provider.ts`, `base-tool-manager.ts`, `base-workflow-runner.ts`)
- [ ] 파일별 계획 수립: 
  - [ ] `abstract-*.ts` 신규 생성 + 파일 상단에 “ABSTRACT CLASS” 주석 추가
  - [ ] `DEFAULT_ABSTRACT_LOGGER` 기본값 적용, 추상 타입만 참조하도록 점검
  - [ ] EventService, ownerPrefix, DIP 위반 여부 코드 리뷰
- [ ] 참조 교체 단계:
  - [ ] 관련 import/타입을 `abstract-*`로 전환 (Path-Only 검증)
  - [x] 예제/서비스에서 `ActionTrackingEventService` 직접 참조 금지 확인 (코드 기준 0건)
- [ ] 품질 게이트:
  - [ ] `pnpm --filter @robota-sdk/agents build`
  - [ ] `cd apps/examples && npx tsx 10-agents-basic-usage.ts` (로그 가드 규칙 준수)
  - [ ] 필요한 경우 Guarded Example 26 재검증
  - [ ] `.design/open-tasks/CURRENT-TASKS.md` 체크박스 `[x]` 업데이트
- [ ] `base-*` 파일 제거: 모든 참조 교체/빌드 통과 후 개별 파일 삭제
- [ ] 로그/문서: 변경된 추상 클래스 목록과 진행 현황을 CURRENT-TASKS에 주기적으로 반영
- [x] 1차 완료 항목: `base-plugin.ts → abstract-plugin.ts` (Plugins manager & 모든 plugin 구현체 `AbstractPlugin` 상속 전환, guard 빌드/예제 통과)
- [x] 2차 완료 항목: `base-module.ts → abstract-module.ts`
  - [x] `base-module.ts` 구조/의존성 분석 및 import 사용처 목록화 (`Robota`, module registries 등)
  - [x] `packages/agents/src/abstracts/abstract-module.ts` 신규 생성 + 상단 "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본 주입
  - [x] `ModuleExecutionContext`, `ModuleStats` 등 기존 타입/인터페이스를 그대로 이전하고, 클래스명 `AbstractModule`로 명확화
  - [x] 모든 구현/매니저에서 `BaseModule` import를 `AbstractModule`로 전환, 타입 정의(`AgentConfig.modules`) 업데이트
  - [x] `base-module.ts`는 임시 re-export 스텁 + "안쓰는 것이니 차후에 삭제 필요" 주석만 남기고 최종 삭제 전까지 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts` 로그 가드 실행 (필요 시 26번 예제 가드 준비)
  - [x] 문서 업데이트 및 체크박스 반영 후 다음 `base-*` 대상 선정
- [x] 3차 완료 항목: `base-executor.ts → abstract-executor.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (`ExecutionService`, executor registry 등)
  - [x] `abstract-executor.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본값 적용
  - [x] Executor 추상 인터페이스/타입을 그대로 이전하고 DIP 위반 여부 재검토
  - [x] 모든 구현부에서 `BaseExecutor` import를 `AbstractExecutor`로 전환
  - [x] 기존 파일은 임시 re-export 스텁으로 유지, 최종 삭제 전까지 "안쓰는 것이니..." 주석 부착
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 4차 완료 항목: `base-ai-provider.ts → abstract-ai-provider.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (AIProviders 매니저, provider 구현체 등)
  - [x] `abstract-ai-provider.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본값 적용
  - [x] Provider 공용 타입/메서드를 그대로 이전하고 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseAIProvider`/`BaseProvider` import를 `AbstractAIProvider`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석만 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`, provider별 build(OpenAI/Google/Anthropic)
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [ ] 5차 진행 예정: `base-tool-manager.ts → abstract-tool-manager.ts`
  - [ ] (파일 미존재) 현재 `tool-manager.ts`가 직접 구현되어 있어 `base-tool-manager.ts` 없음 → 참고용으로 기록만 유지
  - [ ] 향후 필요 시 tool manager 추상화 범위 정의
- [x] 6차 완료 항목: `base-provider.ts → abstract-provider.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Provider registry/manager 등)
  - [x] `abstract-provider.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] Provider 베이스 메서드/상태 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseProvider` import를 `AbstractProvider`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 7차 완료 항목: `base-workflow-converter.ts → abstract-workflow-converter.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Workflow converter 구현체 등)
  - [x] `abstract-workflow-converter.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 헬퍼/통계/검증 메서드 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseWorkflowConverter` import를 `AbstractWorkflowConverter`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 8차 완료 항목: `base-workflow-validator.ts → abstract-workflow-validator.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Workflow validator 구현체 등)
  - [x] `abstract-workflow-validator.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 헬퍼/통계/룰 관리 로직 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseWorkflowValidator` import를 `AbstractWorkflowValidator`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 9차 완료 항목: `base-visualization-generator.ts → abstract-visualization-generator.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Mermaid generator 등)
  - [x] `abstract-visualization-generator.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 템플릿 메서드/헬퍼 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseVisualizationGenerator` import를 `AbstractVisualizationGenerator`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 10차 완료 항목: `base-layout-engine.ts → abstract-layout-engine.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (layout engine 구현체 등)
  - [x] `abstract-layout-engine.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 템플릿/통계 로직 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseLayoutEngine` import를 `AbstractLayoutEngine`으로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 11차 완료 항목: `base-tool.ts → abstract-tool.ts`
  - [x] 기존 `abstract-tool.ts` 구조 재검토, "ABSTRACT CLASS" 주석 및 `DEFAULT_ABSTRACT_LOGGER` 기본 주입 정책 위반 여부 점검
  - [x] `BaseTool` import 사용처 전수 조사 (`FunctionTool`, `MCPTool`, `Robota`, Playground executor 등) 후 `AbstractTool`로 명시 전환 여부 확인
  - [x] `base-tool.ts`가 재-export 스텁(`안쓰는 것이니...`) 형태로만 남아있음을 검증하고 불필요 로직 제거 여부 재확인
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 및 다음 대상(Manager/Agent)으로 진행
- [x] 12차 완료 항목: `base-manager.ts → abstract-manager.ts`
  - [x] `AbstractManager`(초기 버전) 기능 점검 후 `BaseManager` 잔여 구현 제거 및 재-export 스텁화
  - [x] `Tools`, `Plugins`, `AIProviders`, `ModuleRegistry` 등 매니저 구현에서 `AbstractManager` 상속 여부 확인
  - [x] `base-manager.ts` 상단 "안쓰는 것이니..." 주석 유지 + 재-export만 남도록 정리
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 Agent 단계로 이동
- [x] 13차 완료 항목: `base-agent.ts → abstract-agent.ts`
  - [x] `packages/agents/src/abstracts/abstract-agent.ts` 신규 생성, "ABSTRACT CLASS" 주석 및 기존 공용 로직 이전
  - [x] `Robota` 및 관련 테스트(`robota.test.ts`)를 `AbstractAgent` 기반으로 업데이트하고 DIP 위반 여부 점검
  - [x] `base-agent.ts`는 재-export 스텁 + "안쓰는 것이니..." 주석으로 축소, 향후 삭제 준비
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 체크박스 반영 및 남은 Agent Event Normalization 작업 재정비


### 검증 명령어
```bash
pnpm --filter @robota-sdk/workflow build && \
pnpm --filter @robota-sdk/team build && \
pnpm --filter @robota-sdk/agents build && \
cd apps/examples && \
FILE=26-playground-edge-verification.ts && \
HASH=$(md5 -q "$FILE") && \
OUT=cache/26-playground-edge-verification-$HASH-guarded.log && \
echo "▶️ Run example (guarded)..." && \
STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?; \
tail -n 160 "$OUT" | cat; \
if [ "$STATUS" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT" >/dev/null; then \
  echo "❌ Aborting verification (example failed or strict-policy violation)."; \
  exit ${STATUS:-1}; \
fi; \
echo "▶️ Verify..." && \
npx tsx utils/verify-workflow-connections.ts | cat
```

---

## 🔧 Priority 2: Fork/Join Path-Only 마무리

### A-1. ExecutionService path 자동 주입/검증 강화
- [x] `packages/agents/src/services/execution-service.ts`
  - [x] emit 시 `context.ownerPath`가 absolute full path가 되도록 보장(thinking/response 세그먼트 포함)
  - [x] owner-bound EventService emit에서 ownerPath 누락/불일치 시 즉시 throw (No-Fallback)
  - [x] 검증 에러 메시지에 `[EVENT-SERVICE]`/`[PATH-ONLY]` prefix를 사용해 필터링 가능하게 표준화

### A-2. WorkflowState 경량화
- [ ] `packages/workflow/src/services/workflow-state.ts`
  - [ ] 보류/임시 큐/배리어 관련 상태·API 제거
  - [ ] Path-Only 원칙에 맞게 단순화

### A-3. 이벤트 소유권 정비
**목표**: 이벤트 접두어를 원천적으로 보호하여 잘못된 소유권 사용 방지

> **중요(최신)**: 이벤트 소유권은 prefix 주입이 아니라 **owner-bound EventService + 상수 기반 eventType**로 보호한다.
> - `execution.*` / `tool.*` / `agent.*` 이벤트 문자열은 소유 모듈 상수만 사용
> - 계층/관계는 absolute `context.ownerPath`로만 표현
> - prefix/ownerPrefix/clone 기반 설계는 사용하지 않는다(레거시 문서/코드 경로 제거됨)

#### 구현 체크리스트(최신)
- [x] `EXECUTION_EVENTS`/`TOOL_EVENTS`/`AGENT_EVENTS` 상수만 사용(하드코딩 문자열 금지)
- [x] ExecutionService는 thinking/tool/response를 포함한 absolute ownerPath를 emit context로 제공
- [x] ToolExecutionContext는 `eventService`(tool-call owner-bound) + `baseEventService`(unbound)로 “tool→agent 생성”을 지원
- [x] Guarded 예제 26/27로 Path-only + ownership 규칙을 verify로 검증

#### 참고 코드 위치
- `packages/agents/src/services/execution-service.ts` (line 142-154): maybeClone 구현
- `packages/agents/src/services/event-service.ts` (line 283-299): ActionTrackingEventService 생성자
- `packages/agents/src/agents/robota.ts` (line 514-520): EventService 주입

### A-4. Continued Conversation Path-Only
- [x] Continued conversation에서도 user_message가 local agent/execution scope에 연결되도록 ownerPath를 사용해 보장
- [x] `response(last) → user_message(continues) → thinking(processes)` 시퀀스 verify로 통과
- [x] 예제 27 재검증

---

## 🎨 Priority 3: Playground Tools DnD

### B-1. 브릿지/레지스트리 보강
- [ ] `apps/web/src/lib/playground/robota-executor.ts`
  - [ ] executor 에러를 UI 표준 에러로 변환

### B-2. Tools 목록 관리(UI)
- [ ] `ToolItem` 타입 선언 및 유효성 체크
- [ ] `toolItems` 상태 초기값 및 setter
- [ ] 사이드바 카드 리스트 렌더 (스크롤/접근성)
- [ ] `+ Add Tool` 모달 (name, description)
- [ ] ID 생성 규칙 (kebab + 6자리 토큰) 및 중복 방지
- [ ] 추가 후 정렬 및 포커스 이동
- [ ] 삭제/이름변경 (선택)

### B-3. DnD 상호작용 보강
- [ ] 빠른 연속 드롭 디바운스
- [ ] 중복 드롭 시 UI 유지

### B-4. UI 오버레이 상태 (addedToolsByAgent)
- [ ] 타입 정의: `AddedToolsByAgent = Record<AgentId, string[]>`
- [ ] 상위 페이지 상태 `addedToolsByAgent` 구현
- [ ] `onToolDrop(agentId, tool)` 집합 추가
- [ ] `WorkflowVisualization`에 props 전달
- [ ] `AgentNode` 렌더 시 합집합 뱃지 표시
- [ ] 병합 규칙: SDK 도구 ∪ 오버레이 도구
- [ ] 성공/실패 토스트 표준화

### B-5. 수용 기준
- [ ] 드래그 시 Agent 노드 시각적 반응
- [ ] 드롭 시 툴 뱃지 즉시 추가 (중복 없음)
- [ ] Workflow Path-Only 보존

---

## 🗑️ Priority 4: Pricing 기능 제거 (무료 플랫폼 전환)

### Phase 1: Pricing UI 제거
- [ ] `/pricing` 라우트 및 관련 컴포넌트 삭제
- [ ] Header/Navigation에서 Pricing 링크 제거
- [ ] 모든 "Upgrade" 프롬프트 및 버튼 제거
- [ ] Dashboard에서 Plan 정보 섹션 제거

### Phase 2: Billing 로직 제거
- [ ] `/api/v1/billing/*`, `/api/v1/subscriptions/*` 엔드포인트 삭제
- [ ] `types/billing.ts` 및 관련 타입 제거
- [ ] `lib/billing/plans.ts`에서 paid plan 제거 (free만 유지)
- [ ] Firebase billing 컬렉션 사용 중단

### Phase 3: 무료 크레딧 시스템 전환
- [ ] `UserCredit` 타입 단순화
- [ ] Plan 기반 → 크레딧 기반 제한 로직 변경
- [ ] Usage Dashboard "Plan limits" → "Free usage limits"
- [ ] 제한 도달 시 친화적 메시지 (업그레이드 언급 제거)

### Phase 4: 설정 정리
- [ ] Stripe 관련 환경 변수 제거
- [ ] API 문서에서 billing 엔드포인트 제거
- [ ] 사용하지 않는 billing 타입 및 테스트 정리

---

## ✅ 성공 기준

### Agent Event Normalization
- [ ] Agent 노드 생성은 오직 `agent.created`
- [ ] `agent.execution_start`는 상태 전이만
- [ ] `tool.agent_execution_started` 완전 제거
- [x] 예제 26 가드/검증 통과
- [ ] 하드코딩 문자열 없음 (상수만 사용)
- [ ] Fork/Join 다중 depth Path-Only 연결

### Fork/Join Path-Only
- [ ] `groupId`/`branchId`/`responseExecutionId` 제거
- [ ] WorkflowState 경량화 완료
- [ ] 이벤트 소유권 ESLint 룰 적용
- [x] Continued Conversation 예제 27 통과

### Tools DnD
- [ ] 드래그앤드롭 동작 안정적
- [ ] 툴 뱃지 정확히 표시
- [ ] 중복/간섭 없음
- [ ] Path-Only 보존

### Pricing 제거
- [ ] UI에서 모든 pricing/billing 언급 제거
- [ ] API 엔드포인트 정리
- [ ] 무료 크레딧 시스템 동작
- [ ] Stripe 의존성 제거

---

## 📝 작업 진행 기록

**시작일**: 2025-10-16
**예상 완료**: 2025-10-30 (2주)

**주요 이슈**:
- Agent Event Normalization 85% 완료
- Fork/Join Path-Only 기초 완성, 정리 필요
- Tools DnD UI 작업 대기
- Pricing 제거는 독립적으로 진행 가능
- 2025-12-06: DEFAULT_ABSTRACT_EVENT_SERVICE 전환 및 ActionTracking 생성 제거(create-team); agents/team 빌드 성공; 예제 26 실행은 지시사항에 따라 스킵
- 2025-12-06: web playground 팀 경로 정리 완료 — `playground-team-integration.ts` 삭제, `robota-executor.ts` 팀 분기 제거(Agent 전용), web 빌드 성공(확장 권한)
- 2025-12-20: (Priority 0 / 1순위 진행) tool-call scoped EventService DI 경로 완성 — `interfaces/event-service.ts` 도입, `ToolExecutionContext.eventService` 추가, `ExecutionService → ToolExecutionService` 주입 wiring 완료, `ToolExecutionService` executionId fail-fast/assignTask 특수 로그 제거, `RelayMcpTool`을 `context.eventService` 단일 진실로 전환. `pnpm --filter @robota-sdk/agents build` PASS.
- 2025-12-20: (Priority 0 / 1순위 진행) Tool 구현체 전수 점검 — `tools/implementations` 기준 `getEventService()` 의존은 `RelayMcpTool`만 확인되었고, 이를 `context.eventService` 단일 진실로 전환 완료.
- 2025-12-20: (Priority 0 / 1순위 진행) Web Playground DI 정리 — `PlaygroundExecutor`에서 `ActionTrackingEventService`/Bridge 직접 생성 제거, `WorkflowSubscriberEventService` 어댑터로 `WorkflowEventSubscriber`에 순차 전달, `PlaygroundContext`에서 composition root로 주입. `console.*` 제거 후 logger DI로 전환.
- 2025-12-20: (검증) `@robota-sdk/web build`는 샌드박스 환경에서 `next build`가 `node_modules/next` 파일을 open 하는 과정에서 `EPERM`으로 실패하여, 빌드 검증은 스킵하고 코드/린트 기반으로만 진행.
- 2025-12-20: (정리) `apps/web/src/lib/playground/playground-event-service.ts`는 하드코딩 이벤트 문자열/기본 fallback 로직이 포함되어 규칙 위반 소지가 있었고, 현재 DI 경로에서 미사용이라 제거했다.
- 2025-12-20: (검증) `apps/web/src/**` 전수 스캔 결과 `ActionTrackingEventService`/Bridge/`PlaygroundEventService`/`new EventService` 잔여 0건. 현재 Playground composition root는 `apps/web/src/contexts/playground-context.tsx`에서 `WorkflowEventSubscriber` + `WorkflowSubscriberEventService`를 생성해 `PlaygroundExecutor`에 주입한다.
- 2025-12-20: (Priority 0) `SilentEventService` 제거 완료 — `AbstractEventService`가 기본 no-op을 제공하며, 코드베이스에서 `SilentEventService` 정의/파일은 제거된 상태로 확인.
- 2025-12-20: (검증/리팩토링 검증) Guarded 예제 **26/27 가드 실행 + verify 통과** — ownerPath-only 이론을 실제 그래프 생성으로 검증하며 아래 결함/개선점을 반영해 PASS로 고정.
  - 예제 26: **nodes=18 / edges=18**, verify PASS
  - 예제 27: **nodes=15 / edges=14**, verify PASS
  - 핵심 수정(단일 경로/No-Fallback 유지):
    - ExecutionService ownerPath를 **absolute(full path)**로 정규화(특히 `thinking`/`response` 세그먼트 포함)하여 `assistant_message_*`/tool fork/join이 path-only로 결정되게 함
    - ToolExecutionContext에 **`baseEventService`(unbound)**를 추가해 “툴이 agent를 생성하는 경우”에도 owner-bound EventService 레이어 충돌 없이 새 owner로 바인딩 가능하게 함
    - examples bridge(`WorkflowSubscriberEventService`)에 `flush()`를 추가해 실행 종료 직후 snapshot 저장 시 이벤트 처리 완료를 보장(타이머/리트라이 없이 순차 처리만 await)
    - workflow handler 보강:
      - `execution.user_message`에서 nested ownerPath의 **local agent/execution**을 context.ownerPath에서 추출해 lastUserMessage/state 연결을 정확히 유지
      - `tool.call_response_ready`에서 `delegatedResponseNodeId`(툴 결과에 명시) 제공 시 tool_response의 parent를 tool_call이 아닌 delegated response로 연결해 `tool_call 단일 outgoing` 규칙을 만족
- 2025-12-20: (Priority 0) `SilentEventService` 잔여 참조 제거 — repo 전수 스캔 결과 참조 0건, 남아있던 문구(`Previously SilentEventService...`) 삭제. `pnpm --filter @robota-sdk/agents build` PASS.
- 2025-12-20: (Priority 0) Context binder 규약 반영 — `bindWithOwnerPath` 도입(호출부 전환 시작), `createContextBoundInstance`는 ownerType taxonomy를 선지식으로 제한하지 않고(string), `ownerType/ownerId` 필수 + ownerPath 검증/append 단일 규칙으로 고정. `pnpm --filter @robota-sdk/agents build` PASS.
- 2025-12-20: (Priority 0) Legacy alias 정리 — `@robota-sdk/agents`에서 `ContextualEventService`/`SilentContextualEventService` alias re-export 제거. workflow 문서(`packages/workflow/ARCHITECTURE.md`, `DEVELOPMENT_PLAN.md`)에서도 ActionTracking/Contextual alias 기반 설명을 ownerPath context 기준으로 정리.
- 2025-12-20: (Priority 0) Public API 정리 — `@robota-sdk/agents` public export에서 `ActionTrackingEventService` 제거(루트 export에서 더 이상 노출되지 않음). `pnpm --filter @robota-sdk/agents build` PASS.
- 2025-12-20: (Priority 0 / 1순위) ExecutionService payload 정리 — execution.start/user_message/assistant/tool-results 관련 이벤트에서 executionId/conversationId 등 계층/출처 필드를 payload/metadata에서 제거하고, EventContext.ownerPath로만 전달하도록 정리.
- 2025-12-20: (Priority 0 / 1순위) Tool→Agent ownerPath-only 보장 — `Robota.buildOwnerPath()`가 executionContext.ownerPath만을 base로 사용하고 `{ type:'agent', id }`를 append 하도록 고정. `ExecutionService.buildBaseOwnerPath()`도 ownerPath만 복제하도록 고정.
- 2025-12-20: (Priority 0 / 1순위) DI-only 마감 — `PlaygroundProvider`에서 EventService 직접 생성 제거(외부 `createEventService` 주입). 사용처는 `apps/web/src/app/playground/page.tsx`로 이동. examples 범위에서 EventService 직접 `new` 0건 확인.
- 2025-12-20: (Priority 0 / 1순위) 이벤트 상수/하드코딩 정리 — `EXECUTION_EVENTS`/`TOOL_EVENTS`/`AGENT_EVENTS`를 prefix 포함 상수로 고정하고, workflow/web 구독/핸들러에서 문자열 리터럴을 제거해 상수 import로 통일. `@robota-sdk/agents` public export에 `EXECUTION_EVENTS`/`TOOL_EVENTS` 추가로 workflow 빌드 호환성 확보. `pnpm --filter @robota-sdk/agents build` PASS, `pnpm --filter @robota-sdk/workflow build` PASS.
- 2025-12-20: (검증/정리) `apps/web/src/**`에서 `console.*` 직접 호출 0건 달성 — `WebLogger`(DI-friendly wrapper) 도입 후, hooks/components/api routes/playground sandbox 포함 전수 치환 및 lint/grep 검증 완료.
- 2025-12-20: (검증/계획) Guarded 예제 경로 재정의 — legacy `26-playground-edge-verification.ts` 실행 방지(즉시 실패), `26-guarded-edge-verification.ts`/`27-continued-conversation-edge-verification.ts`로 분리. 자동화/스크립트도 guarded 파일만 호출하도록 전환.
- 2025-12-20: (회귀 검증) Node/Edge timestamp를 내부 단조 증가로 고정(NodeEdgeManager). 예제 26/27 verify PASS 재확인.
  - 예제 26(재검증): **nodes=18 / edges=18**, verify PASS (`SCENARIO_PLAY_ID=mandatory-delegation`)
  - 예제 27(재검증): **nodes=15 / edges=14**, verify PASS (`SCENARIO_PLAY_ID=continued-conversation`)

**다음 단계**:
1. Agent Event Normalization 단계 3, 6.5, 6.6 완료
2. Fork/Join Path-Only 검증 스크립트 자동화
3. Tools DnD UI 구현 시작
4. Pricing 제거 (병렬 작업 가능)

## 🚫 Priority 0: Team 패키지 정리 (assignTask 전용, 특수 Agent 금지)

### 목표
- **절대 규칙**: 모든 Agent/AgentConfig는 평등하며, assignTask는 순수 third-party MCP tool collection일 뿐이다. Agent/Tool/Service 어디에서도 assignTask 전용/특수 Agent 개념을 갖지 않는다.
- Team 패키지는 **deprecated 취소**. 팀 관련 MCP 도구(예: `assignTask`)를 포함하는 tool collection으로 유지하고, legacy 팀/협업 기능은 제거/미사용 상태로 둔다.

### 작업 항목
1. **참조 인벤토리 확정 (리스트+담당)**
   - [x] 코드 (Web/Playground): `apps/web/src/lib/playground/robota-executor.ts`, `playground-team-integration.ts`, `apps/web/src/tools/assign-task/index.ts`, team 전용 UI/상태 (playground-team-integration 삭제, robota-executor 팀 분기 제거, web 빌드 OK)
   - [x] 코드 (SDK/패키지) 1차 스캔: `rg "@robota-sdk/team"` 결과 확인 → 실제 남은 제거/정정 대상은 주로 문서/예제/설정(코드 의존은 assignTask 목적만 유지)
   - [ ] 예제: `apps/examples/05/06/07 team-*`, `26-playground-edge-verification.ts`(및 archive), 기타 team 사용 예제 목록화
   - [ ] 문서/설정: `docs/**`, `packages/*/docs/**`, README 계열, api-reference(team), 빌드 스크립트, pnpm workspace, tsconfig paths, root/app package.json 의존
   - 스캔 결과(정리 필요 대상):
     - 코드/Web/Playground: 처리 완료
     - 코드/SDK: `packages/workflow/DEVELOPMENT_PLAN.md` 등 의존 언급만 확인(실제 팀 코드 없음)
     - 예제: 05/06/07/26 및 archive 정리 필요
     - 문서/README: 아래 문서들이 여전히 “team=멀티에이전트/협업”으로 표현되어 있어 assignTask MCP-only로 정정 필요
       - 루트 `README.md` (createTeam import, 팀 자동 위임 설명)
       - `docs/README.md`, `docs/getting-started/README.md`, `docs/guide/README.md`, `docs/guide/core-concepts.md`, `docs/guide/building-agents.md`, `docs/guide/architecture.md`
       - `docs/examples/team-collaboration.md`(head note OK, 본문 재점검), `docs/examples/browser-compatibility.md`
       - `packages/agents/docs/**`, `packages/openai/README.md`, `packages/anthropic/README.md`, `packages/openai/docs/README.md`, `packages/anthropic/docs/README.md`
       - `packages/agents/docs/packages-docs.md`, `packages/workflow/DEVELOPMENT_PLAN.md` (의존 언급)
     - 설정/lock: root/package builds, pnpm-lock, apps/examples/package.json, packages/workflow/package.json, apps/web/package.json

2. **마이그레이션 전략 (team → assignTool MCP) 세부**
   - Web/Playground:
     - [x] `createTeam`/TeamContainer 호출 제거 → Robota 단일 agent + `assignTool` MCP 호출 플로우로 교체 (robota-executor 팀 분기 삭제)
     - [x] team 전용 상태/스토어/에러/토글 UI 제거, assignTool 호출 결과 표시로 단순화 (Playground UI 팀 모달/토글 삭제)
     - [ ] assignTool 호출/응답 표시 플로우를 시퀀스/다이어그램으로 문서화
     - [ ] 주의: `createTeam`은 `@robota-sdk/team` 내부 팩토리로 assignTask(도구) 주입을 포함하지만 team 패키지 의존을 완전히 제거하지 못하므로, 모든 호출부를 단일 Robota + assignTool(MCP) 직접 호출로 교체해야 함
     - [ ] 얇은 어댑터(신규 모듈) 설계: 단일 Robota + assignTool 호출만 캡슐화, ownerPath-only/노-폴백/하드코딩 prefix 금지, source/timestamp 자동 주입만 허용
     - [ ] 요구 표면 캡처: Playground `robota-executor.ts`/`playground-team-integration.ts`가 필요로 하는 기능(생성, execute, 도구 주입/추적)에 맞춰 최소 인터페이스 정의
       - 생성: aiProviders, eventService 주입으로 세션 생성/초기화
       - 실행: `execute(prompt)`(string 입력 → string 응답) 단일 엔트리; 히스토리/통계 훅 호출 가능
       - 도구 주입: assignTool(assignTask MCP FunctionTool) 생성 지원, 필요한 경우 추가 MCP 도구 주입 훅
       - 추적: blockCollector/toolFactory와 연동 가능한 콜백/옵션 제공(단, ownerPath-only, 노-폴백)
       - 노출: getTeamContainer/getAvailableTools 같은 team 전용 API는 제거, 최소 어댑터 API로 단순화
     - [ ] 파일별 교체 계획:
       - [x] `apps/web/src/lib/playground/robota-executor.ts`: PlaygroundTeamInstance 제거, 어댑터 주입으로 실행/도구 주입/통계/히스토리 훅 연결(현재 Agent 전용으로 정리 완료)
       - [x] `apps/web/src/lib/playground/playground-team-integration.ts`: createTeam 흐름 제거(파일 삭제)
        - [x] `apps/web/src/tools/assign-task/index.ts`: Web 폴더의 assign-task 구현 삭제(팀 패키지로 이전), Web은 team 패키지의 Relay MCP 기반 assignTask만 사용
        - [ ] UI 상태/토글/에러 처리: team 전용 분기 제거, assignTask 호출 결과 표시만 남김
   - 어댑터 설계 초안(메모):
     - 인터페이스: `createSession({ aiProviders, eventService }): Adapter`, Adapter는 `execute(prompt): Promise<string>` + `injectAssignTaskTool(opts?): FunctionTool`(필요 시) + 선택적 추적 콜백 훅
     - 규칙: ownerPath-only, source/timestamp 자동 주입, prefix/ID 파싱/캐시/노-폴백 금지
     - 반환/에러: 명시적 오류 전달, fallback 무
    - Relay MCP Tool 원칙 (assignTask 포함한 third-party 도구 전반):
      - ToolExecutionService가 tool 세그먼트까지 포함된 ownerPath 바인딩 eventService를 넘기고, Relay MCP Tool은 추가 clone/context 없이 이를 사용한다.
      - Relay MCP Tool 내부에서 Robota agent를 생성할 때 전달받은 ownerPath에 `{ type: 'agent', id: agentId }`만 append하여 주입한다. 그 외 세그먼트 추론/파싱/접두어 주입 금지.
      - 이벤트/계층 정보는 상위 바운드 eventService가 자동 처리하며, payload에 계층/타임스탬프 수동 주입 금지. prefix/ID 파싱/캐시/지연 연결/폴백 금지.
      - assignTask 등 특정 도구 지식 없이 MCP 스키마/파라미터만으로 처리하며, 템플릿 등 추가 데이터는 외부 주입에 의존한다.
      - ownerPath 전달 책임은 호출부(상위) → Relay MCP Tool이 공통적으로 ownerPath를 받아 agent 세그먼트만 append하는 기능을 제공하고, assignTask는 이를 그대로 사용한다(자체 ownerPath 생성/추론 금지).
      - assignTask를 Tool Collection으로 구성: `listTemplateCategories`(선택), `listTemplates(categoryId?)`, `getTemplateDetail(templateId)`, `assignTask({ templateId, jobDescription, overrides })`와 같이 params를 object로 전달. 단순 환경에서는 list→detail→assign만 사용, 필요 시 category 필터 추가.
      - assignTask 템플릿은 패키지 내부 json으로 내장(외부 주입 없음). 호출자는 템플릿 정보를 조회 후 모델/provider 등을 파라미터로 주입해 실행.
    - assignTask 취급 원칙 (명문화):
      - assignTask는 완전한 third-party MCP tool로 간주하며, 에이전트/시스템은 사전 지식이나 특수 분기 없이 도구 스키마/파라미터만으로 처리해야 한다.
      - 템플릿/매개변수는 MCP tool 파라미터 또는 생성 시 외부 주입으로 전달하며, 호출부가 ownerPath 바인딩된 eventService만 제공한다.
      - **Agent 중립 절대 규칙**: Agent/AgentConfig에 assignTask 전용 필드나 특수 Agent 개념을 두지 않는다. `TaskAgent*`, “temporary/specialized agent” 표현 금지. 모든 Agent는 동일한 수명주기/설정 구조를 따른다.
      - RelayAgent는 도입하지 않는다(선택 사항이지만 현재 불필요). 표준 `Robota` + `RelayMcpTool` 조합만 사용한다.
   - 예제:
     - [ ] team 전용 예제(05/06/07/26 등) 통폐합 → assignTask tool collection 최소 예제로 재작성
       - 유지/신규:
         - `assign-task-basic.ts` (신규): listTemplates → getTemplateDetail → assignTask 단일 흐름, 템플릿/모델 상수 주입, LLM 호출 없이 결과 출력만
         - `assign-task-categorized.ts` (옵션): listTemplateCategories → listTemplates(category) → assignTask 흐름, 카테고리 필터 예시
       - 축소/스텁:
         - 26번: team/ATS/Bridge 제거, assignTask 호출 샘플만 남긴 스텁, 실행 스킵 가드 유지
       - 폐기/대체:
         - 05/06/07 team 예제 파일 삭제 또는 위 신규 예제로 교체(팀 스트림/Remote 비교 시나리오 폐기)
       - 공통 원칙:
         - createTeam/Team API 전면 제거, 단일 Robota + assignTask MCP 호출
         - LLM 호출 금지(캐시/가드 주석), 템플릿/모델 상수로 데모
         - 결과는 콘솔 요약만, ownerPath-only/노-폴백 준수
     - [ ] guard/검증 스크립트에서 team 의존 경로 제거/스킵 규칙 명시
   - SDK/에이전트:
     - [x] team 전용 헬퍼(SubAgentEventRelay 등) 제거 대상 식별, assignTool 경로로 치환 여부 판단
     - [x] `packages/team/src/types.ts`를 assignTask 전용 최소 타입만 남기고 정리: `TaskAgentConfig`/특수 에이전트 관련 타입/주석 삭제, 표준 AgentConfig만 사용
     - [x] `assign-task/**` 구현이 특수 Agent 분기 없이 표준 Agent 생성만 수행하는지 재검증 (ownerPath-only, no-fallback)
     - [x] 전역 검색 `rg "TaskAgent"` / `rg "TaskAgentConfig"` / `rg "specialized agent"`로 잔여 표현 제거
     - [x] `pnpm --filter @robota-sdk/team build`로 타입/빌드 검증 (특수 Agent 제거 후)
   - 이벤트/경로:
     - [ ] team prefix 이벤트 전면 제거, ownerPath-only 유지
     - [ ] assignTool 호출이 tool/agent 이벤트만 사용하도록 점검

3. **의존성 제거 (순서 명시)**
   - [ ] `rg "@robota-sdk/team"` 전수 결과 기반 import 제거 계획 수립 (경로/분류 테이블 활용)
   - [ ] 코드 치환 → pnpm workspace/root/apps package.json/tsconfig paths 정리 → lockfile 정리 → 빌드 순으로 진행
   - [ ] 코드 치환: assignTool/Robota 단일 agent 패턴으로 교체

4. **검증**
   - [ ] `pnpm --filter @robota-sdk/agents build` 및 영향 패키지 빌드
   - [ ] apps/web smoke (team 기능 제거 후 기본 흐름)
   - [ ] 예제 실행: team 제거 대상은 스킵/삭제, 나머지 예제 정상 동작 확인

5. **차단책**
   - [ ] 신규 `@robota-sdk/team` import 유입 방지 가이드/체크 추가 (lint/rg 명시, CI/pre-commit에서 `rg "@robota-sdk/team"` 0건 확인)

**2025-11-30 업데이트**
- ExecutionService가 ownerPath 기반 `emit(eventType, payload, context)` 패턴으로 전환되었고 `ActionTrackingEventService` clone/ownerPrefix 의존성이 제거되었습니다.
- 모든 execution/tool 이벤트가 helper(`emitExecutionEvent`, `emitToolEvent`)를 통해 `ownerType`, `ownerPath`를 명시합니다.
- `maybeClone`/`trackExecution` 레거시 호출과 `toolEventService` 분기가 제거되어 context 누락 케이스를 차단했습니다.

