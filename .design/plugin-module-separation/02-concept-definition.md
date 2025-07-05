# Plugin vs Module 개념 정의 및 분리

## Plugin 정의 (확장 기능)

**Robota 에이전트의 라이프사이클과 동작을 확장하는 선택적 기능**

### 특징
- 🔄 **Runtime 제어**: 동적 활성화/비활성화 가능
- 🔌 **선택적 확장**: 핵심 에이전트 동작에 영향 없이 추가/제거
- 📊 **Lifecycle Hooks**: 에이전트 실행 과정에 개입
- 🔧 **관찰 및 보강**: 기본 동작을 관찰하고 부가 기능 제공
- 🎯 **횡단 관심사**: 로깅, 모니터링, 알림, 검증 등

### Plugin 예시 (현재 8개 플러그인)
```typescript
// 사용량 추적 플러그인 - 에이전트 실행 통계 수집
class UsagePlugin extends BasePlugin {
    // beforeRun, afterRun 등에서 토큰 사용량 추적
    async beforeRun(input: string): Promise<void> {
        this.startTime = Date.now();
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        this.recordUsage({
            duration: Date.now() - this.startTime,
            inputTokens: this.countTokens(input),
            outputTokens: this.countTokens(output)
        });
    }
}

// 성능 모니터링 플러그인 - 실행 시간, 메모리 사용량 추적
class PerformancePlugin extends BasePlugin {
    // 에이전트 실행 성능 지표 수집
    async beforeExecution(): Promise<void> {
        this.metrics.memoryBefore = process.memoryUsage();
    }
    
    async afterExecution(): Promise<void> {
        this.metrics.memoryAfter = process.memoryUsage();
        this.recordPerformance(this.metrics);
    }
}

// 대화 히스토리 플러그인 - 대화 내용 저장/관리
class ConversationHistoryPlugin extends BasePlugin {
    // 메시지 추가/삭제 시 스토리지에 자동 저장
    async afterRun(input: string, output: string): Promise<void> {
        await this.storage.saveConversation({
            input, output, timestamp: Date.now()
        });
    }
}
```

## Module 정의 (아키텍처 구성요소)

**Robota 에이전트가 동작하기 위해 필요한 핵심 아키텍처 구성요소**

### 특징
- ⚙️ **Architectural Components**: 시스템 아키텍처의 핵심 구성 블록
- 🏗️ **Essential Dependencies**: 에이전트 동작에 필수적인 의존성
- 📦 **Capability Providers**: 특정 도메인 기능을 제공
- 🔗 **Interface Implementation**: 표준 인터페이스의 구체적 구현
- 🎯 **Domain Experts**: 특정 영역의 전문 기능 제공

### Module의 진짜 의미
**Module은 "에이전트가 무엇을 할 수 있는가"를 결정하는 기능 제공자**

```typescript
// AI Provider Modules - "어떤 AI와 대화할 수 있는가"
interface AIModule {
    generateResponse(messages: Message[]): Promise<string>;
    generateStream(messages: Message[]): AsyncIterable<string>;
    supportedModels(): string[];
}

// Tool System Modules - "어떤 작업을 수행할 수 있는가"  
interface ToolModule {
    registerTool(tool: Tool): void;
    executeTool(name: string, params: any): Promise<any>;
    getAvailableTools(): Tool[];
}

// Memory Modules - "무엇을 기억할 수 있는가"
interface MemoryModule {
    store(key: string, value: any): Promise<void>;
    retrieve(key: string): Promise<any>;
    search(query: string): Promise<any[]>;
}

// Planning Modules - "어떻게 계획을 세울 수 있는가"
interface PlanningModule {
    createPlan(task: string): Promise<Plan>;
    executePlan(plan: Plan): Promise<Result>;
    adaptPlan(plan: Plan, feedback: string): Promise<Plan>;
}
```

## 핵심 차이점 정리

### Plugin vs Module 한 줄 요약

- **Plugin**: "에이전트가 실행될 때 무엇을 관찰하고 보강할 것인가?" (횡단 관심사)
- **Module**: "에이전트가 무엇을 할 수 있는가?" (핵심 능력)

### 실제 구분 기준

#### Module이 되어야 하는 것들
1. **능력 제공자**: 에이전트의 새로운 능력을 추가
   - Memory Module: 기억하는 능력
   - Reasoning Module: 추론하는 능력
   - Perception Module: 감지하는 능력

2. **인터페이스 구현**: 표준 인터페이스의 구체적 구현
   - AIProvider 구현체들 (OpenAI, Anthropic, Google)
   - Storage 구현체들 (File, Database, Vector)

#### Plugin으로 유지되어야 하는 것들  
1. **관찰 및 보강**: 기존 동작을 관찰하고 부가 기능 제공
   - Usage 추적, Performance 모니터링
   - Error 핸들링, Logging, Webhook 알림

2. **횡단 관심사**: 여러 모듈에 걸쳐 적용되는 공통 기능
   - 보안, 제한, 캐싱, 압축 등

### 판단 기준 질문들
1. "이 기능이 없으면 에이전트가 할 수 있는 일이 줄어드나?" → **Module**
2. "이 기능이 없어도 에이전트는 기본 동작을 하나?" → **Plugin**  
3. "이 기능이 에이전트의 새로운 능력을 제공하나?" → **Module**
4. "이 기능이 기존 동작을 관찰/보강하나?" → **Plugin**

## 핵심 판별 기준

**"이걸 제거하면 에이전트가 할 수 있는 일이 줄어드나?"**
- **Yes** → Module (에이전트의 핵심 능력)
- **No** → Plugin (부가적인 관찰/개선 기능)

### 예시 분석

#### Module 예시
- **메모리 시스템 제거** → 기억할 수 없음 → **Module**
- **도구 실행 시스템 제거** → 도구 사용 불가 → **Module**
- **AI Provider 제거** → 대화 불가 → **Module**
- **추론 시스템 제거** → 논리적 사고 불가 → **Module**

#### Plugin 예시
- **로깅 시스템 제거** → 여전히 정상 작동 → **Plugin**
- **성능 모니터링 제거** → 기능에 영향 없음 → **Plugin**
- **대화 히스토리 저장 제거** → 기본 대화는 가능 → **Plugin**
- **웹훅 알림 제거** → 에이전트 기능에 영향 없음 → **Plugin**

## 비유를 통한 이해

### 자동차 비유
- **Module**: 엔진, 변속기, 브레이크 (이것 없으면 자동차가 못함)
- **Plugin**: 대시캠, 내비게이션, 오디오 (이것 없어도 자동차는 달림)

### 스마트폰 비유
- **Module**: CPU, 메모리, 네트워크 칩 (이것 없으면 스마트폰이 못함)
- **Plugin**: 카메라 필터, 배경화면, 알림음 (이것 없어도 스마트폰은 작동)

### 개발자 IDE 비유
- **Module**: 컴파일러, 디버거, 파일 시스템 (이것 없으면 개발 못함)
- **Plugin**: 테마, 코드 포맷터, 깃 통합 (이것 없어도 코딩은 가능)

## 설계 철학

### Module 철학: "What can it do?"
에이전트의 **능력(Capability)**을 정의합니다. 새로운 Module을 추가한다는 것은 에이전트가 새로운 일을 할 수 있게 된다는 의미입니다.

### Plugin 철학: "How to observe/enhance?"
에이전트의 **동작(Behavior)**을 관찰하고 보강합니다. 새로운 Plugin을 추가한다는 것은 에이전트의 실행 과정을 더 잘 관찰하거나 부가 가치를 제공한다는 의미입니다.

## 개발 시 고려사항

### Module 개발 시
1. **필수성 검증**: 정말로 에이전트의 핵심 능력인가?
2. **의존성 설계**: 다른 모듈과의 의존 관계는?
3. **인터페이스 정의**: 표준화된 인터페이스를 제공하는가?
4. **능력 명세**: 제공하는 capabilities가 명확한가?

### Plugin 개발 시
1. **관찰점 식별**: 어떤 lifecycle hook을 사용할 것인가?
2. **성능 고려**: 관찰 기능이므로 오버헤드 최소화
3. **옵션 설계**: 활성화/비활성화 및 설정 가능성
4. **독립성 보장**: 다른 플러그인과 독립적으로 동작하는가?

이러한 명확한 구분을 통해 개발자는 새로운 기능을 개발할 때 적절한 확장 방식을 선택할 수 있고, 시스템의 일관성과 확장성을 유지할 수 있습니다. 