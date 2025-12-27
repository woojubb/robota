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

- [ ] Scenario 저장소/CLI/옵션 wiring을 “단일 진입점”으로 정리
- [ ] record/play 옵션 상호 배타 검증 및 실행 가드 문서화


