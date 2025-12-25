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
      - [x] `apps/web/src/lib/playground/robota-executor.ts`, `apps/examples/26-playground-edge-verification.ts` 등
        - [x] Playground 환경에서 EventService를 직접 생성하지 말고 SDK에서 주입받은 것을 사용
        - [x] 테스트/예제 코드도 ownerPath 기반 context로 업데이트
        - [x] (검증) Guarded 26/27 PASS + packages build PASS로 회귀 검증 고정
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
2. **Context 구조 도입 (중복/구버전 정리: 구현 TODO → “검증 게이트” 중심으로 전환)**
   - [x] `OwnerType`는 taxonomy를 선지식으로 제한하지 않는다(string)
   - [x] `OwnerPathSegment`는 Event axis 단일 기준으로 유지한다(`@robota-sdk/agents`)
   - [x] ownerPath 확장은 `bindWithOwnerPath`/owner-bound EventService의 단일 규칙으로 고정(부모→자식 append)
   - [x] **전수 스캔(0건 확인)**: emit payload에 계층/출처 필드가 다시 유입되지 않았는지 확인
     - 후보: `rootExecutionId`, `parentExecutionId`, `executionLevel`, `executionPath`, `path`, `thinkingId`
   - [x] **전수 스캔(0건 확인)**: handler/tool/execution에서 ID 파싱/추론/정규식/지연 연결/폴백이 없는지 확인
   - [ ] (선택) `buildOwnerContext(ownerType, ownerId, extraSegments?)` helper는 필요성이 생길 때만 도입(현재는 `bindWithOwnerPath`가 단일 기준)
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

---

## 🚧 Priority 0.5: Playground 단독 배포/라이브러리 전환 (Website 제거)

### 목표
- 이 레포는 **배포 가능한 Playground(React 컴포넌트)**만 유지한다.
- 기존 Website(홈/문서/대시보드/회원가입/로그인/프로필/설정 등)는 **완전 삭제**한다(Deprecated 금지).
- 크레딧/요금제/구독/플랜 개념은 **완전 삭제**한다.
- 향후 웹사이트는 **다른 레포**에서 “배포된 Playground”에 의존하는 형태로 관리한다.

### 결정(필수)
- Playground 제공 형태(최종 목표):
  1) **단독 배포물**(예: `/playground`만 가진 앱)로 배포 → 외부 사이트가 URL/iframe 등으로 의존
  2) **라이브러리 패키지**로 추출(`packages/*`) → 외부 사이트가 dependency로 설치해 embed
- 현재 선택(진행 중):
  - **2) 라이브러리 패키지 추출**을 즉시 진행한다: `packages/playground` 신설 + `apps/web`는 `/playground`만 렌더하는 최소 호스트로 축소.
  - 추가 프레임워크 지원을 위해 패키지명은 `playground-react`가 아니라 **`@robota-sdk/playground`**로 고정한다(내부 구현은 React).

### 작업 항목
1) **Auth/회원 시스템 완전 삭제**
  - [x] `apps/web`에서 회원가입/로그인/비밀번호 재설정 UI 삭제
  - [x] `AuthProvider`/`AuthContext`/AuthGuard 등 인증 추상화 삭제
  - [x] Firebase Auth 의존(클라이언트/어드민/API 라우트) 제거
  - [x] `/dashboard`, `/profile`, `/settings`, `/api-keys`, `/analytics` 등 “회원 전제” 페이지 삭제
2) **Website 페이지 완전 삭제**
  - [x] `/`(홈), `/docs`, `/about`, `/contact`, `/api/v1` 등 Website 성격의 페이지 삭제 또는 Playground로 리다이렉트
  - [x] Header/Footer 등 Website 전용 UI/네비게이션 제거(Playground 단독 UI로 단순화)
  - [x] `/`는 `/playground`로 리다이렉트(호스트 최소화)
3) **Playground 비로그인 예제 추가**
  - [x] “비로그인으로 불러와서 실행만 하는” 예제 1개 추가(Playground 내부/예제 페이지로 제공)
  - [x] 예제는 credits/subscription/pricing 언급 없이 실행 플로우만 보여준다 (`/playground/demo`)
4) **검증 게이트**
  - [x] `apps/web/src` 기준 `login|signup|auth|firebase` 잔여 0 확인
  - [x] `apps/web/src` 기준 `pricing|billing|subscription|plan|upgrade|stripe` 잔여 0 확인
  - [ ] `pnpm --filter robota-web build` (사용자 환경에서)
      - [x] Guarded 예제 27 실행(가드) + verify 통과
      - [x] 결과 기록(노드/엣지 수, 실패 시 rule 위반 유형) 및 리팩토링 개선점 제안 정리
  - [x] (CI) npm/package-lock 전제 제거(pnpm-lock 기준) + audit/caching 경로 정리(deploy workflow)
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

## 🧪 Priority 0.6: CI / typecheck / lint 운영 정책 확정 + 0으로 만들기

### 배경(현재 문제)
- Vercel/CI에서 “npm audit + package-lock” 전제 스텝이 남아 있어, pnpm 모노레포에서 커밋마다 실패 로그가 발생했었다.
- 현재 root `typecheck`는 실제로 `pnpm lint`로 매핑되어 있어(**typecheck=eslint**), Node 22 기준 “typecheck 102개”는 사실상 lint 문제였다.
- 신뢰/효율 이슈: 한 줄씩 수정/미적용 패치 반복은 금지하며, **한 번의 배치 수정으로 여러 건이 동시에 감소**해야 한다.
 - Vercel 프로젝트 설정(`apps/web/vercel.json`)이 여전히 `npm install`/`npm run build`로 고정되어 있어, pnpm 워크스페이스와 상충할 수 있었다.

### 정책(확정 대상)
1) **타입 소유권/재사용 규약(agents 기준, 선언적 타입 단일 소스)**
   - **Value axis(UniversalValue 축)**: `packages/agents/src/interfaces/types.ts`가 소유/단일 기준
   - **Tool contract**: `packages/agents/src/interfaces/tool.ts`가 소유, 값 타입은 `interfaces/types.ts`에서 재사용
- **Tool options(구현체가 가져다 써야 함)**: `packages/agents/src/abstracts/abstract-tool.ts`의 `IAbstractToolOptions`가 소유
   - **Event axis**: `packages/agents/src/interfaces/event-service.ts`가 소유/단일 기준
   - **외부 소비 경로**: 외부 패키지는 반드시 `@robota-sdk/agents` public export만 사용
2) **수정 운영 규칙**
   - **[금지] 한줄씩 수정**: 한 번의 배치 패치는 최소 “3개 이상 문제 감소”를 목표로 한다.
   - **[필수] 미적용/무의미 diff면 즉시 중단**: 재시도 전에 “왜 미적용인지(컨텍스트/패치 설계)”를 먼저 해결한다.

### 작업 순서(제안)
1) **CI/배포 워크플로우 정리**
   - [x] `deploy.yml`에서 npm/package-lock 전제 제거 → pnpm install/audit + pnpm-lock 캐시로 통일
   - [x] Lighthouse URL 목록을 “Playground만” 기준으로 갱신(website 라우트 삭제 반영)
2) **typecheck/lint 스크립트 정책 확정(결정 필요)**
   - [x] (결정) **옵션 A로 확정**: `typecheck = tsc` + `lint = eslint`
     - 적용: root `package.json`에서 `typecheck`는 `tsc --noEmit`, `lint`는 `eslint`로 고정 (원인 분리/로그 가독성 개선)
   - [x] (Vercel) 배포 빌드 경로에서는 **에러 게이트만** 적용하도록 `apps/web/vercel.json`을 pnpm 워크스페이스 커맨드로 정리
     - install: `pnpm -w install --frozen-lockfile`
     - build: `pnpm -w --filter @robota-sdk/web build`
   - [x] (Next build) `next build`에서 ESLint는 실행하지 않되, **TypeScript 에러는 무시하지 않도록** `apps/web/next.config.ts`를 정리
3) **에러 0 만들기(대량 배치 방식)**
   - [ ] 1차 배치(즉시 감소 큰 묶음): 테스트 no-undef 다발 + no-console + 하드코딩 이벤트명
   - [ ] 2차 배치(다발): `any/unknown` 다수 파일을 “소유 타입 축”으로 흡수(UniversalValue/ContextData/LoggerData)
   - [ ] 3차 배치(레거시 파일 정리): `packages/agents/src/services/node-edge-manager.ts` 노출/사용 여부 결정(필요하면 타입 축 정리, 불필요하면 export/사용처 제거)
   - [ ] 각 배치마다 `pnpm --filter @robota-sdk/agents lint`로 “문제 개수 감소” 확인 후 다음 배치 진행

---

## 🧭 Priority 0.7: Type Ownership Audit + T/I Prefix Rollout Plan (NEW)

### 목표
- 타입/인터페이스가 **어느 패키지가 소유(owner)** 하는지 명확히 하고, 소비자는 **owner의 public export만 사용**한다.
- 같은 의미의 타입이 여러 곳에서 “로컬 선언”으로 중복되지 않도록 하고, **단일 소스(single source of truth)** 기준을 문서/코드로 고정한다.
- **Type alias는 `T*`, interface는 `I*` 접두어**를 프로젝트 표준으로 확정하고, 신규 코드부터 강제하며 기존 코드는 **대규모 churn 없이 단계적으로** 전환한다.

### 원칙(필수)
1) **Owner 명확화**
   - 어떤 타입이든 “소유 패키지(=정의 위치)”가 하나만 있어야 한다.
   - 비-owner 패키지는 타입을 재정의/복제하지 않고 `@robota-sdk/<owner>`의 public export를 import해서 쓴다.
2) **중복 타입 금지**
   - 동일 의미의 유니온/인터페이스를 파일 단위로 다시 선언하는 패턴을 금지한다.
   - 예: workflow node status 같은 도메인 타입을 UI/contexts에서 `'pending' | ...`로 재정의하는 것을 금지한다.
3) **Naming Convention**
   - **type alias**: `T` prefix (`TWorkflowNodeStatus`)
   - **interface**: `I` prefix (`IWorkflowNodeData`)
   - 신규 코드: 즉시 적용(하드 룰)
   - 기존 코드: 단계적 전환(대량 rename은 금지)

   **왜 접두어를 붙이나? (의도/효과)**
   - **값(value)과 타입(type)의 충돌 방지**: `AssistantMessage`처럼 “런타임 객체/변수/클래스”와 “타입”이 같은 이름을 쓰면, import/리뷰/리팩토링 시 매번 구분 비용이 발생한다. `IAssistantMessage`/`TAssistantMessage`처럼 타입을 표기하면 즉시 구분된다.
   - **계약(contract) 가시성 강화**: 패키지 간 public contract 타입을 한눈에 식별해 “어디가 owner인지” 판단이 쉬워지고, 중복 선언을 예방한다.
   - **검색/리뷰 비용 감소**: `rg "IAssistantMessage"`처럼 타입을 빠르게 추적할 수 있고, 런타임 심볼과 섞여 노이즈가 생기지 않는다.

### 현황 스냅샷(빠른 스캔, 2025-12-21 기준)
- `T*`/`I*` 규칙을 이미 따르는 선언이 일부 존재한다(최소 32건).
- `packages/*` 안에서 **`T` 접두어가 아닌 `type` alias가 최소 38건** 확인되었다(전수조사 시 더 늘 수 있음).
- 결론: “전체 일괄 rename”은 churn이 너무 커서 금지. **배치별로 owner 정리와 함께 자연스럽게 수렴**시키는 전략이 필요.

### Owner Map v1 (Draft, 이 문서가 단일 기준)
- **`@robota-sdk/agents`가 소유**
  - Event axis: `EventService`, `EventContext`, `OwnerPathSegment`, event data types, event constants
  - Tool axis: tool schema/params/context/result + tool execution contracts
  - Message axis: `UniversalMessage` 및 대화 메시지 계약
  - Shared value axis: `UniversalValue`/`ContextData`/`LoggerData` 등 “값/메타데이터 축”
- **`@robota-sdk/workflow`가 소유**
  - Workflow graph axis: workflow node/edge/structure + status/connection types
  - Workflow subscriber/handlers/services는 workflow graph 타입을 소유하며, event/tool/message 축은 agents를 import해서 재사용한다(중복 정의 금지).
- **기타 패키지(`openai`, `remote`, `team`, `playground`, `apps/*`)**
  - 원칙: “owner 타입을 소비”만 한다. 계약 타입을 로컬에서 재정의하지 않는다.
  - UI 레이어는 UI 로컬 타입을 가질 수 있지만, SDK contract 타입과 이름/의미가 중복되면 owner 타입을 직접 사용한다.

### 실행 계획 (전수 조사 → 배치 수정 → 게이트)

#### 1) 전수 조사: “타입 소유권/중복 선언” 인벤토리 작성
- [ ] 조사 범위 확정: `packages/*/src`, `apps/*/src` (테스트 포함 여부는 별도 결정)
- [ ] 인벤토리 표 템플릿(이 섹션 아래에 “실제 행”을 채워나간다):

| 개념(타입) | 현재 선언 위치(파일) | 의도 Owner | 소비 위치(대표) | 문제 유형 | 배치 | 난이도 | 수정 요약 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 예: WorkflowNodeStatus | (중복 선언 발견 시) | @robota-sdk/workflow | packages/playground/... | 중복 선언 | Batch A | 낮음 | owner 타입 import로 치환 |
| WorkflowNodeStatus (로컬 재정의) | `packages/playground/src/contexts/playground-context.tsx` (이전: `'pending' \| 'running' \| 'completed' \| 'error'`) | @robota-sdk/workflow | `packages/playground` context/reducer | 중복 선언(로컬 유니온) | Batch A | 낮음 | **완료**: `WorkflowNodeStatus` import로 치환(단일 소스 참조) |
| Workflow graph 핵심 타입명(T/I 미준수) | `packages/workflow/src/interfaces/workflow-node.ts` (`WorkflowNodeStatus`, `WorkflowConnectionType`, `WorkflowNodeData` 등) | @robota-sdk/workflow | workflow + playground | Naming(T/I prefix) | Prefix Phase 2 | 중간 | `TWorkflowNodeStatus` / `TWorkflowConnectionType` / `IWorkflowNodeData` 등으로 단계적 전환(일괄 rename 금지) |
| UniversalValue axis 타입명(T/I 미준수) | `packages/agents/src/interfaces/types.ts` (`UniversalValue`, `PrimitiveValue`, `ContextData` 등) | @robota-sdk/agents | agents + 전체 의존 패키지 | Naming(T/I prefix) | Prefix Phase 2 | 높음 | public surface 영향 큼 → 패키지 단위/묶음 단위로 소규모 PR로 전환 |
| Tool contract 타입명/shape 정리 필요 | `packages/agents/src/interfaces/tool.ts` (`ToolResult`, `ToolExecutionContext`, `ToolMetadata` 등) | @robota-sdk/agents | tools + executor + examples | Naming + 계약 축 혼재 | Batch C | 높음 | 계약 타입을 `agents` tool axis로 고정하고, legacy hierarchy fields는 분리/제거(단일 경로) |
| ToolExecutionContext의 legacy hierarchy fields | `packages/agents/src/interfaces/tool.ts` (`parentExecutionId`, `rootExecutionId`, `executionLevel`, `executionPath`) | @robota-sdk/agents | ToolExecutionService/Tool impls | ownerPath-only 충돌(계층 필드 잔존) | Batch C | 중간 | ownerPath-only 원칙에 맞게 “필요/불필요”를 결정하고 불필요 필드는 제거(폴백/대체 경로 금지) |
| Workflow EventData 소유권/축 중복 | `packages/workflow/src/interfaces/event-handler.ts` (`export interface EventData`) | @robota-sdk/agents | workflow handlers/subscriber | 타입 소유권 충돌(event axis 중복) | Batch E | 높음 | workflow는 agents의 event axis(`EventContext`/ownerPath)로 수렴, workflow-local EventData 재정의 제거/비공개화 |
| Universal workflow types 중복(agents vs workflow) | `packages/agents/src/services/workflow-converter/universal-types.ts` vs `packages/workflow/src/types/universal-types.ts` | @robota-sdk/workflow | workflow converter + playground | 타입 소유권 충돌 + 중복 정의 | Batch D | 높음 | agents 쪽 정의 제거(또는 workflow import로 치환)하고 workflow가 단일 소스가 되게 정리 |
| UniversalWorkflowStructure 중복 정의 | `packages/agents/src/services/workflow-converter/universal-types.ts` (`UniversalWorkflowStructure extends WorkflowData`) vs `packages/workflow/src/types/universal-types.ts` (`export interface UniversalWorkflowStructure`) | @robota-sdk/workflow | converter + playground | 타입 소유권 충돌(구조 불일치 위험) | Batch D | 높음 | 구조를 workflow 단일 정의로 고정하고 converter는 workflow 타입을 import해서 구현 |
| Universal types에 `unknown`/`Record<string, unknown>` 사용 | `packages/workflow/src/types/universal-types.ts` (여러 곳) | @robota-sdk/workflow | playground/react-flow adapters | 타입 정책 위반 가능성(unknown) | Batch D | 중간 | workflow 확장값을 `UniversalValue | LoggerData | ...` 같은 제한된 union으로 치환, index signature/unknown 제거 방향 |
| “fallback” 의미 누출 | `packages/workflow/src/types/universal-types.ts` (`conditional.fallbackEdge?: string`) | @robota-sdk/workflow | UI/layout/renderer | No-Fallback policy 충돌(용어/의미) | Batch D | 중간 | fallback semantics를 드러내지 않는 도메인-중립 명명으로 교체(또는 제거) |
| Message contract 중복(AssistantMessage) | `packages/agents/src/interfaces/agent.ts`(deprecated) vs `packages/agents/src/managers/conversation-history-manager.ts` | @robota-sdk/agents | providers/adapters/tests | 계약 중복(드리프트 위험) | Batch B | 중간 | canonical 정의를 한 곳으로 고정하고, 다른 쪽은 제거(또는 public export 정리) |
| Batch D 진행 상태(레거시 제거) | `packages/agents/src/services/workflow-converter/**` 및 종속 모듈 | @robota-sdk/workflow | (이전: agents export) | 중복 소유권 제거 | Batch D | - | **완료**: agents에서 universal workflow converter/types/layout/validator 제거 + agents build PASS |

- [ ] “중복 선언 후보”를 패턴 기반으로 수집한다(명령은 예시, 실제 실행은 상황에 따라 조정):
  - [ ] **문자열 유니온 재정의**(status/role/type 등):
    - [ ] `rg "status:\\s*'pending'\\s*\\|\\s*'running'\\s*\\|\\s*'completed'\\s*\\|\\s*'error'" packages`
  - [ ] **계약 타입 로컬 재선언**(message/tool/workflow):
    - [ ] `rg "type\\s+UniversalMessage\\b|interface\\s+UniversalMessage\\b" packages`
    - [ ] `rg "type\\s+Tool(Result|Parameters|ExecutionContext)\\b|interface\\s+Tool(Result|Parameters|ExecutionContext)\\b" packages`
  - [ ] **owner export 우회(import 경로 오염)**:
    - [ ] `rg "from\\s+['\\\"]\\.\\./\\.?\\./.*interfaces/.*['\\\"]" packages` (패키지 내부 경로로 계약 타입을 가져오는 케이스 점검)
  - [ ] **T/I prefix 미준수 후보(대략)**:
    - [ ] type alias: `rg "\\btype\\s+[A-SU-Z][A-Za-z0-9_]+\\b" packages`
    - [ ] interface: `rg "\\binterface\\s+(?!I)[A-Za-z0-9_]+\\b" packages` (PCRE 필요 시 옵션/대안 결정)

#### 1.1) 스캔 정확도 게이트 (NEW)
- 배경: ripgrep 기본 엔진에서는 **lookahead/lookbehind** 같은 PCRE 기능이 적용되지 않아,
  “`(?!I)` 같은 패턴”으로 스캔하면 **거짓 음성(false negative)** 이 발생할 수 있다.
- 결정: 타입/인터페이스 prefix 전수 스캔은 **lookahead 없이** 아래 패턴만 사용한다(단일 기준).
  - export interface(미준수 후보): `rg "\\bexport\\s+interface\\s+[A-HJ-Z][A-Za-z0-9_]+" packages`
  - export type alias(미준수 후보): `rg "\\bexport\\s+type\\s+[A-SU-Z][A-Za-z0-9_]+\\s*=" packages`
  - local interface(미준수 후보): `rg "\\binterface\\s+[A-HJ-Z][A-Za-z0-9_]+" packages`
  - local type alias(미준수 후보): `rg "\\btype\\s+[A-SU-Z][A-Za-z0-9_]+\\s*=" packages`
- 완료 조건:
  - [ ] 위 스캔으로 잡힌 후보가 “수정 완료 후 감소”하는지 확인한다.
  - [ ] 스캔 루틴을 CI gate로 승격할지(경고→에러)는 별도 합의 후 결정한다.

#### 2) 수정 전략: “Owner로 수렴” (No-Fallback, 단일 경로)
- [ ] 공통 규칙: **소비처는 owner public export를 import하도록 변경**하고, 로컬 선언은 제거한다.
- [ ] cross-package contract 타입(예: `UniversalMessage`, tool contract, workflow 구조 등)은 반드시 **owner 패키지**에서만 정의/수출한다.
- [ ] re-export는 “owner public surface를 제공”하는 목적만 허용한다(동일 타입의 재정의/복제 금지).
- [ ] 타입을 옮기거나 합칠 때는 “의미/책임”이 바뀌지 않도록 하고, 런타임/데이터 변형은 금지한다(타입 정리=계약 정리).

#### 3) 배치(클러스터) 단위 실행 계획 (중복 제거를 “원인”으로 먼저 친다)

**Batch A — “로컬 문자열 유니온” 제거(대표: status/type/role)**
- [ ] 대상: UI/contexts/hooks에서 SDK 도메인 타입을 로컬 유니온으로 재정의한 케이스
- [ ] 처리: owner 타입을 import해서 시그니처/액션 payload/리듀서까지 일관되게 치환
- [ ] 검증: 변경 패키지별 build + root typecheck 유지

**Batch B — Message/Conversation 계약 단일화**
- [ ] 대상: `UniversalMessage`/message role/content/timestamp 계약을 로컬에서 선언/변형하는 케이스
- [ ] 처리: agents owner 타입으로 수렴, provider/remote/adapter/transformer에서 동일 계약 사용
- [ ] 검증: provider 패키지 build + 관련 테스트 타입체크

**Batch C — Tool contract 단일화**
- [ ] 대상: ToolResult/ToolParameters/ToolExecutionContext가 패키지별로 조금씩 다른 shape로 존재하는 케이스
- [ ] 처리: agents의 tool axis로 수렴, “UI 편의 타입”은 별도 이름으로 분리(계약 타입과 혼동 금지)
- [ ] 검증: agents build → 의존 패키지 build 연쇄

**Batch D — Workflow graph 계약 단일화**
- [ ] 대상: workflow node/edge/structure/status/connection 타입을 workflow 밖에서 재정의하는 케이스
- [ ] 처리: workflow owner 타입 import로 수렴, 필요 시 `extensions.*`로 UI 메타데이터를 제한된 값 타입으로만 확장
- [ ] 검증: workflow build + playground build

**Batch E — Event axis 계약 단일화(agents 소유)**
- [ ] 대상: workflow 등 비-owner 패키지에서 event envelope/data를 재정의한 케이스(예: workflow `EventData`)
- [ ] 처리: agents의 event axis(`EventContext`, ownerPath)로 수렴하고, 비-owner의 중복 타입은 제거/비공개화
- [ ] 검증: agents build + workflow build

#### 4) T/I Prefix Rollout (단계적, churn 최소화)
- [ ] **0단계(즉시, 하드룰)**: 앞으로 새로 추가/수정되는 타입 선언은 반드시 `T*`/`I*` 접두어를 적용한다.
- [ ] **1단계(자연 수렴)**: Batch A~D에서 “어차피 수정하는 파일” 안의 타입부터 `T/I`로 정리한다(패키지 전체 rename 금지).
- [ ] **2단계(패키지 단위 전환, 소규모 PR)**:
  - [ ] 우선순위: contracts 중심(agents/workflow) → 의존 패키지(openai/remote/playground) → apps
  - [ ] 한 PR당 규칙: “rename 범위는 패키지 1개 + 의미가 겹치는 타입 묶음 1세트”로 제한
- [ ] **명명 변환 가이드(필수)**
  - [ ] type alias → `T...` (`WorkflowNodeStatus` → `TWorkflowNodeStatus`)
  - [ ] interface → `I...` (`WorkflowNodeData` → `IWorkflowNodeData`)
  - [ ] 외부 라이브러리 타입명은 변경 불가이므로, 프로젝트 내부에서만 별칭을 둘 경우 `T/I` 규칙을 적용한다.

#### 5) 검증 게이트(정책 고정) — “새로운 위반이 유입되지 않게”
- [ ] 게이트 1(즉시): “owner 타입 로컬 재정의” 금지 패턴은 발견 즉시 정리한다(대표: status 유니온).
- [ ] 게이트 2(단계적): ESLint `@typescript-eslint/naming-convention`으로 `interface`는 `I` prefix 강제부터 시작한다(효과 대비 churn 낮음).
- [ ] 게이트 3(합의 후): `typeAlias`에 `T` prefix 강제를 도입한다(기존 코드 churn이 크므로 warning부터 시작하는 옵션 포함).

### Prefix Phase 3: 잔존 export 타입/인터페이스 + Base* 접두어 정리 (NEW)
> 목표: “public export surface”에 남아있는 무접두어 타입/인터페이스와 `Base*` 접두어를 제거하고, `I*/T*` 규칙으로 수렴한다.

#### A) Playground(@robota-sdk/playground) 잔존 정리
- [ ] `packages/playground/src/lib/playground/block-tracking/types.ts`
  - [ ] `BlockDataCollector` 포함, `Block*`/`RealTimeBlock*`/listener/event 타입을 `I*/T*`로 전환
- [ ] `packages/playground/src/lib/playground/block-tracking/block-hooks.ts`
  - [ ] `ToolHooks` → `IToolHooks` (interface)
- [ ] `packages/playground/src/lib/playground/robota-executor.ts`
  - [ ] `BaseTool`/`BasePlugin` 등 `Base*` 접두어 제거(SSOT 타입 import로 수렴)
  - [ ] `Playground*` 타입/인터페이스 `I*/T*` 전환(공개 계약만)
- [ ] 검증: `pnpm --filter @robota-sdk/playground build` PASS

#### B) Agents/Remote/Workflow 잔존 export 정리(스캔 기반)
- [ ] `packages/agents/src/services/execution-service.ts`: `ExecutionContext`/`ExecutionResult` 등 export interface `I*` 전환
- [ ] `packages/agents/src/abstracts/abstract-ai-provider.ts`: `ProviderConfig`/`ExecutorAwareProviderConfig` 등 export interface `I*` 전환
- [ ] `packages/agents/src/utils/logger.ts`: 런타임 `Logger`와 충돌하는 interface/type 정리(`ILogger` 등)
- [ ] `packages/remote/src/transport/websocket-*.ts`: websocket payload/export 타입 `I*/T*` 전환
- [ ] 검증: 변경 패키지별 build PASS (필수)
- [ ] 게이트 강제 위치 결정:
  - [ ] 로컬 개발: warning 허용 여부
  - [ ] CI: error 게이트 여부(“신규 위반 0”만 우선 적용 가능)

#### (추가) Auto-generated docs policy (docs/api-reference/**)
- [ ] `docs/api-reference/**`는 **자동 생성 산출물**이므로 사람이 직접 수정하지 않는다.
- [ ] 다음 작업에서 “자동 생성임을 명시 + 생성 스크립트/커맨드”가 파일 상단에 남도록 **생성 파이프라인을 수정**한다.
  - 예시(파일 상단 주석 템플릿):
    - `<!-- AUTO-GENERATED: do not edit by hand. Generated by: pnpm docs:api-reference -->`
  - TODO: repo 내 실제 생성 스크립트/커맨드(예: `pnpm docs:api-reference`)를 확정하고, 그 값을 주석에 넣는다.

### (추가) Alias Anti-Pattern 정리 + SSOT 강화 계획 (NEW)

> 목적: 타입을 “재사용”한다는 이유로 **무의미한 alias를 새로 만들거나**, **소비처에서 같은 shape를 다시 선언**하거나, **레이어(services/managers)가 contract를 alias/re-export로 퍼뜨리는** 패턴을 전부 제거한다.  
> 결과적으로 “정식(contract) 타입은 owner 1곳에서만 정의되고, 소비처는 그 타입을 그대로 import해서 사용”하도록 고정한다.

#### 문제 정의(이번에 추가된 관찰)
- **A1. 무의미 alias(semantic delta 없음)**: `type A = B` 형태로 “그냥 이름만 바꾼” alias가 계약 표면을 늘리고, owner가 무엇인지 더 흐리게 만든다.
  - 예: `packages/agents/src/abstracts/abstract-tool.ts`의 `AbstractToolParameters = TToolParameters`
  - 예: `packages/agents/src/utils/logger.ts`의 `LoggerContextData = TLoggerData`
- **A2. 동일 shape 재선언(consumer-side re-declare)**: 이미 SSOT가 있는 타입을 소비처가 같은 shape로 다시 interface/type로 선언한다(드리프트 위험).
  - 예: `packages/agents/src/interfaces/service.ts`의 `ToolCallData`는 `packages/agents/src/interfaces/messages.ts`의 `IToolCall`과 동일 shape
- **A3. 같은 이름/비슷한 의미인데 다른 정의(드리프트)**: 같은 타입명(또는 거의 같은 이름)이 레이어별로 서로 다른 정의로 존재한다.
  - 예: `packages/agents/src/services/conversation-service/types.ts`의 `TUniversalMessageMetadata`는 `packages/agents/src/interfaces/messages.ts`의 `TUniversalMessageMetadata`와 정의가 다름
- **A4. 레이어가 contract를 “자기 레이어 소유처럼” 재노출**: `interfaces`가 아닌 레이어(services/managers/plugins)가 contract를 alias/re-export해서 import 경로가 오염된다.
  - 예: `TUniversalMessage`가 `interfaces/messages.ts`가 아니라 `managers/conversation-history-manager` 경로로 소비되는 케이스 다수

#### 원칙(단일 경로, No-Fallback)
- **owner 파일에서 정의한 canonical 타입을 그대로 쓴다**: 소비처는 `@robota-sdk/<owner>`의 public export에서 import한다.
- **의미 변화가 없는 alias는 만들지 않는다**: “이름만 바꾼 alias”는 계약 표면과 인지부하만 늘린다.
- **레이어가 contract 타입을 재-export/alias로 퍼뜨리지 않는다**: `interfaces/*`가 contract SSOT이고, `services/*`/`managers/*`는 이를 소비만 한다.
- **정말로 별도 이름이 필요하면 “의미 차이”를 타입 수준으로 만든다**: 좁힌/확장한 필드, branded type, discriminated union 등 “검증 가능한 delta”가 있어야 한다.

#### 허용(예외) — alias가 정당화되는 경우
- **B1. 유니온/구성(composition)으로 의미를 만든 타입**: 예) `TUniversalMessage = IUserMessage | ...`
- **B2. 제네릭 제약/브랜딩으로 의미를 강화**: 예) `type TAgentId = string & { __brand: 'AgentId' }`
- **B3. public surface에서의 단일 진입점 제공(index 전용)**: `packages/<pkg>/src/index.ts` 또는 `packages/<pkg>/src/interfaces/index.ts`에서 “정식 타입만” re-export (legacy alias 재노출 금지)

#### 인벤토리(추가 행, 2025-12-25 스캔 기반)

| 개념(타입) | 현재 선언 위치(파일) | 의도 Owner | 소비 위치(대표) | 문제 유형 | 배치 | 난이도 | 수정 요약 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ToolCallData (동일 shape 재선언) | `packages/agents/src/interfaces/service.ts` | @robota-sdk/agents (Message axis: `interfaces/messages.ts`) | ConversationService/ExecutionService | A2 동일 shape 재선언 | Alias Batch 2 | 중간 | `ToolCallData` 제거 → `IToolCall` import로 수렴, `ConversationResponse.toolCalls`/`StreamingChunk.toolCalls`를 `IToolCall[]`로 통일 |
| TUniversalMessageMetadata (정의 드리프트) | `packages/agents/src/services/conversation-service/types.ts` | @robota-sdk/agents (Message axis: `interfaces/messages.ts`) | conversation service 내부/어댑터 | A3 드리프트 | Alias Batch 2 | 중간 | 동일 이름 재선언 금지: SSOT import로 치환, 로컬 좁힘이 필요하면 다른 이름으로 분리(`TProviderMessageMetadata` 등) |
| AbstractToolParameters (무의미 alias) | `packages/agents/src/abstracts/abstract-tool.ts` | @robota-sdk/agents (Value axis: `interfaces/types.ts`) | tool base class generics | A1 무의미 alias | Alias Batch 1 | 낮음 | `AbstractToolParameters` 제거(직접 `TToolParameters` 사용) 또는 “의미 차이”가 있으면 실제 타입 제약으로 표현 |
| LoggerContextData (무의미 alias) | `packages/agents/src/utils/logger.ts` | @robota-sdk/agents (Value axis: `interfaces/types.ts`) | logger utils | A1 무의미 alias | Alias Batch 1 | 낮음 | `LoggerContextData` 제거(직접 `TLoggerData` 사용) |
| TUniversalMessage import 경로 오염 | `packages/agents/src/plugins/**`, `packages/agents/src/abstracts/**`, `packages/agents/src/interfaces/service.ts` 등 | @robota-sdk/agents (Message axis: `interfaces/messages.ts`) | plugins/providers/services | A4 레이어 재노출 | Alias Batch 3 | 높음 | `interfaces/messages.ts`를 canonical로 고정하고, manager 레이어에서 type 재-export/alias를 제거하거나 내부 전용으로 격리 |
| ProviderConfigValue (이름 충돌/드리프트) | `packages/agents/src/interfaces/types.ts` vs `packages/agents/src/interfaces/provider.ts` | @robota-sdk/agents (Provider axis, 단일 기준 필요) | provider/robota/config | A3 드리프트(동일 이름 다른 정의) | Alias Batch 2 | 중간 | 같은 이름의 타입을 2곳에 두지 않기: owner 1곳으로 이동/통합하고, 다른 쪽은 import 사용(필요 시 이름을 분리) |
| TServiceEventData (무의미 alias) | `packages/agents/src/interfaces/event-service.ts` | @robota-sdk/agents (Event axis) | event-service consumers | A1 무의미 alias | Alias Batch 1 | 낮음 | `TServiceEventData = IBaseEventData` 같은 alias 제거 후 canonical 타입만 노출 |
| TToolOwnerPathSegment (무의미 alias) | `packages/agents/src/interfaces/tool.ts` | @robota-sdk/agents (Event axis: ownerPath segment) | tool axis | A1 무의미 alias | Alias Batch 1 | 낮음 | `TToolOwnerPathSegment = IOwnerPathSegment` 제거, tool axis는 `IOwnerPathSegment`를 직접 사용 |
| Tool axis의 “T로 시작하는 interface” | `packages/agents/src/interfaces/tool.ts` (`interface TToolResult`, `interface TToolExecutionContext`) | @robota-sdk/agents (Tool axis) | tools/execution | Naming(T/I) + 표면 혼란 | Prefix Phase 1/2 + Alias Batch 3 | 높음 | interface는 `I*`로 수렴(`IToolResult`, `IToolExecutionContext`), type alias는 `T*`로 구분하고, 서비스/추상/구현에서 동일 규칙으로 import 경로를 고정 |

#### 배치 실행 순서(추천)
- **Alias Batch 1 (낮은 churn / 즉시 효과)**: 같은 파일/레이어에서 의미 없는 alias 제거
  - 대상: `type A = B` 중 “A가 contract가 아니고 delta가 없는 것”
  - 완료 조건: alias 제거 후 import/사용처가 canonical 타입을 직접 사용
- **Alias Batch 2 (SSOT 수렴 / 드리프트 차단)**: “동일 shape 재선언” 및 “동일 이름 드리프트” 제거
  - 대상: `ToolCallData`, `TUniversalMessageMetadata` 같은 케이스
  - 완료 조건: 중복 선언 제거 + 소비처는 SSOT import만 사용
- **Alias Batch 3 (표면 정리 / 경로 오염 제거)**: services/managers/plugins의 contract re-export/alias 축소
  - 대상: manager 레이어 경유 import(`conversation-history-manager`)로 contract 타입을 가져오는 경로
  - 완료 조건: contract 타입 import 경로가 `interfaces/*` 또는 패키지 public export로 수렴

#### 빠른 스캔 게이트(문서화된 “검증 루틴”)
- 무의미 alias 후보:
  - `rg "\\bexport\\s+type\\s+[A-Za-z0-9_]+\\s*=\\s*[A-Za-z0-9_]+\\b" packages/agents`
- 동일 이름 재선언 후보:
  - `rg "\\bexport\\s+type\\s+TUniversalMessageMetadata\\b|\\binterface\\s+ToolCallData\\b" packages`
- manager 경유 import 오염 후보:
  - `rg "from\\s+['\\\"][^'\\\"]*conversation-history-manager['\\\"]" packages/agents`

### 최근 진행 기록 (2025-12-21) — Message/ToolCall 축 SSOT 정리 + export type 표면 정리

> 목적: **중복 선언이 “다시 퍼지는 경로”를 차단**하고, 앞으로 타입 정리를 이어갈 때 “어디를 고치면 되는지”가 한눈에 보이게 한다.

#### A) ToolCall 중복 선언 제거 → `IToolCall` 단일화(SSOT)
- **결정**
  - `ToolCall`이라는 이름(legacy/alias/중복 정의)은 프로젝트에서 더 이상 사용하지 않는다.
  - Tool call 구조 타입은 **`packages/agents/src/interfaces/messages.ts`의 `IToolCall`만** 소유한다.
- **정리 내용(완료)**
  - [x] `packages/agents/src/interfaces/provider.ts`의 `export interface ToolCall` 삭제
  - [x] `packages/agents/src/interfaces/messages.ts`의 `export type ToolCall = IToolCall` alias 삭제
  - [x] 소비처에서 `ToolCall` 참조를 `IToolCall`로 치환(예: provider, execution, adapter tests)
  - [x] 검증: `rg "\\bToolCall\\b" packages` 결과 0건
- **남은 TODO(권장)**
  - [ ] `packages/agents/src/interfaces/service.ts`의 `ToolCallData` 중복 선언 제거
    - 기준: `ConversationResponse.toolCalls`, `StreamingChunk.toolCalls`는 `IToolCall[]`를 사용하도록 수렴
    - 목적: “동일 shape 재정의” 방지(중복 타입 재발 방지)

#### B) UniversalMessage 계약(이름/표면) 정리
- **현 상태(관찰)**
  - `TUniversalMessage`가 실질적인 canonical union으로 사용되고 있음(agents 내부 다수 참조).
  - 일부 파일에서는 “manager/service/provider 경계”에서 메시지 타입을 다시 alias/re-export 하는 경향이 있음.
- **권장 결정(선택 필요)**
  - [ ] **정식 계약명**을 어디에 둘지 확정:
    - 옵션 1) `packages/agents/src/interfaces/messages.ts`가 message axis의 유일한 계약 정의(추천: owner가 명확)
    - 옵션 2) `packages/agents/src/managers/conversation-history-manager.ts`가 canonical message union을 export(현 구조 유지)
  - [ ] `TUniversalMessageRole`만 남기고, legacy alias(`MessageRole` 등)는 public surface에서 제거(또는 내부 전용으로 격리)

#### C) `export type { ... }` re-export 표면(공개 API) 정리
- **문제 정의**
  - `export type { ... }`가 여러 레이어에서 중복으로 노출되면, “정식 타입 이름/owner 축”이 흐려지고 alias가 다시 퍼질 수 있다.
- **정리 원칙(권장)**
  - [ ] 각 패키지의 public surface는 “정식 계약 타입만” 노출한다(legacy alias는 비노출).
  - [ ] `packages/*/src/index.ts`는 가능한 한 “한 곳(interfaces/index.ts 등)만” re-export 하도록 단순화한다.
  - [ ] 내부 구현 파일에서 타입을 다시 export(type-only re-export)하는 패턴은 최소화한다(특히 managers/services에서).
- **빠른 검증 게이트(권장)**
  - [ ] `rg "^\\s*export\\s+type\\s*\\{" packages`로 “표면 확산” 위치를 주기적으로 점검한다.

### 완료 조건(이 항목만)
- [ ] 이 문서의 인벤토리 표가 “owner/중복/수정 배치” 기준으로 채워져 있고, Batch A~E가 순차적으로 실행 가능 상태다.
- [ ] 신규 코드에서 `T/I` 규칙이 지켜지고(게이트 포함), 기존 코드는 churn 없이 배치 단위로 감소 추세가 확인된다.


## 📝 Priority 1: .design Documentation Maintenance (선택)

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

## 🔥 Priority 1-B: Agent Event Normalization (진행중)

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
        - [x] playback 모드에서 실제 Provider 호출이 발생하면 즉시 예외 (playback에서는 delegate provider 주입을 거부)
        - [x] scenario step 소비 여부 추적 후, 미사용 step 존재 시 실패 처리 (`[SCENARIO-UNUSED]`)
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
      - [x] `pnpm scenario:record`/`pnpm scenario:play` 스크립트 추가 (환경 변수 세팅 포함, args는 `--`로 전달).
      - [x] `pnpm scenario:verify` 추가 (예제 실행 실패 또는 `[STRICT-POLICY]`/`[EDGE-ORDER-VIOLATION]` 감지 시 verify 금지).
      - [x] README에 실행 플로우(Recorder→Playback→Guard) 및 사용법 문서화 (`apps/examples/README.md`).
      - [x] concurrency/ordering 안내: 동일 `scenarioId`에 동시 record/append 금지 (단일 writer lockfile).
        - 규칙: `ScenarioStore.appendStep()`는 `scenarios/.locks/<scenarioId>.lock`를 `wx`로 획득하지 못하면 즉시 실패(대기/재시도 없음).
        - stale lock: recorder 프로세스 크래시로 lockfile이 남을 수 있으며, 이 경우 개발자가 lockfile을 수동 삭제 후 재시도한다(자동 우회/폴백 금지).
   4. Guard 통합
      - [x] Guard 스크립트가 `SCENARIO_RECORD_ID`/`SCENARIO_PLAY_ID`를 감지해 Recorder/Mock를 자동 주입하도록 업데이트.
      - [x] playback 모드에서 실제 Provider/Tool 호출 감지 시 즉시 실패하도록 감시 로직 추가 (`assertNoRealCalls()`).
      - [x] scenario step 소비 여부 추적 후, 미사용 step이 남으면 “[SCENARIO-UNUSED] …” 경고를 띄우고 실패 처리.
      - 구현 메모:
        - `apps/examples/lib/scenario-provider.ts`: `createScenarioProviderFromEnv()`로 record/play/none 단일 진입점 고정
        - guarded 예제(26/27)는 play 모드만 허용하며, 종료 시 `assertNoUnusedSteps()`로 unused step이면 즉시 실패

#### 단계 6.5: 단일 전환 단계 (Decision Gate)
- [x] Agent 핸들러: `agent.execution_start`는 상태 전이만 (노드 생성 절대 금지)
- [x] 단계 3의 "없을 때만 임시 생성" 하위호환 로직 완전 제거
  - `ExecutionEventHandler`: `execution.user_message` 연결에서 `WorkflowState` fallback 제거 → 미존재 시 fail-fast
  - `AgentEventHandler`: `execution.assistant_message_start`에서 `WorkflowState.getLastUserMessage(...)` 제거 → 동일 execution scope의 최신 `user_message`를 scan으로 결정, 미존재 시 fail-fast
- [x] 팀/툴 발행자: `tool.agent_execution_started` emit/핸들링 완전 제거 (repo 전수 스캔 0건)
- [x] 상수 제거: `packages/team/src/events/constants.ts` (파일/참조 0건 확인)
- [x] 빌드/가드/검증 (원샷 검증)
  - `pnpm --filter @robota-sdk/workflow build` PASS
  - 예제 26 재검증: nodes=18 / edges=18, verify PASS (`SCENARIO_PLAY_ID=mandatory-delegation`, sequential)
  - 예제 27 재검증: nodes=15 / edges=14, verify PASS (`SCENARIO_PLAY_ID=continued-conversation`, sequential)

#### 단계 6.6: Fork/Join round2 thinking 연결 교정
- [x] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [x] `execution.assistant_message_start`에서 연결 소스 결정 규칙 확정 (Path-Only)
    - 우선: 동일 execution scope의 최신 `tool_result`가 존재하면 `tool_result → thinking (analyze)`
    - 그 외: 동일 execution scope의 최신 `user_message → thinking (processes)`
    - 둘 다 없으면 fail-fast (No-Fallback)
- [x] 빌드/가드/검증
  - 예제 26/27 verify PASS로 round2 연결 규칙 포함 회귀 검증 완료
- [x] round2 연결 검증: `tool_result → thinking_round2 (analyze)` (예제 26/27로 재검증)

#### 단계 8: Subscriber Path Map Reader (선택, 우선순위 낮음)
- [ ] `PathMapReader` 객체 설계 (읽기 전용)
- [ ] 명시 필드만으로 인덱스 구축
- [ ] Agent 핸들러 등에 적용
- [ ] `getAllNodes()` 직접 스캔과 결과 동등성 검증

#### 단계 9: base-* → abstract-* 마이그레이션 (신규)
- [x] 1차 스캔/전환/품질 게이트(대부분) 완료 — 하단 “n차 완료 항목” 근거
- [x] 예제/서비스에서 `ActionTrackingEventService` 직접 참조 금지 확인 (코드 기준 0건)
- [ ] **잔여(마감 단계)**: `base-*` re-export 스텁 파일을 “개별 삭제(한 번에 많이 삭제 금지)”로 마감
  - [x] 대상 목록화(base-* 스텁 파일 경로 테이블)
    - `packages/agents/src/abstracts/base-agent.ts`
    - `packages/agents/src/abstracts/base-manager.ts`
    - `packages/agents/src/abstracts/base-provider.ts`
    - `packages/agents/src/abstracts/base-ai-provider.ts`
    - `packages/agents/src/abstracts/base-tool.ts`
    - `packages/agents/src/abstracts/base-plugin.ts`
    - `packages/agents/src/abstracts/base-executor.ts`
    - `packages/agents/src/abstracts/base-layout-engine.ts`
    - `packages/agents/src/abstracts/base-workflow-converter.ts`
    - `packages/agents/src/abstracts/base-workflow-validator.ts`
    - `packages/agents/src/abstracts/base-visualization-generator.ts`
    - `packages/agents/src/interfaces/base-types.ts` (→ `generic-types.ts`로 rename 후 삭제)
  - [x] 1개 파일 삭제 → `pnpm --filter @robota-sdk/agents build` 반복 완료 (삭제/빌드 모두 PASS)
  - [x] 삭제 완료 후 `rg "from .*\\/base-"` 0건 확인
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
- [x] `packages/workflow/src/services/workflow-state.ts`
  - [x] 보류/임시 큐/배리어 관련 상태·API 제거 (최소 read-only indices만 유지)
  - [x] Path-Only 원칙에 맞게 단순화

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

### 현 상태(코드 기준, 2025-12-21)
- DnD 이벤트 라인(드래그 payload → drop → callback)은 **이미 존재**한다.
  - `PlaygroundApp.tsx`: tool 카드 drag 시 `dataTransfer`에 `application/robota-tool`로 JSON serialize
  - `WorkflowVisualization.tsx`: drop 이벤트를 받아 `onToolDrop(agentId, tool)`로 위임
- “툴 목록/추가/삭제/오버레이 상태”는 체크리스트(B-2/B-4) 기준으로 **구현 완료**되어 있다.
  - `PlaygroundContext`가 `toolItems`/`addedToolsByAgent`를 단일 진실로 소유한다.
  - 사이드바에서 도구 추가/삭제가 가능하고, drop 시 overlay에 즉시 반영된다.

### 제안 방향(규칙 정합, 최소 변경)
- **SDK tool registry/실행 경로를 건드리지 않고**, UI는 **overlay state**로만 “agent에 tool이 추가됨”을 표현한다.
  - Path-only 워크플로우 그래프(이벤트 기반)는 그대로 유지
  - UI는 `toolItems`(드래그 가능한 도구 목록) + `addedToolsByAgent`(드롭 결과) 2개 상태만 관리

### 결정(필수)
- `toolItems`/`addedToolsByAgent`의 상태 위치:
  1) `PlaygroundApp` 로컬 상태로 시작(단순/빠름)
  2) `PlaygroundContext` 전역 상태로 시작(구조적/확장성)
  - 결론: **2) PlaygroundContext 전역 상태**로 고정 (이미 적용됨)

### B-1. 브릿지/레지스트리 보강
- [x] `apps/web/src/lib/playground/robota-executor.ts`
  - [x] executor 에러를 UI 표준 에러로 변환

### B-2. Tools 목록 관리(UI)
- [x] `ToolItem` 타입 선언 및 유효성 체크 (`PlaygroundToolMeta`)
- [x] `toolItems` 상태 초기값 및 setter (PlaygroundContext: `getPlaygroundToolCatalog()` + `setToolItems`)
- [x] 사이드바 카드 리스트 렌더 (스크롤/접근성)
- [x] `+ Add Tool` 모달 (name, description)
- [x] ID 생성 규칙 (kebab + 6자리 토큰) 및 중복 방지 (충돌 시 fail-fast + 재시도)
- [x] 추가 후 정렬 및 포커스 이동 (scrollIntoView + focus)
- [x] 삭제 (builtin 제외)

### B-3. DnD 상호작용 보강
- [x] 빠른 연속 드롭 디바운스 (기준 고정: 동일 agentId+toolId 조합, 300ms)
- [x] 중복 드롭 시 UI 유지 (상태 변경 없음 + toast는 1회만)

### B-4. UI 오버레이 상태 (addedToolsByAgent)
- [x] 타입 정의: `AddedToolsByAgent = Record<AgentId, string[]>` (web: `Record<string, string[]>`)
- [x] 상위 페이지 상태 `addedToolsByAgent` 구현 (PlaygroundContext로 전역 고정)
- [x] `onToolDrop(agentId, tool)` 집합 추가 (drop 성공 시 overlay 갱신)
- [x] `WorkflowVisualization`에 props 전달 (`addedToolsByAgent`, `toolItems`)
- [x] `AgentNode` 렌더 시 합집합 뱃지 표시 (추가된 tool badge + 목록)
- [x] 병합 규칙: SDK 도구 ∪ 오버레이 도구
  - 정의: Agent 노드의 “Tools” 표시는 `(SDK tools from workflow) ∪ (UI overlay tools)`의 합집합으로 계산/표시한다.
  - 원칙: SDK 그래프/노드/엣지는 변경하지 않고, UI는 overlay만 추가로 보여준다(Path-only 보존).
- [x] 성공/실패 토스트 표준화 (`useToast()` 기반)

### B-5. 수용 기준
- [x] 드래그 시 Agent 노드 시각적 반응
- [x] 드롭 시 툴 뱃지 즉시 추가 (중복 없음)
- [x] Workflow Path-Only 보존

---

## 🗑️ Priority 4: Pricing 기능 제거 (무료 플랫폼 전환)

### Phase 1: Pricing UI 제거
- [x] `/pricing` 라우트 및 관련 컴포넌트 삭제 (apps/web/src 기준 `/pricing` 잔여 0)
- [x] Header/Navigation에서 Pricing 링크 제거
- [x] 모든 "Upgrade" 프롬프트 및 버튼 제거
- [x] Dashboard에서 Plan/Subscription 정보 섹션 제거

### Phase 2: Billing 로직 제거
- [x] `/api/v1/billing/*`, `/api/v1/subscriptions/*` 엔드포인트 삭제 (apps/web/src 기준 경로 잔여 0)
- [x] `types/billing.ts` 및 관련 타입 제거
- [x] `lib/billing/plans.ts` 및 billing 관련 모듈 제거
- [x] Firebase billing/credits 컬렉션 사용 중단 (credit/billing 코드 제거)

### Phase 3: 무료 크레딧 시스템 전환
- [x] `UserCredit` 타입 제거(기능 삭제)
- [x] Plan/credits 기반 제한 로직 제거 (Playground는 단일 free-only 정책으로 단순화)
- [x] Usage/limits UI에서 plan/upgrade/cost 표기 제거
- [x] 제한 도달 시 메시지에서 업그레이드/플랜 언급 제거

### Phase 4: 설정 정리
- [x] Stripe 관련 환경 변수/의존성 제거 (repo 기준 `stripe|@stripe|stripe-js` 잔여 0)
- [x] API 문서에서 billing 엔드포인트 제거
- [x] 사용하지 않는 billing 타입 및 테스트 정리

---

## ✅ 성공 기준

### Agent Event Normalization
- [x] Agent 노드 생성은 오직 `agent.created`
- [x] `agent.execution_start`는 상태 전이만
- [x] `tool.agent_execution_started` 완전 제거
- [x] 예제 26 가드/검증 통과
- [x] 이벤트명 하드코딩 금지(상수만 사용) — ESLint 룰 + 정리로 고정
- [x] Fork/Join 다중 depth Path-Only 연결 — 정의: ownerPath에 `tool → agent`가 1단계 이상 중첩(= tool이 agent를 생성/실행)되는 케이스까지 path-only로 단일 그래프 연결

### Fork/Join Path-Only
- [x] `groupId`/`branchId`/`responseExecutionId` 제거 (packages 기준 잔여 0)
- [x] WorkflowState 경량화 완료
- [x] 이벤트 소유권 ESLint 룰 적용 (emit/on/once/off 문자열 리터럴 금지)
- [x] Continued Conversation 예제 27 통과

### Tools DnD
- [x] 드래그앤드롭 동작 안정적 (agentId+toolId 기준 300ms 디바운스로 중복 drop 이벤트 차단)
- [x] 툴 뱃지 정확히 표시 (overlay `addedToolsByAgent` + tool catalog로 렌더)
- [x] 중복/간섭 없음 (overlay 중복 추가 없음 + “already added” toast 1회)
- [x] Path-Only 보존 (UI overlay는 workflow graph를 변경하지 않음)
  - [x] B-1 executor 에러 → UI 표준 에러
    - 표준 타입(최소 스펙, 3줄):
      - `user_message`: 사용자에게 그대로 보여줄 메시지(복구 가능, 입력 수정/재시도 안내 포함)
      - `recoverable`: 시스템/네트워크/일시 오류(재시도 권장, 상태는 유지)
      - `fatal`: 규칙 위반/불변 조건 실패 등(즉시 실패, 사용자에게 “버그/설계 오류”로 안내)

### Pricing 제거
- [x] UI에서 pricing/billing/upgrade/plan tier 잔여 제거 (apps/web/src 기준 pricing/billing/upgrade/plan-tier 잔여 0)
- [x] API 엔드포인트/가드 정리: playground access/limits에서 tier 기반 로직 제거, 단일 free-only 정책으로 고정
- [x] 무료 크레딧 시스템 제거(기능 삭제): credit/subscription UI+API+Firebase 서비스/타입 제거 완료
- [x] Stripe 의존성 제거 (repo 기준 `stripe|@stripe|stripe-js` 잔여 0)

---

## 🧩 Type Audit Summary (SDK core only)

> Scope: `packages/agents` → `packages/workflow` → `packages/team`  
> Priority: **type duplication / cohesion (single ground-truth axis)**  
> Output: keep this section as the single source of truth (no separate doc).

### Ground-truth axis (proposed)
- **agents owns**: Event axis + Tool axis + Agent axis (domain-neutral)
- **workflow owns**: node/edge graph types only (import event/tool/agent types from `agents`, no duplication)
- **team owns**: minimal assignTask/MCP tool-collection surface only (reuse `agents` types)

### packages/agents — export surface (high-level)
- Public exports are centralized via `packages/agents/src/index.ts` → `export * from './interfaces'` + selected re-exports.
- Key exported axes:
  - Event: `EventContext`, `OwnerPathSegment`, `BaseEventData`/`ExecutionEventData`/`ToolEventData`/`AgentEventData`, `EventService`
  - Tool: `ToolExecutionContext`, `ToolParameters`, `ToolResult`, tool schema/registry types
  - Agent: `AgentConfig`, messages (`Message`/`UserMessage`/`ToolMessage`), `RunOptions`

### packages/agents — duplication / cohesion issues (Top candidates)
1) **ToolParameters duplicated**
   - `interfaces/types.ts`: `ToolParameters` already exists
   - `interfaces/tool.ts`: defines another `ToolParameters` + `ToolParameterValue`
   - Impact: multiple “same-name, different-shape” types leak across layers → fragile imports
2) **ToolExecutionContext contains legacy hierarchy fields + broad index signature**
   - `interfaces/tool.ts` still carries `parentExecutionId/rootExecutionId/executionLevel/executionPath` etc.
   - Also includes an index signature that permits `unknown` (with eslint disable) → weakens strict typing
3) **AssistantMessage duplication**
   - `interfaces/agent.ts` has `AssistantMessage` marked deprecated, while `conversation-history-manager` exports another `AssistantMessage`
   - Impact: callers may import the wrong one; deprecation is not enforced at compile time
4) **OwnerPathSegment type split**
   - `interfaces/event-service.ts` defines `OwnerPathSegment`
   - `interfaces/tool.ts` aliases `ToolOwnerPathSegment = OwnerPathSegment`
   - Impact: redundant aliasing increases surface area with no benefit

### Proposed refactor outline (agents first; apply after explicit approval)
- [x] **Consolidate ToolParameters** into a single owner module (prefer `interfaces/types.ts`), and make `interfaces/tool.ts` reuse it (no duplicate name).
- [ ] **Tighten ToolExecutionContext**:
  - [ ] remove legacy hierarchy fields that conflict with ownerPath-only design (or move to a clearly named legacy-only interface if still required)
  - [x] remove `unknown` from index signatures; replace with a constrained “extension value” union (similar to `EventExtensionValue`)
- [ ] **Unify AssistantMessage**:
  - decide one canonical export (likely `conversation-history-manager`), update public export guidance, and remove/replace the deprecated interface usage sites
- [ ] **Minimize OwnerPath segment types**:
  - keep `OwnerPathSegment` only in the Event axis; avoid tool-specific alias unless a real semantic difference exists

### packages/workflow — export surface (high-level)
- Public exports via `packages/workflow/src/index.ts`:
  - interfaces: `workflow-node`, `workflow-edge`, `workflow-builder`, `event-handler`, `workflow-plugin`
  - services: `node-edge-manager`, `workflow-builder`, `workflow-event-subscriber`
  - handlers: `agent-event-handler`, `tool-event-handler`, `execution-event-handler`
  - types: `types/universal-types.ts`

### packages/workflow — duplication / cohesion issues (Top candidates)
1) **EventData duplicates agents event axis**
   - `interfaces/event-handler.ts` defines `EventData` with `executionId/rootExecutionId/executionLevel/path` and `[key: string]: unknown`
   - This overlaps with `@robota-sdk/agents` (`BaseEventData` + `EventContext.ownerPath`) and can drift from ownerPath-only rules
2) **WorkflowNodeData is overly loose**
   - `interfaces/workflow-node.ts`: `parameters?: Record<string, unknown>`, `result?: Record<string, unknown>`, `[key: string]: unknown`
   - This weakens type safety and makes cross-package contracts unclear
3) **Universal types carry UI-ish “fallback” semantics**
   - `types/universal-types.ts` includes `UniversalWorkflowEdge.conditional.fallbackEdge?: string`
   - Even if UI-only, the name encourages fallback semantics and increases surface area; consider a domain-neutral alternative
4) **Terminology drift: copyNumber**
   - `workflow-node.ts` includes `copyNumber?: number` in node data (terminology should avoid “copy” wording)

### Proposed refactor outline (workflow; apply after explicit approval)
- [ ] Define a single workflow event envelope that reuses agents axis:
  - `EventContext` + `BaseEventData` (import from `@robota-sdk/agents`)
  - workflow-specific “rendering metadata” must live under `extensions.*` with constrained value types (no `unknown`)
- [ ] Replace `EventData` in `interfaces/event-handler.ts` with a type derived from agents axis (or make it explicitly internal and not re-exported).
- [x] Tighten `WorkflowNodeData`:
  - [x] replace `Record<string, unknown>`/`[key: string]: unknown` with constrained unions aligned with `agents` (`UniversalValue`/`LoggerData`-like)
- [ ] Rename/remove `fallbackEdge` field from universal edge types to avoid fallback semantics leakage.
- [ ] Replace `copyNumber` terminology with `replicaNumber` (or remove if only UI-derived).

### packages/team — export surface (high-level)
- Public exports are intentionally minimal (`packages/team/src/index.ts`):
  - `listTemplateCategoriesTool`, `listTemplatesTool`, `getTemplateDetailTool`, `createAssignTaskRelayTool`

### packages/team — duplication / cohesion issues (Top candidates)
1) **Type escapes (`as any`) in ToolResult payloads**
   - `assign-task/relay-assign-task.ts` returns `{ data: ... } as any` in a few places
2) **`any` usage in ownerPath cloning**
   - ownerPath clone uses `(s: any) => ({ ...s })` instead of a typed clone over `OwnerPathSegment`
3) **Unvalidated parameter casts**
   - `params as AssignTaskParams` assumes shape without runtime validation; prefer field-level extraction + validation

### Proposed refactor outline (team; apply after explicit approval)
- [x] Remove `as any` payload escapes by shaping `ToolResult.data` to a typed object (or introduce a constrained “assignTask result payload” type).
- [x] Replace `any` ownerPath cloning with `OwnerPathSegment[]`-typed cloning.
- [x] Replace `params as AssignTaskParams` with explicit field checks to keep ToolResult deterministic and type-safe.


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
- 2025-12-20: (Type axis 정리) agents/workflow/team 타입 축 정리 적용 + 빌드/회귀 검증 PASS
  - `pnpm --filter @robota-sdk/agents build` PASS
  - `pnpm --filter @robota-sdk/workflow build` PASS
  - `pnpm --filter @robota-sdk/team build` PASS
  - Guarded 26 재검증: **nodes=18 / edges=18**, verify PASS (`SCENARIO_PLAY_ID=mandatory-delegation`, sequential)
  - Guarded 27 재검증: **nodes=15 / edges=14**, verify PASS (`SCENARIO_PLAY_ID=continued-conversation`, sequential)
- 2025-12-20: (team 정리) docs/README/examples에서 “Team Collaboration” 잔여 제거, 05 스크립트 제거, 07은 `07-agent-templates.ts`로 교체. api-reference(team) stale 문서 삭제.
- 2025-12-20: (scenario CLI) `pnpm scenario:record/play/verify` 추가, verify는 예제 실패/strict-policy violation 시 즉시 중단. `apps/examples/README.md`에 실행 플로우 문서화.
- 2025-12-20: (Stage 6.5/6.6) workflow handlers에서 `WorkflowState` fallback 제거 → path-only scan + fail-fast로 고정.
- 2025-12-21: (Priority 0.5) Playground 라이브러리 추출/호스트 최소화 진행 — `packages/playground`로 Playground UI/워크플로우/툴/훅/유틸 이동(`@/` alias 0), Next 의존 제거(next-themes 제거), tsup external/CSS 설정 및 `package.json` 의존성 정리. `apps/web`는 `/playground` + `/playground/demo`만 남기고 Website/Auth/Pricing 관련 파일/의존성/문구 제거(`auth|firebase|login|signup` 및 `pricing|billing|subscription|plan|stripe|credit` 0건 확인).
- 2025-12-25: (Type Ownership + Prefix) `@robota-sdk/agents` tool/service 축 `T/I` 접두어 적용 배치 완료
  - `ToolInterface`→`IToolInterface`, `FunctionTool`→`IFunctionTool`, `ToolRegistryInterface`→`IToolRegistry`, `ToolFactoryInterface`→`IToolFactory`
  - `ParameterValidationResult`→`IParameterValidationResult`, `ToolExecutor`→`TToolExecutor`
  - `OpenAPIToolConfig`→`IOpenAPIToolConfig`, `MCPToolConfig`→`IMCPToolConfig`
  - `ConversationServiceOptions`→`IConversationServiceOptions`
  - 적용 범위: tool implementations, registry/manager, facade(`function-tool/*`) export 표면 정리
  - 검증: `pnpm --filter @robota-sdk/agents build` PASS

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
   - [x] 예제: `apps/examples/05/06/07 team-*` 정리
     - 05: 파일 미존재(legacy script 제거)
     - 07: `07-team-templates.ts` → `07-agent-templates.ts`로 교체(팀 개념 제거)
   - [x] 문서/설정: `docs/**`, `packages/*/docs/**`, README 계열, api-reference(team) 정리
   - 스캔 결과(정리 필요 대상):
     - 코드/Web/Playground: 처리 완료
     - 코드/SDK: `packages/workflow/DEVELOPMENT_PLAN.md` 등 의존 언급만 확인(실제 팀 코드 없음)
    - 예제: 05/07 정리 완료(팀 명칭 제거), 26은 deprecated guard 유지
     - 문서/README: “team=멀티에이전트/협업” 표현을 assignTask MCP-only로 정정 완료
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
    - [x] team 전용 예제(05/06/07) 통폐합 → assignTask 중심으로 정리
       - 유지/신규:
        - [x] `assign-task-basic.ts`: listTemplates → getTemplateDetail → assignTask 호출 shape 출력(실행은 하지 않음; no LLM calls)
        - [x] `assign-task-categorized.ts`: category → templates → detail → assignTask 호출 shape 출력(실행은 하지 않음; no LLM calls)
       - 축소/스텁:
         - 26번: team/ATS/Bridge 제거, assignTask 호출 샘플만 남긴 스텁, 실행 스킵 가드 유지
       - 폐기/대체:
        - [x] 05/07 team 예제 제거/대체(팀 스트림/Remote 비교 시나리오 폐기)
       - 공통 원칙:
         - createTeam/Team API 전면 제거, 단일 Robota + assignTask MCP 호출
         - LLM 호출 금지(캐시/가드 주석), 템플릿/모델 상수로 데모
         - 결과는 콘솔 요약만, ownerPath-only/노-폴백 준수
    - [x] guard/검증 스크립트 강화: 예제 실패 또는 strict-policy violation 시 verify 금지(`apps/examples/utils/verify-scenario.ts`, `run-and-verify-workflow.ts`)
   - SDK/에이전트:
     - [x] team 전용 헬퍼(SubAgentEventRelay 등) 제거 대상 식별, assignTool 경로로 치환 여부 판단
     - [x] `packages/team/src/types.ts`를 assignTask 전용 최소 타입만 남기고 정리: `TaskAgentConfig`/특수 에이전트 관련 타입/주석 삭제, 표준 AgentConfig만 사용
     - [x] `assign-task/**` 구현이 특수 Agent 분기 없이 표준 Agent 생성만 수행하는지 재검증 (ownerPath-only, no-fallback)
     - [x] 전역 검색 `rg "TaskAgent"` / `rg "TaskAgentConfig"` / `rg "specialized agent"`로 잔여 표현 제거
     - [x] `pnpm --filter @robota-sdk/team build`로 타입/빌드 검증 (특수 Agent 제거 후)
   - 이벤트/경로:
    - [x] team prefix 이벤트 전면 제거, ownerPath-only 유지 (code 기준 `'team.'` 이벤트 0건 확인)
    - [x] assignTool 호출이 tool/agent 이벤트만 사용하도록 점검 (code 기준 `'team.'` 이벤트 0건 확인)

3. **의존성 제거 (순서 명시)**
  - [x] (정책 고정) `@robota-sdk/team` import는 허용하되, 범위를 “assignTask MCP tool collection”으로 제한한다
  - [x] **전수 스캔(0건 확인)**: legacy team/협업 API 재유입이 없는지 확인 (경로/분류 테이블 활용)
    - 예: `createTeam`, `TeamContainer`, `team collaboration`, `TaskAgent*`

4. **검증**
   - [ ] `pnpm --filter @robota-sdk/agents build` 및 영향 패키지 빌드
   - [ ] apps/web smoke (team 기능 제거 후 기본 흐름)
   - [ ] 예제 실행: team 제거 대상은 스킵/삭제, 나머지 예제 정상 동작 확인

5. **차단책**
  - [x] 신규 team import “전면 금지”는 사용하지 않는다(현재 정책과 충돌)
  - [ ] **차단책(검증 게이트)**:
    - [x] `createTeam`/`TeamContainer`/팀 협업 개념 API 재유입 0건 확인 (rg/lint 기준)
    - [x] `team.*` prefix 이벤트 재유입 0건 확인 (ownerPath-only 유지; code 기준 `'team.'` 이벤트 0건)
    - [x] 문서/예제에서 “team=멀티 에이전트 협업” 표현 재유입 0건 확인

**2025-11-30 업데이트**
- ExecutionService가 ownerPath 기반 `emit(eventType, payload, context)` 패턴으로 전환되었고 `ActionTrackingEventService` clone/ownerPrefix 의존성이 제거되었습니다.
- 모든 execution/tool 이벤트가 helper(`emitExecutionEvent`, `emitToolEvent`)를 통해 `ownerType`, `ownerPath`를 명시합니다.
- `maybeClone`/`trackExecution` 레거시 호출과 `toolEventService` 분기가 제거되어 context 누락 케이스를 차단했습니다.

