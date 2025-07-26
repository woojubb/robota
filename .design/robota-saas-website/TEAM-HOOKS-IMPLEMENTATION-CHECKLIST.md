# SDK 향상 기반 실행 추적 시스템 구현 계획

## 🎯 새로운 접근법: SDK 핵심 향상 + Web App 연동

**기존 시스템을 약간 향상시켜 훨씬 더 명확하고 강력한 추적 시스템 구현**
- ✅ **0% Breaking Change**: 기존 코드 100% 호환
- ✅ **최소 수정**: 새 파일 추가 + 선택적 필드만 추가
- ✅ **실제 데이터만**: 가짜 시뮬레이션 없이 정확한 실행 추적

## 📖 참고 문서

### 🎯 구현 목표 구조
**[SIMPLIFIED-TEAM-EVENTS-PLAN.md](./SIMPLIFIED-TEAM-EVENTS-PLAN.md)**의 "목표 구조 예시"를 달성합니다:
- 계층적 실행 트리 (Team → Agent → Tool)
- 실제 시작/완료 시간 추적
- 부모-자식 관계 자동 관리

### 🔧 Tool별 추적 예시  
**[TOOL-TRACKING-EXAMPLES.md](./TOOL-TRACKING-EXAMPLES.md)**에서 실제 데이터 기반 추적:
- webSearch, calculator, github-mcp 등
- LLM 응답 생성 포함 전체 플로우
- 실제 소요 시간과 결과만 표시

### 📋 상세 구현 방법
**[SIMPLIFIED-TRACKING-IMPLEMENTATION-PLAN.md](./SIMPLIFIED-TRACKING-IMPLEMENTATION-PLAN.md)**에서 기술적 세부사항 확인

---

## 🏗️ **Phase 1: SDK 핵심 향상 (1주) - 비침습적 확장**

### 1.1 ToolExecutionContext 확장 (0% Breaking Change)
- [ ] **파일**: `packages/agents/src/interfaces/tool.ts`
- [ ] 기존 ToolExecutionContext 인터페이스에 새 필드만 추가:
  ```typescript
  interface ToolExecutionContext {
    // 모든 기존 필드 그대로 유지...
    
    // 새 필드들 (모두 선택적)
    parentExecutionId?: string;    // 부모 실행 ID
    rootExecutionId?: string;      // 최상위 실행 ID  
    executionLevel?: number;       // 실행 깊이 (0: Team, 1: Agent, 2: Tool)
    executionPath?: string[];      // 실행 경로
  }
  ```
- [ ] **영향**: 기존 14개 파일이 수정 없이 그대로 작동

### 1.2 EventEmitterPlugin 향상 (0% Breaking Change)
- [ ] **파일**: `packages/agents/src/plugins/event-emitter-plugin.ts`
- [ ] 기존 EventType에 새 이벤트만 추가:
  ```typescript
  type EventType = 
    | 'execution.start'        // 기존 그대로
    | 'tool.beforeExecute'     // 기존 그대로
    | 'tool.afterExecute'      // 기존 그대로
    // ... 모든 기존 이벤트 그대로
    | 'execution.progress'     // 새 이벤트
    | 'tool.progress'          // 새 이벤트
    | 'execution.hierarchy'    // 새 이벤트
  ```
- [ ] 계층적 실행 컨텍스트 자동 관리 로직 추가
- [ ] **영향**: 기존 이벤트 구독자들에게 영향 없음

### 1.3 ExecutionTrackingPlugin 생성 (새 파일)
- [ ] **파일**: `packages/agents/src/plugins/execution-tracking-plugin.ts` (새로 생성)
- [ ] EventEmitterPlugin과 연동하여 실행 트리 구성
- [ ] 외부에서 구독 가능한 실행 트리 관리
- [ ] 표준 BasePlugin 패턴 사용
- [ ] **영향**: 완전히 새로운 독립 플러그인

### 1.4 ProgressReportingTool 인터페이스 (새 파일)
- [ ] **파일**: `packages/agents/src/interfaces/progress-reporting.ts` (새로 생성)
- [ ] 기존 ToolInterface를 확장하는 선택적 인터페이스:
  ```typescript
  interface ProgressReportingTool extends ToolInterface {
    getEstimatedDuration?(parameters: ToolParameters): number;
    getExecutionSteps?(parameters: ToolParameters): ToolExecutionStep[];
    setProgressCallback?(callback: (step: string, progress: number) => void): void;
  }
  ```
- [ ] **영향**: 기존 Tool들은 수정 없이 작동, 원하는 Tool만 선택적 구현

---

## 🌐 **Phase 2: Web App 연동 시스템 (1주) - 기존 시스템 활용**

### 2.1 SDK 구독 계층 구현
- [ ] **파일**: `apps/web/src/lib/playground/execution-subscriber.ts` (새로 생성)
- [ ] SDK의 ExecutionTrackingPlugin 구독
- [ ] 실행 트리를 BlockMessage 형식으로 변환
- [ ] 실제 데이터만 전달 (시뮬레이션 없음)

### 2.2 RealTimeBlockMetadata 확장
- [ ] **파일**: `apps/web/src/lib/playground/block-tracking/types.ts`
- [ ] 기존 BlockMetadata 확장:
  ```typescript
  interface RealTimeBlockMetadata extends BlockMetadata {
    startTime?: Date;           // 실제 시작 시간
    endTime?: Date;             // 실제 완료 시간
    actualDuration?: number;    // 실제 소요 시간 (ms)
    toolParameters?: any;       // 실제 입력 파라미터
    toolResult?: any;           // 실제 출력 결과
    executionHierarchy?: {      // 계층적 정보
      parentId?: string;
      level: number;
      path: string[];
    };
  }
  ```

### 2.3 Enhanced Hooks 구현
- [ ] **파일**: `apps/web/src/lib/playground/block-tracking/real-time-hooks.ts` (새로 생성)
- [ ] createRealTimeTrackingHooks() 함수
- [ ] beforeExecute: 실제 시작 시점만 기록
- [ ] afterExecute: 실제 완료 정보 + LLM 응답 블록 자동 생성
- [ ] 기존 ToolHooks 인터페이스 완전 호환

### 2.4 LLM 응답 추적 시스템
- [ ] **파일**: `apps/web/src/lib/playground/llm-tracking/llm-tracker.ts` (새로 생성)  
- [ ] Agent History에서 실제 LLM 응답 감지
- [ ] Tool 완료 즉시 LLM 블록 생성 (in_progress)
- [ ] 실제 응답 완료 시 블록 업데이트

---

## 🎨 **Phase 3: UI 컴포넌트 향상 (1주) - 실제 데이터 표시**

### 3.1 실제 데이터 표시 컴포넌트
- [ ] **파일**: `apps/web/src/components/playground/real-time-tool-block.tsx` (새로 생성)
- [ ] 실제 실행 시간과 상태만 표시:
  ```typescript
  // 표시 내용
  - 실제 시작/완료 시간
  - 실제 소요 시간 (측정값)
  - 실제 입력/출력 데이터
  - 계층적 위치 (level, path)
  ```
- [ ] 진행률이나 예상 시간은 표시하지 않음

### 3.2 기존 UI 시스템 확장
- [ ] 기존 PlaygroundBlockCollector와 연동
- [ ] 기존 listener 시스템 활용
- [ ] 기존 블록 컴포넌트들과 호환성 유지

### 3.3 실시간 업데이트 연동
- [ ] 실제 Tool 상태 변경 시 즉시 UI 업데이트
- [ ] LLM 응답 생성/완료 시 실시간 반영
- [ ] 계층적 트리 구조 시각화

---

## 📋 **Phase 4: RobotaExecutor 통합 (3일) - 통합 테스트**

### 4.1 기존 시스템과 통합
- [ ] **파일**: `apps/web/src/lib/playground/robota-executor.ts` 수정
- [ ] 기존 createTeam() 메서드에 새 hooks 적용
- [ ] 기존 API 호환성 100% 유지
- [ ] ExecutionTrackingPlugin 선택적 활성화

### 4.2 Team Package 연동
- [ ] **파일**: `packages/team/src/create-team.ts` 확인
- [ ] 기존 toolHooks 시스템과 새 hooks 호환성 확인
- [ ] AssignTask Tool에서 계층적 컨텍스트 전달

### 4.3 전체 시스템 테스트
- [ ] 기존 기능 회귀 테스트 (100% 호환 확인)
- [ ] 새 추적 기능 통합 테스트
- [ ] 성능 영향 측정 및 최적화

---

## 🚀 **주차별 구현 우선순위**

### **Week 1: SDK 핵심 향상** 🔧
**목표**: Breaking Change 없이 SDK 추적 기능 확장
1. ToolExecutionContext 확장 (새 필드 추가)
2. EventEmitterPlugin 향상 (새 이벤트 추가)
3. ExecutionTrackingPlugin 생성 (새 플러그인)
4. **검증**: 기존 코드가 수정 없이 작동하는지 확인

### **Week 2: Web App 연동** 🌐
**목표**: SDK의 새 기능을 Web App에서 활용
1. Execution Subscriber 구현 (SDK → Web App 브리지)
2. RealTimeBlockMetadata 확장 (실제 데이터 추가)
3. Real-time Hooks 구현 (실제 데이터만 추적)
4. **검증**: 실제 데이터가 정확히 전달되는지 확인

### **Week 3: UI 완성** 🎨
**목표**: 사용자에게 실제 추적 정보 표시
1. Real-time Tool Block 컴포넌트 (실제 시간/결과 표시)
2. 기존 UI 시스템과 통합 (호환성 유지)
3. 전체 시스템 테스트 및 최적화
4. **검증**: 전체 플로우가 완벽히 작동하는지 확인

---

## ✨ **핵심 장점**

### 1. **완전 비침습적** 🛡️
- 기존 코드 100% 호환
- 새 기능은 선택적 활용
- 점진적 도입 가능

### 2. **실제 데이터만** 📊
- 가짜 시뮬레이션 없음
- 정확한 실행 시간 측정
- 진짜 입력/출력 데이터

### 3. **SDK 철학 준수** 🏆
- Avoid Ambiguous Features
- Plugin System Guidelines  
- Code Organization 원칙
- Logging Guidelines 준수

### 4. **확장성** 🚀
- 새로운 Tool 타입 쉽게 추가
- 다른 프로젝트에서 재사용 가능
- Robota SDK 모범 사례

---

## 🎯 **즉시 시작 가능한 첫 작업**

### **Day 1 작업**:
1. `packages/agents/src/interfaces/tool.ts` - ToolExecutionContext 확장
2. `packages/agents/src/plugins/execution-tracking-plugin.ts` - 새 플러그인 생성  
3. 기존 코드 호환성 테스트

### **성공 지표**:
- 기존 모든 테스트가 통과
- 새 플러그인이 이벤트를 정상 수신
- Web App에서 계층적 실행 정보 확인

이 접근법으로 **오버엔지니어링 없이** SDK의 **핵심을 약간만 향상**시켜서 **훨씬 더 강력한 추적 시스템**을 만들 수 있습니다! 🎉
 