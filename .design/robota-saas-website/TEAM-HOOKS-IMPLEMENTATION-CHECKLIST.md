# 동적 트래킹 구현 체크리스트 (기존 시스템 활용)

## 🎯 목표: 기존 블록 시스템 확장을 통한 동적 트래킹

완전히 새로운 시스템을 만들지 않고, **기존 PlaygroundBlockCollector를 확장**하여 동적 트래킹 기능을 추가하는 방식으로 구현합니다.

## 📋 상세 구현 계획

👉 **자세한 구현 방법은 [SIMPLIFIED-TRACKING-IMPLEMENTATION-PLAN.md](./SIMPLIFIED-TRACKING-IMPLEMENTATION-PLAN.md)를 참고하세요.**

## 📖 참고 자료

### 구현 목표 노드 구조
자세한 중간 과정 노드 구조 예시는 **[SIMPLIFIED-TEAM-EVENTS-PLAN.md](./SIMPLIFIED-TEAM-EVENTS-PLAN.md)**의 "목표 구조 예시" 섹션을 참고하세요:

- **⏰ 시작 시점 (0초)**: 초기 Team 노드 생성
- **⏰ 작업 계획 수립 (2초)**: assignTask 노드들 생성 및 실행 계획 표시
- **⏰ 단계적 진행 (3초)**: 첫 번째 assignTask 실행 단계별 진행
- **⏰ 병렬 실행 (6초)**: 두 assignTask 동시 진행 상태
- **⏰ 하위 도구 실행 (10초)**: Agent 내부 도구 사용 세부 추적
- **⏰ 부분 완료 (15초)**: 첫 번째 assignTask 완료, 두 번째 진행 중
- **⏰ 최종 처리 (18초)**: 모든 assignTask 완료, Team 응답 생성
- **✅ 최종 완료 (20초)**: 전체 실행 완료 상태

### 다양한 Tool 타입별 트래킹 구조
**[TOOL-TRACKING-EXAMPLES.md](./TOOL-TRACKING-EXAMPLES.md)**에서 다음 Tool 타입들의 구체적인 트래킹 예시를 확인하세요:

- **단순 Tool**: calculator, dateTime (즉시 실행 완료)
- **API Tool**: webSearch, github-mcp (4단계 진행)
- **파일 Tool**: fileSearch, codeAnalysis (파일 처리 단계)
- **검증 Tool**: zodValidator (스키마 기반 검증)
- **복합 사용**: 여러 Tool 순차 실행 시나리오

이 구조들을 참고하여 각 단계별 노드 상태 변화를 정확히 구현하세요.

## 📋 Phase 1: 기존 블록 시스템 확장 (1주)

### 1.1 BlockMetadata 타입 확장
- [ ] `apps/web/src/lib/playground/block-tracking/types.ts` 확장
  - [ ] EnhancedBlockMetadata 인터페이스 추가
  - [ ] executionPlan 필드 (Tool 시작 시 생성되는 실행 계획)
  - [ ] progress 필드 (현재 진행 상황: currentStep, totalSteps, percentage)
  - [ ] toolDetails 필드 (Tool 타입, 예상 소요시간, 하위 블록 IDs)

- [ ] ExecutionStep 인터페이스 정의
  - [ ] 단계별 상태 관리 (id, name, status, description)
  - [ ] 예상/실제 소요 시간 추적 (estimatedDuration, startTime, endTime)
  - [ ] 단계별 진행 상태 ('pending' | 'in_progress' | 'completed' | 'error')

### 1.2 ToolExecutionPlanner 클래스 생성
- [ ] `apps/web/src/lib/playground/execution-planning/tool-planner.ts` 생성
- [ ] Tool 타입별 실행 계획 생성 로직 구현
  - [ ] Single-step tools: calculator, dateTime (1단계 즉시 완료)
  - [ ] Multi-step API tools: webSearch, github-mcp (4단계 진행)
  - [ ] File processing tools: fileSearch, codeAnalysis (파일 처리 단계)
- [ ] createExecutionPlan() 정적 메서드 구현
- [ ] Tool 이름 기반 자동 패턴 매칭

### 1.3 Enhanced BlockTrackingHooks 구현
- [ ] `apps/web/src/lib/playground/block-tracking/enhanced-block-hooks.ts` 생성
- [ ] 기존 createBlockTrackingHooks 확장
- [ ] beforeExecute: Tool 시작 시 실행 계획 생성 및 단계 블록 미리 생성
- [ ] afterExecute: Tool 완료 시 LLM 응답 블록 자동 생성
- [ ] 기존 ToolHooks 인터페이스 호환성 유지

## 📋 Phase 2: 동적 단계 업데이트 시스템 (1주)

### 2.1 StepProgressTracker 구현
- [ ] `apps/web/src/lib/playground/progress-tracking/step-tracker.ts` 생성
- [ ] 실행 중인 Tool의 단계별 진행 상황을 실시간 추적
- [ ] onStepProgress(): Tool 단계 진행 시 해당 단계 블록 상태 업데이트
- [ ] updateToolProgress(): 전체 Tool 진행률 계산 및 업데이트
- [ ] calculateStepDuration(): 각 단계별 실제 소요 시간 계산

### 2.2 실시간 진행률 계산
- [ ] `apps/web/src/lib/playground/progress-tracking/progress-calculator.ts` 생성
- [ ] calculateToolProgress(): 완료된 단계 기반 퍼센티지 계산
- [ ] getCurrentStepInfo(): 현재 진행 중인 단계 정보 반환
- [ ] estimateRemainingTime(): 남은 예상 시간 계산
- [ ] updateProgressMetadata(): BlockMetadata의 progress 필드 업데이트

### 2.3 LLM 응답 블록 자동 생성
- [ ] `apps/web/src/lib/playground/llm-response/response-handler.ts` 생성
- [ ] createLLMResponseBlock(): Tool 완료 후 LLM 응답 블록 생성
- [ ] onLLMResponseComplete(): LLM 응답 완료 시 블록 업데이트
- [ ] linkToolResultToLLM(): Tool 결과와 LLM 입력 데이터 연결

## 📋 Phase 3: UI 컴포넌트 업데이트 (3일)

### 3.1 Enhanced Block Components
- [ ] `apps/web/src/components/playground/` 기존 블록 컴포넌트 확장
- [ ] EnhancedToolBlock: 진행률 표시 UI 추가
- [ ] ProgressBar: 퍼센티지와 현재/전체 단계 표시
- [ ] ExecutionSteps: 실행 계획 단계별 시각적 표현
- [ ] LLMResponseBlock: LLM 응답 전용 블록 UI

### 3.2 실시간 업데이트 연동
- [ ] 기존 BlockCollector listener 시스템 활용
- [ ] 블록 상태 변경 시 자동 UI 업데이트
- [ ] 진행률 변경 시 부드러운 애니메이션 효과
- [ ] 실시간 타이밍 표시 (경과 시간, 예상 완료 시간)

### 3.3 사용자 경험 개선
- [ ] 확장/축소 가능한 실행 단계 표시
- [ ] Tool 타입별 아이콘 및 색상 구분
- [ ] 로딩 상태 애니메이션
- [ ] 완료/오류 상태 시각적 피드백

## 🚀 MVP 구현 우선순위 (3주 완성)

### Week 1: 기본 확장 ⭐
1. **BlockMetadata 확장**: 실행 계획, 진행률 필드 추가
2. **ToolExecutionPlanner**: 3가지 Tool 타입 (single, api, mcp) 실행 계획 생성  
3. **Enhanced Hooks**: 기존 ToolHooks에 실행 계획 생성 로직 추가

### Week 2: 동적 업데이트 ⭐
1. **StepProgressTracker**: 실시간 단계 진행 추적
2. **LLM Response Handler**: Tool 완료 후 LLM 블록 자동 생성
3. **Progress Calculation**: 진행률 계산 및 블록 업데이트

### Week 3: UI 완성 ⭐
1. **Enhanced Block Components**: 진행률 표시 UI
2. **Real-time Updates**: 기존 listener 시스템 활용한 실시간 업데이트
3. **Testing & Polish**: 전체 시스템 테스트 및 UX 개선

## ✅ 이 접근법의 장점

### 1. 기존 시스템 재활용 🔄
- **90% 기존 코드 유지**: 새로 만들지 않고 확장만
- **검증된 아키텍처**: 이미 작동하는 블록 시스템 기반
- **React 연동 완료**: UI 컴포넌트들이 이미 연동되어 있음

### 2. 점진적 개발 가능 📈
- **단계별 검증**: 각 Week마다 즉시 테스트 가능
- **롤백 가능**: 문제 발생 시 이전 단계로 쉽게 복원
- **병렬 개발**: UI와 백엔드 로직을 독립적으로 개발

### 3. Robota SDK 모범 사례 🏆
- **ToolHooks 활용**: SDK의 표준 훅 시스템 사용
- **플러그인 패턴**: 기존 플러그인 아키텍처와 호환
- **최소 침입**: 기존 Agent/Tool 코드 수정 없음

### 4. 개발자 친화적 👥
- **학습 곡선 최소**: 기존 블록 시스템 개념 재사용
- **디버깅 용이**: 블록 단위로 각 단계 추적 가능
- **확장성**: 새로운 Tool 타입 쉽게 추가 가능
## 🚀 구현 시작점

**즉시 시작 가능한 첫 번째 작업**:
1. `apps/web/src/lib/playground/block-tracking/types.ts`에 확장 타입 추가
2. `ToolExecutionPlanner` 클래스 생성
3. `createEnhancedBlockTrackingHooks` 함수 구현

이 방식으로 **기존 playground의 복잡성을 그대로 활용하면서도, 새로운 동적 트래킹 기능을 단계적으로 추가**할 수 있습니다!
 