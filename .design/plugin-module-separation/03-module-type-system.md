# 모듈 타입 시스템

## Module Type 분류 기준 및 확장성

모듈 타입은 다음과 같은 **계층적 분류 원칙**에 따라 결정됩니다:

### 분류 기준 (Classification Criteria)

#### 1. 기능적 계층 (Functional Layer)
- `CORE`: 에이전트의 기본 동작에 필수적인 기능
- `CAPABILITY`: 에이전트의 특정 능력을 제공하는 기능
- `ENHANCEMENT`: 기존 능력을 향상시키는 기능

#### 2. 도메인 영역 (Domain Area)
- `PROVIDER`: AI 서비스 제공자 (OpenAI, Anthropic, Google 등)
- `TOOL`: 외부 작업 실행 능력
- `STORAGE`: 데이터 저장 및 검색
- `COMMUNICATION`: 입출력 및 통신
- `COGNITION`: 인지 및 추론 능력

#### 3. 의존성 레벨 (Dependency Level)
- `FOUNDATION`: 다른 모듈의 기반이 되는 모듈
- `COMPOSITE`: 여러 모듈을 조합하는 모듈
- `SPECIALIZED`: 특정 목적에 특화된 모듈

## 동적 모듈 타입 시스템

### 기본 타입 정의

```typescript
// 기본 모듈 타입 (확장 가능)
export enum CoreModuleType {
    CORE = 'core',
    PROVIDER = 'provider',
    TOOL = 'tool',
    STORAGE = 'storage',
    MEMORY = 'memory',
    REASONING = 'reasoning',
    PERCEPTION = 'perception',
    TRANSPORT = 'transport'
}

// 확장된 모듈 타입 시스템
export interface ModuleTypeDescriptor {
    readonly type: string;
    readonly category: ModuleCategory;
    readonly layer: ModuleLayer;
    readonly dependencies: string[];
    readonly capabilities: string[];
}

export enum ModuleCategory {
    FOUNDATION = 'foundation',     // 기반 기술
    CAPABILITY = 'capability',     // 핵심 능력
    ENHANCEMENT = 'enhancement',   // 개선 기능
    INTEGRATION = 'integration'    // 통합 기능
}

export enum ModuleLayer {
    INFRASTRUCTURE = 'infrastructure', // 인프라 계층
    PLATFORM = 'platform',            // 플랫폼 계층  
    APPLICATION = 'application',      // 애플리케이션 계층
    DOMAIN = 'domain'                 // 도메인 계층
}
```

### ModuleTypeRegistry 구현

```typescript
// 모듈 타입 레지스트리 (런타임 확장 가능)
export class ModuleTypeRegistry {
    private static types = new Map<string, ModuleTypeDescriptor>();
    
    // 기본 타입들 등록
    static {
        this.registerType('provider', {
            type: 'provider',
            category: ModuleCategory.FOUNDATION,
            layer: ModuleLayer.PLATFORM,
            dependencies: [],
            capabilities: ['ai-generation', 'model-inference']
        });
        
        this.registerType('memory', {
            type: 'memory',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['storage'],
            capabilities: ['data-persistence', 'retrieval', 'search']
        });
        
        this.registerType('reasoning', {
            type: 'reasoning',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['memory', 'provider'],
            capabilities: ['logical-inference', 'pattern-recognition']
        });
    }
    
    static registerType(name: string, descriptor: ModuleTypeDescriptor): void {
        this.types.set(name, descriptor);
    }
    
    static getType(name: string): ModuleTypeDescriptor | undefined {
        return this.types.get(name);
    }
    
    static getTypesByCategory(category: ModuleCategory): ModuleTypeDescriptor[] {
        return Array.from(this.types.values()).filter(t => t.category === category);
    }
    
    static validateDependencies(moduleType: string): boolean {
        const descriptor = this.getType(moduleType);
        if (!descriptor) return false;
        
        return descriptor.dependencies.every(dep => this.types.has(dep));
    }
}
```

## 계층별 분류 (Layer-based Classification)

### Infrastructure Layer (인프라 계층)
**기본 인프라 서비스를 제공하는 모듈들**

```typescript
// 데이터베이스 연결, 네트워크 통신, 기본 저장소
const databaseModule = {
    type: 'database',
    category: ModuleCategory.FOUNDATION,
    layer: ModuleLayer.INFRASTRUCTURE,
    dependencies: [],
    capabilities: ['data-persistence', 'transaction', 'query']
};

const networkModule = {
    type: 'network',
    category: ModuleCategory.FOUNDATION,
    layer: ModuleLayer.INFRASTRUCTURE,
    dependencies: [],
    capabilities: ['http-client', 'websocket', 'tcp-connection']
};
```

### Platform Layer (플랫폼 계층)  
**플랫폼 서비스를 제공하는 모듈들**

```typescript
// AI 제공자, 기본 도구 실행, 메시지 전송
const openaiModule = {
    type: 'openai-provider',
    category: ModuleCategory.FOUNDATION,
    layer: ModuleLayer.PLATFORM,
    dependencies: ['http-transport'],
    capabilities: ['text-generation', 'model-inference', 'streaming']
};

const apiGatewayModule = {
    type: 'api-gateway',
    category: ModuleCategory.FOUNDATION,
    layer: ModuleLayer.PLATFORM,
    dependencies: ['network', 'security'],
    capabilities: ['request-routing', 'rate-limiting', 'authentication']
};
```

### Application Layer (애플리케이션 계층)
**애플리케이션 로직을 처리하는 모듈들**

```typescript
// 메모리 관리, 도구 오케스트레이션, 대화 관리
const memoryModule = {
    type: 'episodic-memory',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.APPLICATION,
    dependencies: ['vector-storage', 'embedding-provider'],
    capabilities: ['episode-storage', 'similarity-search', 'context-retrieval']
};

const toolOrchestratorModule = {
    type: 'tool-orchestrator',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.APPLICATION,
    dependencies: ['tool-registry', 'execution-engine'],
    capabilities: ['tool-composition', 'workflow-execution', 'result-aggregation']
};
```

### Domain Layer (도메인 계층)
**도메인 전문 지식을 제공하는 모듈들**

```typescript
// 추론, 계획, 학습, 감정 분석
const planningModule = {
    type: 'hierarchical-planning',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.DOMAIN,
    dependencies: ['reasoning', 'memory', 'tool-executor'],
    capabilities: ['goal-decomposition', 'plan-generation', 'execution-monitoring']
};

const learningModule = {
    type: 'reinforcement-learning',
    category: ModuleCategory.ENHANCEMENT,
    layer: ModuleLayer.DOMAIN,
    dependencies: ['experience-memory', 'reward-function', 'policy-network'],
    capabilities: ['experience-learning', 'policy-optimization', 'behavior-adaptation']
};
```

## 카테고리별 분류 (Category-based Classification)

### Foundation Modules
**다른 모듈의 기반이 되는 핵심 기술**

- **Database**: 데이터 영속성
- **Network**: 통신 기반
- **AI Providers**: AI 서비스 기반
- **Basic Storage**: 파일 시스템 기반

### Capability Modules  
**에이전트의 핵심 능력을 제공**

- **Memory**: 기억 능력
- **Reasoning**: 추론 능력
- **Planning**: 계획 수립 능력
- **Perception**: 감지 능력
- **Learning**: 학습 능력

### Enhancement Modules
**기존 능력을 향상시키는 기능**

- **Context Awareness**: 상황 인식 향상
- **Performance Optimization**: 성능 최적화
- **Adaptive Behavior**: 적응적 행동

### Integration Modules
**여러 모듈을 통합하는 기능**

- **Multi-modal Processing**: 다중 모달 처리
- **Cross-domain Reasoning**: 도메인 간 추론
- **Unified Interfaces**: 통합 인터페이스

## 동적 모듈 타입 등록 예시

### 실시간 타입 등록
```typescript
// 런타임에 새로운 모듈 타입 등록
ModuleTypeRegistry.registerType('emotion-recognition', {
    type: 'emotion-recognition',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.DOMAIN,
    dependencies: ['text-perception', 'context-analysis'],
    capabilities: ['emotion-detection', 'sentiment-analysis', 'mood-tracking']
});

// 사용자 정의 도메인 모듈
ModuleTypeRegistry.registerType('financial-analysis', {
    type: 'financial-analysis',
    category: ModuleCategory.ENHANCEMENT,
    layer: ModuleLayer.DOMAIN,
    dependencies: ['reasoning', 'memory', 'data-provider'],
    capabilities: ['market-analysis', 'risk-assessment', 'portfolio-optimization']
});

// 특수 통합 모듈
ModuleTypeRegistry.registerType('agent-collaboration', {
    type: 'agent-collaboration',
    category: ModuleCategory.INTEGRATION,
    layer: ModuleLayer.DOMAIN,
    dependencies: ['communication', 'planning', 'coordination'],
    capabilities: ['multi-agent-coordination', 'task-distribution', 'consensus-building']
});
```

### 도메인별 모듈 세트
```typescript
// 의료 도메인 모듈들
const medicalModuleTypes = [
    'medical-knowledge-base',
    'symptom-analyzer',
    'diagnosis-assistant',
    'treatment-recommender',
    'drug-interaction-checker'
];

medicalModuleTypes.forEach(type => {
    ModuleTypeRegistry.registerType(type, {
        type: type,
        category: ModuleCategory.CAPABILITY,
        layer: ModuleLayer.DOMAIN,
        dependencies: ['reasoning', 'medical-memory', 'knowledge-graph'],
        capabilities: [`${type}-capability`]
    });
});

// 게임 AI 도메인 모듈들  
const gameAIModuleTypes = [
    'game-state-analyzer',
    'strategy-planner',
    'opponent-modeler',
    'move-generator',
    'evaluation-function'
];

gameAIModuleTypes.forEach(type => {
    ModuleTypeRegistry.registerType(type, {
        type: type,
        category: ModuleCategory.CAPABILITY,
        layer: ModuleLayer.DOMAIN,
        dependencies: ['game-engine', 'search-algorithm', 'pattern-recognition'],
        capabilities: [`${type}-capability`]
    });
});
```

## 타입 시스템의 장점

### 1. 확장성
- **무한 확장**: 새로운 도메인 모듈을 언제든 추가 가능
- **계층적 구조**: 명확한 계층 관계를 통한 의존성 관리
- **범주별 조직**: 모듈의 성격에 따른 체계적 분류

### 2. 유연성
- **런타임 등록**: 애플리케이션 실행 중 새로운 타입 등록
- **동적 검증**: 의존성과 호환성을 런타임에 검증
- **메타데이터 활용**: 타입 정보를 통한 자동화된 관리

### 3. 안전성
- **의존성 검증**: 순환 의존성 및 누락된 의존성 감지
- **계층 호환성**: 계층 간 호환성 자동 검증
- **타입 안전성**: 컴파일 타임 및 런타임 타입 검사

### 4. 가시성
- **명확한 분류**: 모듈의 역할과 위치가 타입에 명시
- **능력 명세**: 제공하는 capabilities가 명확히 정의
- **관계 파악**: 모듈 간 의존성과 상호작용 관계 추적

이러한 유연한 모듈 타입 시스템을 통해 Robota는 다양한 도메인과 용도에 맞는 에이전트를 구축할 수 있는 확장 가능한 플랫폼이 됩니다. 