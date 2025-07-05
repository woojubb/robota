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
    // ❌ 이런 타입들은 더 이상 사용하지 않음 (필수 구성요소이거나 LLM이 이미 잘 하는 일)
    // CORE = 'core' → 내부 핵심 클래스
    // PROVIDER = 'provider' → 내부 핵심 클래스  
    // TOOL = 'tool' → 내부 핵심 클래스
    // REASONING = 'reasoning' → LLM이 이미 잘 하는 일
    // PERCEPTION = 'perception' → LLM이 이미 잘 하는 일
    
    // ✅ 실제 Module이 될 수 있는 타입들 (LLM이 할 수 없는 선택적 확장)
    STORAGE = 'storage',                    // 다양한 저장소 구현체
    VECTOR_SEARCH = 'vector-search',        // RAG용 벡터 검색
    FILE_PROCESSING = 'file-processing',    // 파일 파싱/처리
    MULTIMODAL = 'multimodal',             // 멀티모달 AI 처리
    DATABASE = 'database',                  // 실시간 DB 연동
    API_INTEGRATION = 'api-integration',    // 외부 API 연동
    SPEECH_PROCESSING = 'speech-processing', // 음성 입출력
    IMAGE_ANALYSIS = 'image-analysis',      // 이미지 분석
    TRANSPORT = 'transport'                 // 네트워크 전송
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
export class ModuleRegistry {
    private static modules = new Map<string, BaseModule>();
    
    static register<T extends BaseModule>(module: T): void {
        this.modules.set(module.name, module);
    }
    
    static get<T extends BaseModule>(name: string): T | undefined {
        return this.modules.get(name) as T;
    }
    
    static getAvailable(): string[] {
        return Array.from(this.modules.keys());
    }
    
    static isAvailable(name: string): boolean {
        return this.modules.has(name);
    }
}

// 간단한 Module 인터페이스
export abstract class BaseModule {
    abstract readonly name: string;
    abstract readonly version: string;
    
    abstract initialize(config?: any): Promise<void>;
    abstract dispose(): Promise<void>;
    
    // 선택적 메타데이터 (너무 복잡하지 않게)
    getCapabilities?(): string[];
    getDependencies?(): string[];
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
**다른 모듈의 기반이 되는 기술 (선택적 확장)**

- **Storage**: 다양한 저장소 구현체 (없어도 메모리 기반 동작)
- **Transport**: 네트워크 통신 기반 (없어도 로컬 동작)

### Capability Modules  
**LLM이 할 수 없는 새로운 능력을 제공 (선택적 확장)**

- **Vector Search**: RAG를 위한 벡터 검색 능력 (없어도 일반 대화 가능)
- **File Processing**: PDF, 이미지, 오디오 처리 능력 (없어도 텍스트 대화 가능)
- **MultiModal**: 이미지+텍스트 AI 처리 능력 (없어도 텍스트만 처리)
- **Database**: 실시간 DB 연동 능력 (없어도 기본 대화 가능)
- **Speech Processing**: 음성 입출력 능력 (없어도 텍스트 대화 가능)
- **Image Analysis**: 이미지 분석 능력 (없어도 텍스트 대화 가능)

### Integration Modules
**여러 기능을 통합하는 확장 (선택적)**

- **API Integration**: 외부 API 통합 (없어도 기본 기능 동작)
- **Multi-modal Processing**: 다중 모달 처리 통합
- **Data Pipeline**: 데이터 파이프라인 통합

### ❌ Module이 될 수 없는 것들 (내부 핵심 클래스)
**이런 것들은 필수 구성요소이므로 Module 불가:**

- **AI Providers**: 대화 자체가 불가능해짐
- **Tool Execution**: 함수 호출 로직이 깨짐  
- **Message Processing**: 메시지 변환이 안됨
- **Session Management**: 세션 관리가 안됨
- **Reasoning/Planning/Learning**: LLM이 이미 잘 하는 일

## 동적 모듈 타입 등록 예시

### 실시간 타입 등록
```typescript
// 실제 필요한 모듈 타입 등록 (LLM이 할 수 없는 일들)
ModuleRegistry.registerType('web-scraping', {
    type: 'web-scraping',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.APPLICATION,
    dependencies: ['transport'],
    capabilities: ['webpage-parsing', 'content-extraction', 'link-crawling']
});

// 금융 데이터 연동 모듈 (외부 API 접근)
ModuleRegistry.registerType('financial-data', {
    type: 'financial-data',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.APPLICATION,
    dependencies: ['api-integration', 'database'],
    capabilities: ['market-data-access', 'price-tracking', 'financial-feeds']
});

// 실시간 통신 모듈 (LLM이 할 수 없는 네트워크 통신)
ModuleRegistry.registerType('realtime-communication', {
    type: 'realtime-communication',
    category: ModuleCategory.CAPABILITY,
    layer: ModuleLayer.APPLICATION,
    dependencies: ['transport'],
    capabilities: ['websocket-connection', 'push-notifications', 'live-streaming']
});
```

### 도메인별 모듈 세트
```typescript
// 의료 데이터 접근 모듈들 (LLM이 할 수 없는 외부 데이터 연동)
const medicalModuleTypes = [
    'medical-database',      // 의료 DB 실시간 조회
    'drug-api',             // 약물 정보 API 연동
    'diagnostic-imaging',   // 의료 영상 처리
    'patient-records',      // 환자 기록 시스템 연동
    'lab-results-api'       // 검사 결과 API 연동
];

medicalModuleTypes.forEach(type => {
    ModuleRegistry.registerType(type, {
        type: type,
        category: ModuleCategory.CAPABILITY,
        layer: ModuleLayer.APPLICATION,
        dependencies: ['database', 'api-integration'],
        capabilities: [`${type}-data-access`]
    });
});

// 실시간 게임 연동 모듈들 (LLM이 할 수 없는 게임 엔진 연동)
const gameModuleTypes = [
    'game-engine-api',      // 게임 엔진 연동
    'player-stats-api',     // 플레이어 통계 API
    'matchmaking-service',  // 매치메이킹 서비스 연동
    'leaderboard-api',      // 리더보드 API 연동
    'tournament-data'       // 토너먼트 데이터 연동
];

gameModuleTypes.forEach(type => {
    ModuleRegistry.registerType(type, {
        type: type,
        category: ModuleCategory.CAPABILITY,
        layer: ModuleLayer.APPLICATION,
        dependencies: ['api-integration', 'realtime-communication'],
        capabilities: [`${type}-integration`]
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