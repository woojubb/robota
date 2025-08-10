# ContextualEventService

새로운 표준 EventService 구현체로, 혁신적인 **함수 주입 기반 컨텍스트 추출** 시스템을 제공합니다.

## 🎯 주요 특징

### 1. **혁신적인 `createChild(this)` 패턴**
- **극단적 단순화**: `parentService.createChild(this)` 한 줄로 자식 EventService 생성
- **자동 컨텍스트 추출**: 함수 주입 방식으로 `this` 객체에서 자동으로 컨텍스트 추출
- **도메인 중립성**: 핵심 서비스는 특정 도메인 클래스를 몰라도 됨

### 2. **단일 배열 주입 아키텍처**
```typescript
// 🏗️ 애플리케이션 시작시 한 번만 extractors 배열 주입
const rootEventService = new ContextualEventService({
    contextExtractors: [
        { ctor: Robota, extract: agentContextExtractor },           // Agent 타입 처리
        { ctor: TeamContainer, extract: teamContextExtractor },     // Team 타입 처리  
        { name: 'AssignTaskTool', extract: toolContextExtractor },  // Tool 타입 처리
        { name: 'WorkflowBuilder', extract: workflowExtractor },    // Workflow 타입 처리
        { extract: genericContextExtractor }                        // Fallback (no matching criteria)
    ]
});

// 🎯 이후 모든 자식은 단순하게
const childService = parentService.createChild(this);
```

### 3. **최상위 한 번만 설정**
- **Root Injection**: 애플리케이션 부트스트랩에서 한 번만 함수들 설정
- **자동 상속**: 모든 하위 EventService가 동일한 컨텍스트 추출 함수들 상속
- **메모리 효율**: 함수 참조 공유로 메모리 사용량 최적화

### 4. **완전한 타입 안전성**
- 함수별 개별 타입 가드 및 추출 로직
- TypeScript 오버로드로 기존 방식과 신규 방식 모두 지원
- 컴파일 타임 타입 검증

## 📋 사용법

### 1. **애플리케이션 부트스트랩 (한 번만 설정)**

```typescript
import { ContextualEventService } from './contextual-event/index.js';

// 🎯 각 타입별 컨텍스트 추출 함수 정의
const agentContextExtractor = (source: any) => {
    return {
        executionId: source.conversationId,
        sourceType: 'agent',
        sourceId: source.conversationId,
        metadata: { agentName: source.name }
    };
};

const teamContextExtractor = (source: any) => {
    return {
        executionId: source.teamId,
        sourceType: 'team',
        sourceId: source.teamId,
        metadata: { teamSize: source.agents?.length }
    };
};

const toolContextExtractor = (source: any) => {
    return {
        executionId: `tool_${Date.now()}`,
        sourceType: 'tool',
        sourceId: source.toolName,
        toolName: source.toolName
    };
};

// 🏗️ 애플리케이션 시작시 한 번만 설정 - 단일 배열로 주입
const rootEventService = new ContextualEventService({
    contextExtractors: [
        { ctor: Robota, extract: agentContextExtractor },         // instanceof 매칭
        { ctor: TeamContainer, extract: teamContextExtractor },   // instanceof 매칭
        { name: 'AssignTaskTool', extract: toolContextExtractor }, // constructor.name 매칭
        { extract: genericFallbackExtractor }                     // 매칭 조건 없음 (fallback)
    ]
});
```

### 2. **혁신적인 `createChild(this)` 사용**

```typescript
class TeamContainer {
    constructor(private eventService: ContextualEventService) {}

    async assignTask(task: TaskDefinition) {
        // 🎯 매우 간단한 자식 EventService 생성
        const taskEventService = this.eventService.createChild(this);
        
        // TeamContainer 생성자로 instanceof 매칭되어 teamContextExtractor 자동 실행:
        // { executionId: this.teamId, sourceType: 'team', sourceId: this.teamId }
        
        taskEventService.emit('team.task_assigned', { task });
    }
}

class Robota {
    constructor(private eventService: ContextualEventService) {}
    
    async executeTask(taskDescription: string) {
        // 🎯 this만 전달하면 모든 컨텍스트 자동 생성
        const executionService = this.eventService.createChild(this);
        
        // Robota 생성자로 instanceof 매칭되어 agentContextExtractor 자동 실행
        executionService.emit('agent.execution_start', { taskDescription });
    }
}
```

### 3. **기존 명시적 방식도 지원 (하위 호환성)**

```typescript
// ✅ 여전히 명시적 컨텍스트 전달 가능
const childService = parentService.createChild({
    executionId: 'manual-id',
    sourceType: 'custom',
    sourceId: 'manual-source'
});
```

### 4. **커스텀 추출기 추가**

```typescript
// 🔧 새로운 도메인을 위한 커스텀 추출 함수
const customBusinessExtractor = (source: any) => {
    return {
        executionId: source.businessId,
        sourceType: 'business',
        sourceId: source.businessId,
        metadata: { businessType: source.type }
    };
};

// 기존 EventService에 새 추출기 추가 (새로운 인스턴스 생성)
const enhancedEventService = new ContextualEventService({
    contextExtractors: [
        ...existingService.contextExtractors,
        { ctor: MyCustomBusinessObject, extract: customBusinessExtractor }  // 🆕 추가
    ]
});
```

## 🧪 테스팅

### Mock EventService 사용
```typescript
import { MockContextualEventService } from './contextual-event/testing.js';

// 🧪 테스트용 Mock 생성
const mockService = new MockContextualEventService();

// 테스트용 추출 함수와 함께 생성
const testService = new ContextualEventService({
    contextExtractors: [
        { 
            extract: (source: any) => source?.testId ? {
                executionId: source.testId,
                sourceType: 'test',
                sourceId: source.testId
            } : null
        }
    ]
});

// createChild(this) 테스트
const testObject = { testId: 'test-123' };
const child = testService.createChild(testObject);

expect(child.getExecutionContext()?.sourceType).toBe('test');
```

## 🎯 **핵심 설계 철학**

### **1. 극단적 단순성**
- **사용자 경험**: `createChild(this)` 한 줄로 모든 것 해결
- **설정 중앙화**: 애플리케이션 시작시 한 번만 설정
- **복잡성 숨김**: 내부 복잡성을 완전히 캡슐화

### **2. 단일 배열 주입의 장점**
- **도메인 중립성**: 핵심 서비스가 특정 클래스를 몰라도 됨
- **단순한 구조**: 단일 `extractors` 배열로 모든 매칭 처리
- **명확한 우선순위**: 배열 순서대로 매칭, 첫 성공시 즉시 반환
- **확장성**: 새로운 타입은 배열에 추가만 하면 됨
- **타입 안전성**: `instanceof` 및 `constructor.name` 표준 매칭

### **3. 메모리 효율성**
- **참조 공유**: 모든 하위 EventService가 동일한 함수들 참조
- **지연 생성**: 필요시에만 child EventService 생성
- **캐싱 불필요**: 함수 호출 자체가 충분히 빠름

## 📁 파일 구조

```
src/services/contextual-event/
├── index.ts                           # 메인 exports
├── types.ts                           # 타입 정의 (단일 배열 extractor 기반)
├── contextual-event-service.ts        # 메인 구현체 (단일 배열 주입 방식)
├── enhanced-event-service.ts          # ⚠️ MIGRATION ONLY - 삭제 예정
├── factory.ts                         # ⚠️ 일부 MIGRATION ONLY 기능 포함
├── testing.ts                         # 테스트 유틸리티
├── contextual-event-service.test.ts   # 테스트
├── MIGRATION_PLAN.md                  # ⚠️ MIGRATION ONLY - 삭제 예정
└── README.md                          # 이 문서
```

## 🎯 마이그레이션 및 향후 계획

### **즉시 구현**
1. **단일 배열 주입 방식 구현**: 새로운 `extractors` 접근법 적용
2. **`contextExtractors` 배열 지원**: Constructor/Name 매칭 + 추출 함수
3. **`createChild(this)` 패턴 완성**: 오버로드 지원으로 기존 방식과 병행

### **마이그레이션 단계**
1. **ActionTrackingEventService 교체**: ContextualEventService를 표준으로
2. **사용처 업데이트**: `createChild(this)` 패턴 적용
3. **마이그레이션 코드 삭제**: 임시 기능들 완전 제거

### **삭제 예정 항목**
- `enhanced-event-service.ts` (전체 파일)
- `factory.ts`의 `wrap()`, `safeCreateChild()` 메서드
- `MIGRATION_PLAN.md` 파일
- 모든 마이그레이션 관련 문서 및 주석

## ⚠️ 혁신적 변화

- **패러다임 전환**: 복잡한 Factory → 단순한 단일 배열 주입
- **사용성 혁신**: `createChild(this)` 패턴으로 극단적 단순화
- **아키텍처 개선**: 도메인 중립성과 확장성 동시 달성
- **타입 매칭 표준화**: `instanceof`/`constructor.name` 기반 명확한 매칭
- **성능 최적화**: 메모리 효율적인 extractor 참조 공유
