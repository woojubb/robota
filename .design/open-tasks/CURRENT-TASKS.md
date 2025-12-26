# 현재 작업 목록 (최신 / [ ]만 유지)

> 이 문서는 **남은 작업([ ])만** 관리합니다.  
> 완료된 항목과 “어떻게 업그레이드/마이그레이션 했는지” 기록은 유지하지 않습니다.

---

## 🚨 Priority 0: EventService / ownerPath-only 규칙 마감

- [ ] `buildOwnerContext(ownerType, ownerId, extraSegments?)` 헬퍼 도입 필요성 재평가(필요 시에만 도입)
- [ ] `BaseEventData` + 파생 타입(Execution/Tool/Agent)을 정의하여 필드를 역할별로 분리(스펙/타입 정리)
- [ ] ExecutionService payload 최소화 잔여 정리(`execution.start`, `execution.user_message`, `execution.assistant_message_*`)
- [ ] Tool/Agent emit 단계: payload는 도메인 데이터만 유지하고 계층 정보는 context(ownerPath)로만 전달되도록 정리
- [ ] Context ownerPath-only 규칙 문서/타입 게이트 확정(파생 가능한 계층 필드는 payload에 두지 않기)
- [ ] EventService owner-bound 인스턴스 사용 범위 마감
  - [ ] `ToolExecutionService`/team tool collection 등 남은 주입 지점에서 “owner-bound + 자동 source/timestamp” 규칙으로 수렴
  - [ ] `sourceType/sourceId` 수동 전달이 남아있다면 제거(단, 이벤트 처리에 필요한 도메인 데이터는 payload로 유지)
- [ ] 정규화 영향 평가: ownerPath-only/payload 최소화 이후에도 노드/엣지 생성 결과가 동일 규칙으로 유지되는지 검증 기준 확정

---

## 🧪 Priority 0.5: Web 호스트 빌드 게이트

- [ ] 사용자 환경에서 `pnpm --filter robota-web build` 실행 및 통과 확인

---

## 🧭 Priority 0.6: CI / typecheck / lint 운영(0으로 만들기)

- [ ] 1차 배치: 테스트 `no-undef`/`no-console`/이벤트명 문자열 리터럴 위반 묶음 감소
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
- [ ] `packages/playground/src/lib/playground/block-tracking/types.ts`의 타입/인터페이스를 `I*/T*`로 수렴
- [ ] `packages/playground/src/lib/playground/block-tracking/block-hooks.ts`: `ToolHooks` → `IToolHooks`
- [ ] `packages/playground/src/lib/playground/robota-executor.ts`: `Base*` 접두어 제거(SSOT import로 수렴), `Playground*` 타입/인터페이스 `I*/T*` 전환(공개 계약만)
- [ ] agents/remote/workflow 잔여 export 정리(스캔 기반으로 소규모 배치)
- [ ] 변경 패키지별 build PASS(필수)

### Naming Hygiene(점진 적용)
- [ ] `T*Type`, `I*Interface` 같은 중복 접미어를 점진적으로 제거(손대는 파일부터)
- [ ] `TypeSafe` 키워드 사용 금지 및 잔여 정리(손대는 파일부터)

---

## 📚 Auto-generated docs policy

- [ ] `docs/api-reference/**` 자동 생성 헤더에 “생성 커맨드”를 명시하도록 생성 파이프라인 수정

---

## 🧱 Alias Anti-Pattern 정리(SSOT 강화)

- [ ] 의미 없는 alias(`type A = B`) 제거 배치 1(낮은 churn)
- [ ] 동일 shape 재선언 제거 배치 2(예: `ToolCallData` 등)
- [ ] services/managers/plugins의 contract re-export/경유 import 오염 제거 배치 3

---

## 🧪 Scenario/Recorder 확장(필요 시)

- [ ] Scenario 저장소/CLI/옵션 wiring을 “단일 진입점”으로 정리
- [ ] record/play 옵션 상호 배타 검증 및 실행 가드 문서화


