# 📊 System Status 구현 계획

## 🎯 **목표 및 범위**

**목표**: Playground의 System Status를 Robota SDK 아키텍처 원칙에 맞게 구현
**범위**: 실행 통계, 상태 관리, 플러그인 기반 확장성
**아키텍처 준수**: Facade Pattern, Dependency Injection, Single Responsibility

---

## 🏗️ **아키텍처 분석 결과**

### **현재 Playground 아키텍처 특징**
- **Facade Pattern**: `PlaygroundExecutor`를 통한 단순화된 인터페이스
- **Dependency Injection**: Context → Hook → Component 계층적 의존성 주입
- **Single Responsibility**: 각 컴포넌트의 명확한 역할 분리
- **Plugin System**: Universal Hook System으로 확장 가능한 구조
- **Real-time Updates**: Block System을 통한 실시간 상태 추적

### **현재 문제점**
- [x] System Status가 WebSocket 기반으로 잘못 구현됨 (Playground는 HTTP 기반) ✅ **해결됨**
- [x] 실행 통계가 Context에 직접 구현됨 (Plugin으로 분리되어야 함) ✅ **해결됨**
- [x] 상태 관리가 Reducer에 하드코딩됨 (확장성 부족) ✅ **해결됨**
- [x] Robota SDK의 통계 시스템과 분리됨 (일관성 부족) ✅ **해결됨**

---

## 📦 **패키지 배치 전략 (수정됨)**

### **아키텍처 설계 원칙 재확인**
- **기존 SDK 활용**: 새로운 기반 클래스 만들지 않고 `BaseExecutor`, `BasePlugin` 직접 상속
- **과도한 추상화 지양**: 공통 인터페이스 강요보다는 일관된 패턴과 문서화로 확장성 확보
- **Playground 특화 허용**: Playground에 특화된 기능들은 억지로 범용화하지 않음
- **점진적 공통화**: Extensions 패키지는 실제 공통 패턴이 검증된 후 점진적으로 구성

### **Third-party vs Core vs Extensions 구분 원칙**
- **Core (`packages/agents`)**: Robota SDK 기본 기능, 검증된 범용 컴포넌트
- **Third-party (`apps/web`)**: Playground 전용, SaaS 특화 기능
- **Extensions (`packages/extensions`)**: **검증된 공통 패턴만** 점진적으로 추출 (미래 고려사항)

### **현재 구현 우선순위**
1. **1차**: Playground에서 완전한 기능 구현 (`apps/web`)
2. **2차**: 패턴 검증 및 문서화
3. **3차**: 실제 공통화 가능한 부분이 확인되면 Extensions 패키지 검토

### **구현할 컴포넌트별 배치 (수정됨)**

#### **Playground 전용 구현 (apps/web/src/lib/playground/)**
```
apps/web/src/lib/playground/
├── plugins/
│   └── playground-statistics-plugin.ts     # BasePlugin 직접 상속
├── robota-executor.ts                      # BaseExecutor 직접 상속 (PlaygroundExecutor)
└── hooks/
    └── use-playground-statistics.ts        # Playground 전용 Hook (팩토리 패턴 없음)
```

**설계 원칙**:
- `BaseExecutor` 상속 (새로운 `BaseCustomExecutor` 만들지 않음)
- 독립적인 통계 구조 (강제된 공통 인터페이스 없음)
- 프로젝트별 Hook 구현 (과도한 추상화 지양)

#### **미래 Extensions 패키지 고려사항**
```
packages/extensions/                         # 미래 검토 대상
├── patterns/
│   ├── executor-extension-patterns.md      # 패턴 문서화
│   └── plugin-development-guide.md         # 개발 가이드
└── utils/                                   # 실제 공통 유틸리티만
    └── (실제 공통화 가능한 부분 확인 후 구성)
```

**주의사항**:
- **현재 만들지 않음**: Playground 구현 완료 후 검토
- **공통화 판단 기준**: 실제로 여러 프로젝트에서 동일하게 사용 가능한지 검증 필요
- **Playground 특화 부분**: 억지로 공통화하지 않고 Playground 전용으로 유지

### **기존 SDK 플러그인과의 관계 (수정됨)**

#### **참조할 기존 플러그인들 (변경 없음)**
- **`packages/agents/src/plugins/usage/usage-plugin.ts`** 
  - 구조 참조: `BasePlugin` 확장 패턴
  - 통계 수집 방식 참조
- **`packages/agents/src/plugins/performance/performance-plugin.ts`**
  - 성능 메트릭 수집 패턴 참조
  - `onModuleEvent` 처리 방식 참조

#### **PlaygroundStatisticsPlugin 차별점 (명확화)**
```typescript
// 기존 UsagePlugin: 범용적 사용량 통계
export class UsagePlugin extends BasePlugin<UsagePluginOptions, UsagePluginStats> {
  // AI Provider 사용량, 토큰 사용량 등 범용 메트릭
}

// 새로운 PlaygroundStatisticsPlugin: Playground 특화 통계 (공통화 강요 안함)
export class PlaygroundStatisticsPlugin extends BasePlugin<PlaygroundStatisticsOptions, PlaygroundStatisticsStats> {
  // UI 실행 횟수, 사용자 인터랙션, 블록 생성 통계 등
  // Playground에만 특화된 메트릭들 - 다른 프로젝트와 억지로 공통화하지 않음
  
  getPlaygroundSpecificStats(): {
    uiInteractions: number;
    blockCreations: number;
    chatExecutions: number;
    // Playground만의 독특한 통계들
  }
}
```

#### **확장성 보장 방법 (추상화 대신 패턴 일관성)**
```typescript
// 다른 프로젝트에서 동일한 패턴 적용 (공통 인터페이스 강요 없음)

// E-commerce 프로젝트 예시
export class ECommerceExecutor extends BaseExecutor {
  // Playground와 동일한 패턴, 하지만 완전히 다른 구현
}

export class ECommerceAnalyticsPlugin extends BasePlugin<...> {
  // E-commerce만의 완전히 독립적인 통계
  getECommerceStats(): {
    orderConversionRate: number;
    customerLifetimeValue: number;
    // E-commerce에만 의미있는 통계들
  }
}

export function useECommerceAnalytics() {
  // E-commerce 전용 Hook (createStatisticsHook 같은 팩토리 없음)
}
```

---

## 🔧 **수정된 구현 계획**

### **Phase 1: SDK 패턴 분석 및 Playground 특화 설계 (1주)**

#### **1.1 기존 플러그인 패턴 분석 (변경 없음)**
- [ ] `UsagePlugin` 구현 패턴 분석
- [ ] `PerformancePlugin` 성능 메트릭 수집 방식
- [ ] `BaseExecutor` 확장 방법 조사

#### **1.2 Playground 특화 설계 (명확화)**
- [ ] `PlaygroundStatisticsPlugin` 인터페이스 설계
  - **주의**: 다른 프로젝트와 공통화 고려하지 않음
  - **초점**: Playground UI/UX에 최적화된 메트릭만 정의
- [ ] `PlaygroundExecutor` 확장 설계
  - **기반**: `BaseExecutor` 직접 상속
  - **새로운 기반 클래스 만들지 않음**
- [ ] 타입 정의 설계 (`apps/web/src/types/playground-statistics.ts`)
  - **원칙**: Playground 전용 타입, 범용화 고려 안함

### **Phase 2: Playground 전용 Plugin 구현 (1주)**

#### **2.1 PlaygroundStatisticsPlugin 구현 (수정됨)**
```typescript
// apps/web/src/lib/playground/plugins/playground-statistics-plugin.ts
export class PlaygroundStatisticsPlugin extends BasePlugin<
  PlaygroundStatisticsOptions,
  PlaygroundStatisticsStats
> {
  readonly name = 'PlaygroundStatisticsPlugin';
  readonly version = '1.0.0';
  readonly category = PluginCategory.MONITORING;
  readonly priority = PluginPriority.HIGH;

  // Playground에만 특화된 메트릭들 (공통화 고려 안함)
  private playgroundMetrics = {
    totalChatExecutions: 0,
    agentModeExecutions: 0,
    teamModeExecutions: 0,
    blockCreations: 0,
    uiInteractions: 0,
    streamingExecutions: 0,
    averageResponseTime: 0,
    errorCount: 0
  };

  // BasePlugin 패턴 준수하되 Playground 특화
  override async onModuleEvent(eventType: EventType, eventData: EventData): Promise<void> {
    // Playground 특화 이벤트 처리
  }

  // Playground만의 독특한 메서드들
  recordPlaygroundExecution(result: PlaygroundExecutionResult): void;
  recordBlockCreation(blockType: string): void;
  recordUIInteraction(interactionType: string): void;
  
  // 다른 프로젝트와 공통화하지 않는 고유한 통계 반환
  getPlaygroundStats(): PlaygroundMetrics;
}
```

#### **2.2 PlaygroundExecutor 확장 (수정됨)**
```typescript
// apps/web/src/lib/playground/robota-executor.ts
export class PlaygroundExecutor extends BaseExecutor {
  private statisticsPlugin: PlaygroundStatisticsPlugin;

  async initialize(): Promise<void> {
    // 기존 BaseExecutor 초기화
    await super.initialize();
    
    // Playground 전용 플러그인 추가
    this.statisticsPlugin = new PlaygroundStatisticsPlugin({
      enabled: true,
      collectUIMetrics: true
    });
    
    // Robota agent에 플러그인 주입
    this.addPlugin(this.statisticsPlugin);
  }

  // Playground 특화 메서드들 (범용화 고려 안함)
  getPlaygroundStatistics(): PlaygroundMetrics {
    return this.statisticsPlugin.getPlaygroundStats();
  }

  recordPlaygroundAction(action: PlaygroundAction): void {
    this.statisticsPlugin.recordUIInteraction(action.type);
  }
}
```

### **Phase 3: Playground 전용 React Integration (3일)**

#### **3.1 Playground Hook 구현 (수정됨)**
```typescript
// apps/web/src/hooks/use-playground-statistics.ts
export function usePlaygroundStatistics() {
  const { state } = usePlayground();
  
  // Playground 전용 통계 가져오기 (팩토리 패턴 없음)
  const statistics = useMemo(() => {
    const executor = state.executor as PlaygroundExecutor;
    if (!executor) return defaultPlaygroundStats;
    
    return executor.getPlaygroundStatistics();
  }, [state.executor, state.lastExecutionResult]);

  // Playground에만 의미있는 메트릭들 반환
  return {
    chatExecutions: statistics.totalChatExecutions,
    blockCreations: statistics.blockCreations,
    uiInteractions: statistics.uiInteractions,
    averageResponseTime: statistics.averageResponseTime,
    // Playground 특화 메트릭들
  };
}
```

### **Phase 4: Extensions 패키지 검토 (Phase 5 이후 별도 검토)**

#### **4.1 공통화 가능성 평가**
- [ ] Playground 구현 완료 후 실제 공통 패턴 식별
- [ ] 다른 도메인(E-commerce, Analytics 등)에서도 동일하게 사용 가능한 부분 확인
- [ ] 억지 추상화 vs 실제 재사용성 판단

#### **4.2 Extensions 패키지 설계 (조건부)**
- [ ] **조건**: 실제로 공통화 가능한 패턴이 3개 이상 프로젝트에서 확인될 때만
- [ ] **내용**: 패턴 문서화, 유틸리티 함수, 공통 타입 (강제 인터페이스 아님)
- [ ] **원칙**: Playground 특화 부분은 그대로 유지

---

## 🎯 **확장성 보장 전략 (수정됨)**

### **추상화 대신 패턴 일관성**
1. **명명 규칙 일관성**: `[Project]Executor`, `[Project]StatisticsPlugin`, `use[Project]Statistics`
2. **구조 패턴 일관성**: BaseExecutor 상속 → Plugin 주입 → Hook 연동
3. **문서화**: Playground 구현 과정을 상세한 가이드로 제공

### **확장성 검증 방법**
1. **참조 구현체**: Playground가 다른 개발자들의 참조 모델 역할
2. **베스트 프랙티스**: 일관된 패턴을 통한 학습 곡선 단축
3. **점진적 공통화**: 실제 필요에 의한 자연스러운 추상화

### **Extensions 패키지 신중한 접근**
- **현재**: 만들지 않음
- **미래**: Playground + 2-3개 다른 프로젝트에서 동일한 패턴 검증 후 검토
- **원칙**: 실제 공통 요구사항이 확인된 부분만 추출

**이제 과도한 추상화 없이 Playground에 집중하면서도, 미래 확장성을 열어두는 현실적인 계획이 되었습니다.** 🚀

---

## 📋 **완전한 작업 순서 체크리스트**

### **Phase 1: SDK 패턴 분석 및 Playground 특화 설계 (1주)**

#### **1.1 기존 플러그인 패턴 분석**
- [x] `packages/agents/src/plugins/usage/usage-plugin.ts` 구현 패턴 분석
  - [x] `BasePlugin<TOptions, TStats>` 확장 방식 조사
  - [x] `onModuleEvent` 이벤트 처리 방식 파악
  - [x] 통계 데이터 구조 및 업데이트 로직 분석
- [x] `packages/agents/src/plugins/performance/performance-plugin.ts` 성능 메트릭 수집 방식 분석
  - [x] 실행 시간 측정 방법 조사
  - [x] 메모리 사용량 추적 방식 파악
  - [x] 실시간 업데이트 메커니즘 분석
- [x] `packages/agents/src/abstracts/base-executor.ts` 확장 방법 조사
  - [x] 기존 `BaseExecutor` 구조 파악
  - [x] 플러그인 주입 방식 분석
  - [x] 상속 패턴 및 확장 포인트 식별

#### **1.2 Playground 특화 설계**
- [x] `PlaygroundStatisticsPlugin` 인터페이스 설계
  - [x] Playground UI/UX 최적화 메트릭 정의
  - [x] 채팅 실행, 블록 생성, UI 인터랙션 추적 방식 설계
  - [x] 에이전트/팀 모드별 통계 분류 방법 정의
- [x] `PlaygroundExecutor` 확장 설계
  - [x] `BaseExecutor` 직접 상속 구조 설계
  - [x] 플러그인 주입 및 관리 방식 설계
  - [x] Playground 특화 메서드 인터페이스 정의
- [x] 타입 정의 설계 (`apps/web/src/types/playground-statistics.ts`)
  - [x] `PlaygroundStatisticsOptions` 타입 정의
  - [x] `PlaygroundStatisticsStats` 타입 정의
  - [x] `PlaygroundMetrics` 인터페이스 정의
  - [x] `PlaygroundAction` 타입 정의

### **Phase 2: Playground 전용 Plugin 구현 (1주)**

#### **2.1 PlaygroundStatisticsPlugin 구현**
- [x] 기본 플러그인 클래스 구조 생성
  - [x] `apps/web/src/lib/playground/plugins/playground-statistics-plugin.ts` 파일 생성
  - [x] `BasePlugin<PlaygroundStatisticsOptions, PlaygroundStatisticsStats>` 상속
  - [x] 플러그인 메타데이터 (`name`, `version`, `category`, `priority`) 설정
- [x] Playground 특화 메트릭 구조 구현
  - [x] `playgroundMetrics` 내부 상태 구조 정의
  - [x] 채팅 실행 통계 필드 구현 (`totalChatExecutions`, `agentModeExecutions`, `teamModeExecutions`)
  - [x] UI 인터랙션 통계 필드 구현 (`blockCreations`, `uiInteractions`)
  - [x] 성능 메트릭 필드 구현 (`averageResponseTime`, `errorCount`)
- [x] 이벤트 처리 메서드 구현
  - [x] `onModuleEvent` 메서드 구현 (SDK 이벤트 자동 처리)
  - [x] `recordPlaygroundExecution` 메서드 구현
  - [x] `recordBlockCreation` 메서드 구현
  - [x] `recordUIInteraction` 메서드 구현
- [x] 통계 조회 메서드 구현
  - [x] `getPlaygroundStats` 메서드 구현
  - [x] 실시간 평균 계산 로직 구현
  - [x] 통계 리셋 기능 구현

#### **2.2 PlaygroundExecutor 확장**
- [x] `PlaygroundExecutor` 클래스 확장
  - [x] `apps/web/src/lib/playground/robota-executor.ts` 수정
  - [x] `BaseExecutor` 직접 상속 구조 적용
  - [x] 생성자에서 `PlaygroundStatisticsPlugin` 인스턴스 생성
- [x] 플러그인 통합 구현
  - [x] `initialize` 메서드에서 플러그인 주입 로직 구현
  - [x] Robota agent에 플러그인 등록 로직 구현
  - [x] 플러그인 상태 관리 로직 구현
- [x] Playground 특화 메서드 구현
  - [x] `getPlaygroundStatistics` 메서드 구현
  - [x] `recordPlaygroundAction` 메서드 구현
  - [x] 기존 `run`/`runStream` 메서드와 통계 수집 연동

### **Phase 3: Playground 전용 React Integration (3일)**

#### **3.1 Playground Hook 구현**
- [x] `use-playground-statistics.ts` Hook 생성
  - [x] `apps/web/src/hooks/use-playground-statistics.ts` 파일 생성
  - [x] `usePlayground` Context에서 executor 가져오기 로직 구현
  - [x] `PlaygroundExecutor` 타입 캐스팅 및 안전성 검사 구현
- [x] 통계 데이터 실시간 동기화
  - [x] `useMemo`를 통한 통계 데이터 메모이제이션 구현
  - [x] `state.executor`, `state.lastExecutionResult` 의존성 관리
  - [x] 기본값 처리 (`defaultPlaygroundStats`) 구현
- [x] Hook 반환 인터페이스 구현
  - [x] Playground 특화 메트릭 노출 (`chatExecutions`, `blockCreations`, etc.)
  - [x] 성능 지표 계산 및 포맷팅
  - [x] 에러 상태 및 로딩 상태 관리

#### **3.2 PlaygroundContext 통합**
- [ ] `playground-context.tsx` 수정
  - [ ] `PlaygroundExecutor` 인스턴스 생성 시 통계 플러그인 활성화
  - [ ] 실행 결과에 따른 통계 업데이트 로직 구현
  - [ ] Context 상태에 통계 관련 필드 추가 (필요시)
- [ ] 실행 흐름과 통계 수집 연동
  - [ ] `executePrompt`, `executeStreamPrompt`에서 통계 이벤트 발생
  - [ ] 성공/실패 케이스별 통계 업데이트
  - [ ] 실행 시간 측정 및 평균 계산 로직

### **Phase 4: UI Components 구현 (2일)**

#### **4.1 System Status 컴포넌트 리팩터링**
- [x] 기존 System Status 패널 수정
  - [x] `apps/web/src/app/playground/page.tsx`의 System Status 섹션 수정
  - [x] WebSocket 통계 제거 (`useWebSocketConnection` 의존성 제거)
  - [x] `usePlaygroundStatistics` Hook 연동
- [x] 통계 표시 로직 구현
  - [x] 실행 횟수 표시 (`chatExecutions`)
  - [x] 평균 응답 시간 표시 (`averageResponseTime`)
  - [x] 에러 카운트 표시 (`errorCount`)
  - [x] UI 인터랙션 통계 표시 (`uiInteractions`, `blockCreations`)
- [x] UI 개선 및 최적화
  - [x] 더 간결한 레이아웃 적용
  - [x] 실시간 업데이트 애니메이션 추가
  - [x] 반응형 디자인 적용

#### **4.2 세부 메트릭 컴포넌트 (선택사항)**
- [ ] 실행 통계 상세 표시 컴포넌트
  - [ ] Agent vs Team 실행 비율 차트
  - [ ] 시간대별 실행 패턴 그래프
  - [ ] 성공률 및 에러율 표시
- [ ] 성능 지표 시각화 컴포넌트
  - [ ] 응답 시간 히스토그램
  - [ ] 실시간 성능 트렌드 차트
  - [ ] 메모리 사용량 모니터링 (필요시)

### **Phase 5: 통합 및 테스트 (2일)**

#### **5.1 Plugin Integration 테스트**
- [x] PlaygroundExecutor 플러그인 주입 테스트
  - [x] 플러그인이 올바르게 등록되는지 확인
  - [x] Agent/Team 실행 시 이벤트가 올바르게 발생하는지 테스트
  - [x] 통계 데이터가 정확하게 수집되는지 검증
- [x] 통계 수집 정확성 테스트
  - [x] 채팅 실행 카운트 정확성 테스트
  - [x] 블록 생성 통계 정확성 테스트
  - [x] 평균 응답 시간 계산 정확성 테스트
  - [x] 에러 발생 시 에러 카운트 증가 테스트

#### **5.2 UI Integration 테스트**
- [x] React Hook 동기화 테스트
  - [x] `usePlaygroundStatistics`가 실시간으로 업데이트되는지 확인
  - [x] Context 변경 시 Hook이 올바르게 리렌더링되는지 테스트
  - [x] 메모리 누수 없이 상태가 관리되는지 확인
- [x] System Status 패널 테스트
  - [x] 실시간 통계 표시 정확성 테스트
  - [x] UI 컴포넌트 렌더링 성능 테스트
  - [x] 에러 상황에서의 Fallback 동작 테스트
- [x] 전체 시스템 통합 테스트
  - [x] Agent 실행 → 통계 수집 → UI 업데이트 전체 흐름 테스트
  - [x] Team 실행 → 통계 수집 → UI 업데이트 전체 흐름 테스트
  - [x] 다양한 에러 케이스에서의 시스템 안정성 테스트

### **Phase 6: 문서화 및 완료 (1일)**

#### **6.1 기능 문서화**
- [ ] `FEATURES.md`에 System Status 기능 추가
  - [ ] 구현된 기능 목록 정리
  - [ ] 사용자 가이드 작성
  - [ ] 스크린샷 및 사용 예시 추가
- [ ] `ARCHITECTURE.md`에 아키텍처 업데이트
  - [ ] PlaygroundStatisticsPlugin 아키텍처 문서화
  - [ ] PlaygroundExecutor 확장 패턴 문서화
  - [ ] Third-party Plugin 개발 가이드 작성

#### **6.2 코드 정리 및 최종 검토**
- [ ] 코드 품질 검토
  - [ ] ESLint 오류 해결
  - [ ] TypeScript 타입 안전성 검증
  - [ ] 코드 주석 및 문서화 완성
- [ ] 성능 최적화
  - [ ] 불필요한 리렌더링 제거
  - [ ] 메모리 사용량 최적화
  - [ ] 통계 수집 오버헤드 최소화
- [ ] 최종 테스트 및 배포 준비
  - [ ] 전체 기능 통합 테스트
  - [ ] 브라우저 호환성 테스트
  - [ ] GitHub 푸시 및 문서 업데이트

---

**총 예상 작업 기간: 2-3주**
**총 체크리스트 항목: 76개**

이제 각 단계별로 체크박스를 [x]로 변경하면서 진행하겠습니다! 🚀 