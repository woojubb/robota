# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**과 **완료된 작업([x])**을 함께 관리합니다.  
> “어떻게 업그레이드/마이그레이션 했는지” 같은 장문의 서술은 최소화하고, 체크리스트 중심으로 유지합니다.

---

## 🔁 Priority 0.55: Workflow 브릿지/어댑터 SSOT 정리 (중복 제거)

### 목표
- Workflow 이벤트 브릿지(EventService → WorkflowEventSubscriber)를 단일 구현(SSOT)으로 수렴
- `apps/examples` / `packages/playground` 중복 제거, 공통은 `packages/workflow`로 이동
- Path-only / No-fallback / event constants 규칙을 브릿지에서도 동일 적용

### 작업 항목
- [x] 전수조사: Workflow 브릿지/어댑터 후보 목록화(파일/역할/사용처)
- [x] 차이점 표 작성: payload shaping / context 요구조건 / timestamp 요구조건
- [x] SSOT 위치 확정: `packages/workflow`에 공용 브릿지 1개로 수렴
- [x] `packages/playground` → SSOT 교체 후 중복 파일 제거
- [x] `apps/examples` → SSOT 교체 후 중복 파일 제거
- [x] Workflow subscriber 계약(Contract) 추가: `IWorkflowEventSubscriber` 도입 및 브릿지에서 type import 교체
- [x] 빌드 게이트: `pnpm --filter @robota-sdk/workflow build`, `pnpm --filter @robota-sdk/playground build`, `pnpm typecheck`

---

## ✅ Priority 0.56: Playground Monaco 자동완성(인텔리센스) 제거

### 목표
- Playground는 “코드 편집 UI”만 제공하고, Monaco 기반 자동완성/타입 주입/진단 지원은 제공하지 않는다.
- SSOT 관점에서 SDK 계약을 playground 내부에서 재정의(`declare module`)하는 일을 금지한다.

### 작업 항목
- [x] `packages/playground/src/components/playground/code-editor.tsx`에서 `addExtraLib` 기반 타입 주입 제거
- [x] Monaco editor 옵션에서 자동완성/힌트 관련 설정 비활성화
- [x] (되돌림) packages/*에 추가했던 Monaco 타입 스텁 export 및 파일 제거
- [x] 빌드/타입체크: `pnpm --filter @robota-sdk/playground build`, `pnpm typecheck`

---

## ✅ Priority 0.57: SSOT 1차 중복 선언 스캐너 + 크로스 패키지 중복 제거

### 목표
- `apps/**` + `packages/**`의 `class/interface/type` 선언부만 추출하여 “중복 후보”를 1차로 잡는다.
- I/T 접두어를 제거한 정규화 이름 기준으로 “크로스 패키지(root) 중복”을 우선 제거한다.

### 작업 항목
- [x] 1차 스캐너 생성 및 결과 저장: `.design/open-tasks/ssot-duplicate-declarations-v2.json`
- [x] 스캐너 정확도 보정: `import { type X }` 오탐 방지(`type Name =`만 선언으로 취급)
- [x] 크로스 패키지(root) 중복 그룹 0개 달성 (v2 스캔 기준)
- [x] 스캐너 v3: 중복 그룹을 “same-kind 중복” vs “contract+implementation 페어(class+interface)”로 분류하여 노이즈 감소
- [x] 다음 단계: same-kind 중복(비-test)만 0개 달성 (v3 스캔 기준)
- [x] 다음 단계: 선언 이름에 `Interface`/`Type`/`TypeSafe` 키워드 포함 현황(접미어+중간 포함) 인벤토리/수치화(v3 report에 포함)

---

## 🧭 Priority 0.6: CI / typecheck / lint 운영(0으로 만들기)

- [x] 1차 배치: `pnpm typecheck` PASS (agents/openai/anthropic/playground 타입 에러 제거)
- [ ] 2차 배치: `any/unknown` 다수 파일을 SSOT 타입 축(`UniversalValue`/`LoggerData` 등)으로 수렴
- [ ] 3차 배치: `packages/agents/src/services/node-edge-manager.ts` 공개/비공개 범위 결정(필요 시 타입 축 정리, 불필요 시 export/사용처 제거)
- [ ] 각 배치마다 `pnpm --filter @robota-sdk/agents lint`로 “문제 개수 감소” 확인

---

## 🧩 Priority 0.7: Type Ownership Audit (SSOT) + Prefix Rollout

### 인벤토리(스캔 → 표 작성)
- [ ] 조사 범위 확정: `packages/*/src`, `apps/*/src` (테스트 포함 여부 결정)
- [ ] “중복 선언 후보” 수집 루틴 확정(패턴 기반)
- [ ] 인벤토리 표를 실제 행으로 채우기(Owner/소비 위치/문제 유형/배치/수정 요약)

### 배치 실행(Owner로 수렴)
- [ ] Batch A: UI/contexts/hooks의 로컬 문자열 유니온 제거(Owner 타입 import로 수렴)
- [ ] Batch B: Message/Conversation 계약 단일화(Owner 타입으로 수렴)
- [ ] Batch C: Tool contract 단일화(Owner 타입으로 수렴)
- [ ] Batch D: Workflow graph 계약 단일화(Owner 타입 import로 수렴)
- [ ] Batch E: Event axis 계약 단일화(agents 소유, 비-owner 중복 타입 제거/비공개화)

### Prefix Phase 3(잔여 export 타입/인터페이스 정리)
- [x] `packages/playground/src/lib/playground/block-tracking/types.ts`의 타입/인터페이스를 `I*/T*`로 수렴
- [x] `packages/playground/src/lib/playground/block-tracking/block-hooks.ts`: `ToolHooks` → `IToolHooks`
- [x] `packages/playground/src/lib/playground/robota-executor.ts`: `Base*` 접두어 제거(SSOT import로 수렴), `Playground*` 타입/인터페이스 `I*/T*` 전환(공개 계약만)
- [x] Batch A(잔여 type import 정리): `WorkflowEventSubscriber` type import를 `IWorkflowEventSubscriber`로 수렴
- [x] agents/remote/workflow 잔여 export 정리(스캔 기반으로 소규모 배치)
- [x] 변경 패키지별 build PASS(필수)

### Naming Hygiene(점진 적용)
- [x] `T*Type`, `I*Interface` 같은 중복 접미어를 점진적으로 제거(현행 코드 기준 잔여 0개 확인)
- [x] `Interface` / `Type` 키워드가 **접미어뿐 아니라 식별자 중간에 포함된 케이스까지** 포함하여 정리 범위를 확장(현행 코드 기준 잔여 0개 확인)
- [x] (가드) SSOT 통합 작업 진행 중에는 `Interface` / `Type` 키워드가 들어간 신규 타입/인터페이스/클래스명을 **추가로 만들지 않는다**(리뷰 규칙으로 유지)
- [x] `TypeSafe` 키워드 사용 금지 및 잔여 정리(현행 코드 기준 잔여 0개 확인)

---

## 📚 Auto-generated docs policy

- [x] `docs/api-reference/**` 자동 생성 헤더에 “생성 커맨드”를 명시하도록 생성 파이프라인 수정

---

## 🧱 Alias Anti-Pattern 정리(SSOT 강화)

- [x] 의미 없는 alias(`type A = B`) 제거 배치 1(낮은 churn)
- [x] 동일 shape 재선언 제거 배치 2(예: `ToolCallData` 등)
- [x] services/managers/plugins의 contract re-export/경유 import 오염 제거 배치 3

---

## 🧪 Scenario/Recorder 확장(필요 시)

### 절대 규칙(Framework 우선, Scenario는 레이어)
- Scenario/Recorder는 **정식 SDK 기능**으로 제공되어야 하며, `@robota-sdk/workflow`에서 제공한다.
- `apps/examples`는 시나리오 기능을 “구현”하는 곳이 아니라, **라이브러리 기능을 호출/검증**하는 예제 모음이다.

### 코어 수정 게이트(불가피할 때만, 사전 검증 필수)
> 코어를 건드리는 변경은 “가능해서”가 아니라 “SSOT/Ownership 관점에서 타당해서”만 허용된다.

- [ ] (사전) 이 변경이 **Scenario 기능을 위해서만** 필요한가?
  - YES면 변경 금지 → `packages/workflow`의 범용 기능으로 재설계(Scenario 전용 키워드/정책/형태 주입 금지)
  - NO(범용 프레임워크 기능 개선)라면 아래로 진행
- [ ] (SSOT) 변경되는 계약/타입/이벤트의 **Owner가 코어 패키지에 있는 게 타당한가?**
  - 중복 선언/의미 없는 alias/서비스 경유 re-export(Option A 위반) 금지
- [ ] (Ownership) 이벤트/타입/로직이 **scenario 도메인에 종속되지 않는가?**
  - 시나리오 전용 필드/키워드/정규식/추정 로직 추가 금지
- [ ] (No-Fallback/Path-Only) 코어 변경이 규칙 위반을 유발하지 않는가?
  - 누락 linkage 추정/지연 연결/대체 경로/중복 억제(dedup) 금지
- [ ] (검증) 코어 변경이 있다면 패키지별 build 규칙을 따른다:
  - `pnpm --filter @robota-sdk/* build` (필요한 범위)

#### ✅ 이번 작업에서 발생한 코어 변경(사유/범위 기록)
- [x] `packages/workflow`: Path-Only/검증 규칙을 만족시키기 위한 연결 로직 보정
  - `ToolEventHandler`: delegated response가 없는 “local tool(시나리오 재생)”에서도 `tool_response`를 생성할 수 있게 parent 선택을 `tool_call`로 허용
  - `AgentEventHandler`: `agent.created` 등 이벤트에서 `sourceId`에 의존하지 않고 `context.ownerPath` 기반으로 agentId를 확정하도록 보정
- [x] `packages/agents`: tool 실행 결과가 실패/성공 모두에서 `executionId(toolCallId)` 매핑이 끊기지 않도록 보정
  - `ToolExecutionService.executeTools()`: 실패 결과도 `results[]`에 포함(ExecutionService가 toolCall 순서대로 tool message를 추가할 수 있게)
  - `ExecutionService`: 실패 result를 tool message로 반영(결정론 유지)

### 목표
- Scenario 저장/재생(Record/Play)을 **현재 코드/룰 기준으로 “완성 상태”**로 만든다.
- **Owner-based SSOT**를 유지한다: 시나리오 도메인 타입/포맷은 1곳에서만 정의하고 drift를 허용하지 않는다.
- **No-Fallback / Path-Only / Event-constants** 규칙을 깨지 않도록 “기록/재생의 책임 경계”를 명확히 고정한다.
  - 시나리오는 **LLM Provider I/O만** 고정(기록/재생)하고, EventService/Workflow 그래프는 **자연 발생 이벤트 흐름**을 그대로 타게 둔다.

### 설계 원칙(불변)
- **모드 결정은 단일 경로**: `record | play | none`은 env로 결정하고, 애매하면 즉시 실패
  - 금지: record/play 동시 설정, play 모드에서 delegate provider 주입(실제 호출 위험)
- **Determinism(재현성) 우선**
  - 기본 전략: `sequential`
  - `hash` 전략은 보조이며 “모호성(동일 hash 다중 매치)” 발생 시 즉시 실패(대체 경로로 넘어가지 않음)
- **SSOT 타입**
  - 시나리오 파일 포맷은 “JSON 안정형”으로 정의하고, 런타임 타입(`TUniversalMessage`)과 분리(예: `timestamp: number`)
  - (비범위) `unknown/any` 정리는 Priority 0.6 배치에서 처리. Scenario 작업의 핵심 완성 조건에는 포함하지 않는다.

### 작업 순서(구체)
#### 0) 현황 고정(인벤토리)
- [ ] 현재 구현 인벤토리/역할표 최신화
  - `apps/examples/lib/scenario/provider.ts`: env 기반 provider (Record/Play/Guard)
  - `apps/examples/lib/scenario/store.ts`: store + hash + lock + assertions
  - `apps/examples/lib/scenario/serialize.ts`: snapshot serialize/hydrate
  - `apps/examples/lib/scenario/types.ts`: scenario record format (SSOT)
  - `apps/examples/utils/run-scenario.ts`: CLI(env 세팅 + tsx 실행)
  - `apps/examples/utils/verify-scenario.ts`: guarded 실행 + verify 연결

#### 1) SSOT/Ownership 정리(“시나리오 도메인” 분리)
- [ ] 시나리오 도메인 폴더로 책임 분리(기능 변화 최소)
  - [x] `apps/examples/lib/scenario/types.ts` (SSOT: record/step/request/response/strategy/version)
  - [x] `apps/examples/lib/scenario/serialize.ts` (messages/options/response snapshot serialize + hydrate)
  - [x] `apps/examples/lib/scenario/store.ts` (load/append/lock/list/find)
  - [x] `apps/examples/lib/scenario/provider.ts` (recording provider / playback provider / fromEnv)
- [x] 기존 파일에서 re-export/경유 타입이 생기지 않도록 import 경로 정리(Option A 준수: public surface는 필요 시만)
- [x] Scenario 레이어에서 barrel export(`index.ts` 등) 제거/미사용 확인(모든 소비자는 owner 모듈 직접 import)

#### 2) 기록(Record) 완성 조건
- [x] record 모드에서 아래를 “반드시 기록”하도록 표준화
  - `chat`: message snapshot
  - `chatStream`: chunk snapshot 배열 + timestamp/index
  - `generateResponse`: raw snapshot
- [x] step 생성 시 단일 SSOT 규칙으로 ID/hash 생성
  - `requestHash = hash(messages + options)` (stable stringify)
  - `stepId` 생성 규칙 고정
- [x] 저장소 락 정책 고정
  - 동시 record 충돌 시 즉시 실패(락 파일 삭제는 수동)

#### 2.5) Tool 경계 record/play 고정(필수: tool calling 재현성)
> “Provider만 재생”으로는 tool 결과가 달라져 다음 라운드 입력이 변하고 record→play가 깨진다.  
> 따라서 play 모드에서는 **tool 결과도 scenario 기록과 동일하게 재생**되어야 한다.

- [ ] (설계) tool record/play는 `@robota-sdk/workflow`가 제공하는 기능으로 구현한다.
- [x] (SSOT) 시나리오 포맷에 `tool.result` step kind를 추가한다(또는 동등한 구조로 “tool I/O”를 기록)
  - 최소 필드(트리거/매칭 키):
    - `toolName` (예: `assignTask`)
    - `toolArguments` (원문 string; JSON parse에 의존하지 않음)
    - `toolCallId` (가능하면 기록. 단, 관계 추정/파싱 금지. 명시적 링크에만 사용)
  - 결과 필드:
    - tool message로 들어갈 `content`(string)와 필요한 metadata(JSON 안정형)
- [x] (Record) tool wrapper가 실제 tool 실행 결과를 `tool.result` step으로 append 한다.
  - 구현 위치(예정):
    - `packages/workflow/src/scenario/tool.ts` (`createScenarioToolWrapper`)
    - 저장은 `packages/workflow/src/scenario/store.ts` (`appendToolResultStep`)
- [x] (Play) play 모드에서 tool 실행을 금지하고, 기록된 tool 결과를 반환한다(실제 tool 실행 금지).
  - 전략:
    - `toolCallId` 기반 조회(명시적 필드): `tool.result` step의 `toolCallId`로 content를 찾는다.
    - 동일 `toolCallId` 다중 기록은 content가 모두 동일할 때만 허용(다르면 ambiguous fail-fast).
  - 구현 위치:
    - `packages/workflow/src/scenario/store.ts` → `ScenarioStore.findToolResultByToolCallIdForPlay()` / `findToolMessageContentByToolCallIdForPlay()`
- [x] (Wiring) 예제에서 record/play 모드에 따라 tools를 교체 주입한다.
  - 예: `createScenarioProviderFromEnv()` 결과의 mode에 따라
    - record/play: `createScenarioToolWrapper(tool, { mode, scenarioId, store })`로 감싼 tool 목록 사용
  - 구현 위치: `02-tool-calling.ts`, `13-guarded-edge-verification.ts`, `15-continued-conversation-edge-verification.ts`

#### 3) 재생(Play) 완성 조건
- [x] play 모드에서 delegate provider 주입을 즉시 차단(실제 호출 금지 가드)
- [x] `sequential` 전략: 포인터 기반 재생
  - [x] (필수) 매 호출마다 “recorded request snapshot hash === current request hash” 검증
  - [x] 불일치 시 즉시 실패(조용히 다음 step 소비 금지)
  - [x] 구현 위치:
    - `packages/workflow/src/scenario/provider.ts` → `ScenarioMockAIProvider.resolveStep()`의 `sequential` 분기
- [x] `hash` 전략: 요청 hash로 step 탐색
  - [x] 0개 매치: 즉시 실패
  - [x] 2개 이상 매치: 즉시 실패(ambiguous). “sequential 사용” 안내 문구
- [x] (필수) `hash` 전략은 “첫 매치 반환” 금지: 0/1/2+ 매치를 반드시 구분(ambiguous 노출)
  - [x] 구현 위치:
    - `packages/workflow/src/scenario/store.ts` → `ScenarioStore.findProviderStepByHashForPlay()` (ambiguous throw)
    - `packages/workflow/src/scenario/provider.ts` → `ScenarioMockAIProvider.resolveStep()`의 `hash` 분기
- [x] (권장) play 모드에서 시나리오 파일이 없으면 즉시 실패(ENOENT → fail-fast)
  - [x] 구현 위치:
    - `packages/workflow/src/scenario/store.ts` → `ScenarioStore.loadForPlay()` (ENOENT throw)
- [x] 종료 시 `assertNoUnusedSteps()`로 미사용 step 검증(미사용 존재 시 실패)
  - provider step + tool_result step 모두 포함

> 참고: 동일 턴에서 tool call이 여러 개라 병렬 실행이 발생하는 시나리오는 `sequential`이 결정론적으로 유지되기 어렵다.  
> 이런 케이스(예: mandatory-delegation)는 `hash` 전략을 기본으로 사용한다.

#### 4) CLI/문서/운영 정리(스크립트 과증식 금지)
- [ ] “단일 진입점”은 CLI 스크립트 수준에서 유지(새로운 과한 스모크 스크립트는 추가하지 않음)
- [ ] `apps/examples/INDEX.md`에 실행법/가드 조건을 SSOT로 유지(예제 파일명 변경 시 함께 갱신)
  - record/play/verify 예시(13/15 guarded 포함)
  - env 목록: `SCENARIO_RECORD_ID`, `SCENARIO_PLAY_ID`, `SCENARIO_PLAY_STRATEGY`, `SCENARIO_BASE_DIR`

#### 5) 검증(필수)
- [x] `pnpm -C apps/examples check-types` PASS
- [ ] (로컬) guarded 시나리오 2개 재생/검증 실행:
  - `pnpm -C apps/examples scenario:play -- 13-guarded-edge-verification.ts mandatory-delegation --strategy=sequential`
  - `pnpm -C apps/examples scenario:verify -- 15-continued-conversation-edge-verification.ts continued-conversation --strategy=sequential`


