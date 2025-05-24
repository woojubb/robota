# 코드 개선사항

Robota 라이브러리는 지속적인 개선을 통해 코드 품질과 개발자 경험을 향상시키고 있습니다. 이 문서에서는 리팩토링 및 코드 개선 작업에 대한 상세 내용을 제공합니다.

## 구조적 개선사항

### 모듈화 및 분리

코드베이스는 다음과 같이 논리적으로 분리되어 있습니다:

```
robota/
├── packages/           # 핵심 패키지
│   ├── core/           # 코어 기능
│   │   ├── managers/   # 기능별 매니저 클래스
│   │   ├── services/   # 비즈니스 로직 서비스
│   │   ├── interfaces/ # 타입 정의 및 인터페이스
│   │   └── utils/      # 유틸리티 함수
│   ├── openai/         # OpenAI 통합
│   ├── anthropic/      # Anthropic 통합
│   ├── mcp/            # MCP 구현
│   ├── tools/          # 도구 시스템
│   └── ...
└── apps/               # 응용 프로그램
    ├── docs/           # 문서 애플리케이션
    └── examples/       # 예제 코드
```

### 매니저 패턴 도입

코어 기능이 책임별로 분리된 매니저 클래스들로 구성되어 있습니다:

```typescript
export class Robota {
    // 매니저들
    private aiProviderManager: AIProviderManager;
    private toolProviderManager: ToolProviderManager;
    private systemMessageManager: SystemMessageManager;
    private functionCallManager: FunctionCallManager;
    private conversationService: ConversationService;
    
    // 기본 설정
    private memory: Memory;
    private onToolCall?: (toolName: string, params: any, result: any) => void;
    private logger: Logger;
    private debug: boolean;
}
```

#### AIProviderManager
AI 제공업체들의 등록, 관리, 선택을 담당합니다:

```typescript
export class AIProviderManager {
    addProvider(name: string, aiProvider: AIProvider): void;
    setCurrentAI(providerName: string, model: string): void;
    getAvailableAIs(): Record<string, string[]>;
    getCurrentAI(): { provider?: string; model?: string };
    isConfigured(): boolean;
}
```

#### ToolProviderManager
도구 제공자들과 도구 호출을 관리합니다:

```typescript
export class ToolProviderManager {
    addProviders(providers: ToolProvider[]): void;
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;
    getAvailableTools(): any[];
    setAllowedFunctions(functions: string[]): void;
}
```

#### SystemMessageManager
시스템 프롬프트와 시스템 메시지들을 관리합니다:

```typescript
export class SystemMessageManager {
    setSystemPrompt(prompt: string): void;
    setSystemMessages(messages: Message[]): void;
    addSystemMessage(content: string): void;
    getSystemPrompt(): string | undefined;
    getSystemMessages(): Message[] | undefined;
}
```

#### FunctionCallManager
함수 호출 설정과 모드를 관리합니다:

```typescript
export class FunctionCallManager {
    setFunctionCallMode(mode: FunctionCallMode): void;
    configure(config: FunctionCallConfig): void;
    getDefaultMode(): FunctionCallMode;
    isFunctionAllowed(functionName: string): boolean;
}
```

### 서비스 레이어 도입

비즈니스 로직이 서비스 클래스로 분리되어 있습니다:

#### ConversationService
AI와의 대화 처리를 담당합니다:

```typescript
export class ConversationService {
    prepareContext(memory: Memory, systemPrompt?: string, systemMessages?: Message[], options?: RunOptions): Context;
    generateResponse(aiProvider: AIProvider, model: string, context: Context, options: RunOptions, availableTools: any[], onToolCall?: Function): Promise<ModelResponse>;
    generateStream(aiProvider: AIProvider, model: string, context: Context, options: RunOptions, availableTools: any[]): Promise<AsyncIterable<StreamingResponseChunk>>;
}
```

이러한 모듈화는 다음과 같은 이점을 제공합니다:

1. **단일 책임 원칙**: 각 클래스가 명확한 책임을 가짐
2. **코드 재사용성**: 공통 기능이 적절히 분리되어 중복 코드가 감소
3. **유지보수성**: 한 모듈의 변경이 다른 모듈에 미치는 영향이 최소화
4. **테스트 용이성**: 독립적인 모듈은 단위 테스트가 용이
5. **번들 크기 최적화**: 사용자는 필요한 모듈만 가져와서 번들 크기를 최적화

### 인터페이스 개선

핵심 인터페이스들이 다음과 같이 개선되었습니다:

1. **AIProvider**: AI 모델과의 통신을 위한 표준화된, 확장 가능한 인터페이스 제공
2. **Memory**: 대화 기록 관리를 위한 명확한 계약 정의
3. **Tool**: 도구 정의 및 실행을 위한 확장 가능한 인터페이스

## 빌드 시스템 개선

### 테스트 파일 분리

빌드 시스템이 개선되어 테스트 파일들이 프로덕션 빌드에서 제외됩니다:

```json
// tsconfig.json - 프로덕션 빌드용
{
  "exclude": [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/**/*.spec.ts",
    "src/**/*.spec.tsx"
  ]
}

// tsconfig.test.json - 테스트용
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*"],
  "exclude": []
}
```

### 타입 시스템 정리

타입 정의가 적절한 위치로 이동되어 순환 의존성 문제가 해결되었습니다:

```typescript
// managers/function-call-manager.ts에 위치
export type FunctionCallMode = 'auto' | 'force' | 'disabled';
export interface FunctionCallConfig {
    defaultMode?: FunctionCallMode;
    maxCalls?: number;
    timeout?: number;
    allowedFunctions?: string[];
}
```

## 타입 시스템 개선

### 제네릭 타입 도입

```typescript
// 이전:
interface Tool {
  name: string;
  description?: string;
  execute: (...args: any[]) => Promise<any>;
}

// 개선:
interface Tool<TInput = any, TOutput = any> {
  name: string;
  description?: string;
  parameters?: ToolParameter[];
  execute: (input: TInput) => Promise<ToolResult<TOutput>>;
}
```

### 명시적 타입 검사 추가

```typescript
// 함수 매개변수 유효성 검사
registerFunction(schema: FunctionSchema, fn: Function): void {
  if (!schema || !schema.name) {
    throw new Error('유효한 함수 스키마가 필요합니다.');
  }
  if (typeof fn !== 'function') {
    throw new Error('두 번째 인자는 함수여야 합니다.');
  }
  
  // 구현...
}
```

## 코드 가독성 개선

### 주석 및 문서화

모든 주요 클래스, 메서드, 및 프로퍼티에 JSDoc 주석이 포함되어 있습니다:

```typescript
/**
 * 함수 호출 관리 클래스
 * 함수 호출 설정과 모드를 관리합니다.
 */
export class FunctionCallManager {
    /**
     * 함수 호출 모드 설정
     * 
     * @param mode - 함수 호출 모드 ('auto', 'force', 'disabled')
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        this.config.defaultMode = mode;
    }
}
```

### 일관된 메서드 그룹화

관련 메서드를 논리적 그룹으로 분류하여 코드 구조를 명확하게 했습니다:

```typescript
class Robota {
  // ============================================================
  // AI Provider 관리 (위임)
  // ============================================================
  addAIProvider() { /* ... */ }
  setCurrentAI() { /* ... */ }
  getAvailableAIs() { /* ... */ }
  
  // ============================================================
  // 시스템 메시지 관리 (위임)
  // ============================================================
  setSystemPrompt() { /* ... */ }
  setSystemMessages() { /* ... */ }
  addSystemMessage() { /* ... */ }
  
  // ============================================================
  // 함수 호출 관리 (위임)
  // ============================================================
  setFunctionCallMode() { /* ... */ }
  configureFunctionCall() { /* ... */ }
  
  // ============================================================
  // 실행 메서드
  // ============================================================
  run() { /* ... */ }
  chat() { /* ... */ }
  runStream() { /* ... */ }
  
  // ============================================================
  // 내부 헬퍼 메서드
  // ============================================================
  private generateResponse() { /* ... */ }
  private generateStream() { /* ... */ }
}
```

## 에러 처리 개선

에러 처리가 다양한 상황에서 더 구체적이고 유용한 피드백을 제공하도록 개선되었습니다:

```typescript
async generateResponse(context: any, options: RunOptions = {}): Promise<ModelResponse> {
    if (!this.aiProviderManager.isConfigured()) {
        throw new Error('현재 AI 제공업체와 모델이 설정되지 않았습니다. setCurrentAI() 메서드를 사용하여 설정하세요.');
    }

    try {
        // 응답 생성...
    } catch (error) {
        logger.error('AI 클라이언트 호출 중 오류 발생:', error);
        throw new Error(`AI 클라이언트 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
    }
}
```

## 테스트 개선

### 테스트 위치 및 구조

테스트 파일은 해당 구현 파일과 함께 배치하여 관리가 용이하도록 하였습니다:

```
packages/core/src/
  ├── memory.ts
  ├── memory.test.ts  // memory.ts에 대한 테스트
  ├── robota.ts
  └── robota.test.ts  // robota.ts에 대한 테스트
```

### 테스트 범위 확대

다음 영역에서 테스트 커버리지가 향상되었습니다:

1. **에지 케이스**: 비정상적인 입력과 경계 조건에 대한 테스트
2. **오류 상황**: 예외 발생 시 올바르게 처리되는지 확인
3. **통합 테스트**: 여러 컴포넌트가 함께 작동하는 시나리오 테스트

### 리팩토링된 구조에 맞는 테스트

테스트 코드가 새로운 매니저 기반 구조에 맞게 업데이트되었습니다:

```typescript
describe('Robota', () => {
    let mockProvider: MockProvider;
    let robota: Robota;

    beforeEach(() => {
        mockProvider = new MockProvider();
        robota = new Robota({ 
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model'
        });
    });

    it('함수 호출 설정으로 초기화되어야 함', () => {
        const customRobota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model',
            functionCallConfig
        });

        expect(customRobota['functionCallManager'].getDefaultMode()).toBe('auto');
        expect(customRobota['functionCallManager'].getMaxCalls()).toBe(5);
        expect(customRobota['functionCallManager'].getAllowedFunctions()).toEqual(['getWeather']);
    });
});
```

## API 디자인 개선

### 일관된 명명 규칙

모든 API는 일관된 명명 규칙을 따릅니다:

- 클래스: PascalCase (예: `AIProviderManager`, `FunctionCallManager`)
- 메서드: camelCase (예: `registerFunction`, `setSystemPrompt`)
- 상수: UPPER_SNAKE_CASE (예: `DEFAULT_TIMEOUT`, `MAX_TOKENS`)
- 타입/인터페이스: PascalCase (예: `ToolResult`, `FunctionSchema`)

### 의존성 주입과 위임 패턴

Robota 클래스는 의존성 주입을 통해 매니저들을 구성하고, 공개 API는 적절한 매니저에게 위임합니다:

```typescript
export class Robota {
    constructor(options: RobotaOptions) {
        // 매니저들 초기화
        this.aiProviderManager = new AIProviderManager();
        this.toolProviderManager = new ToolProviderManager(this.logger, options.functionCallConfig?.allowedFunctions);
        this.systemMessageManager = new SystemMessageManager();
        this.functionCallManager = new FunctionCallManager(options.functionCallConfig);
        this.conversationService = new ConversationService(options.temperature, options.maxTokens, this.logger, this.debug);
    }

    // AI Provider 관리를 AIProviderManager에 위임
    addAIProvider(name: string, aiProvider: AIProvider): void {
        this.aiProviderManager.addProvider(name, aiProvider);
    }

    // 시스템 메시지 관리를 SystemMessageManager에 위임
    setSystemPrompt(prompt: string): void {
        this.systemMessageManager.setSystemPrompt(prompt);
    }
}
```

### 메서드 체이닝 지원

```typescript
// 이전:
toolRegistry.register(tool1);
toolRegistry.register(tool2);

// 개선:
toolRegistry
  .register(tool1)
  .register(tool2);
```

## 성능 개선

### 메모리 최적화

메모리 관리 시스템이 개선되어 대화 기록을 효율적으로 저장하고 검색할 수 있습니다:

```typescript
class SimpleMemory implements Memory {
  private messages: Message[] = [];
  private maxMessages: number;
  
  constructor(options?: { maxMessages?: number }) {
    this.maxMessages = options?.maxMessages || 0;
  }
  
  addMessage(message: Message): void {
    this.messages.push(message);
    
    // 최대 메시지 수 제한 적용
    if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
      // 시스템 메시지는 항상 유지
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const nonSystemMessages = this.messages.filter(m => m.role !== 'system');
      
      // 비시스템 메시지만 잘라냄
      const remainingCount = this.maxMessages - systemMessages.length;
      const trimmedNonSystemMessages = nonSystemMessages.slice(-remainingCount);
      
      // 시스템 메시지와 잘라낸 비시스템 메시지 합치기
      this.messages = [...systemMessages, ...trimmedNonSystemMessages];
    }
  }
}
```

## 결론

이러한 코드 개선을 통해 Robota 라이브러리는 다음과 같은 이점을 제공합니다:

1. **더 나은 개발자 경험**: 직관적인 API와 명확한 문서화
2. **향상된 타입 안전성**: 컴파일 타임에 오류 발견
3. **더 높은 코드 품질**: 일관된 스타일과 설계 원칙
4. **확장성**: 새로운 기능과 통합을 쉽게 추가할 수 있음
5. **유지보수성**: 명확한 모듈 경계와 책임 분리
6. **테스트 용이성**: 각 매니저와 서비스를 독립적으로 테스트 가능
7. **빌드 최적화**: 테스트 파일이 프로덕션 빌드에서 제외되어 번들 크기 최적화

향후 개발 계획에는 추가 최적화, 더 많은 제공업체 지원, 그리고 고급 기능의 구현이 포함되어 있습니다. 