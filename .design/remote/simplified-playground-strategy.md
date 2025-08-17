# 간소화된 플레이그라운드 전략: BaseAIProvider Executor 주입

## 🎯 핵심 아이디어: 기존 Provider 그대로, Executor만 교체

### **문제점: 기존 방안의 복잡성** ❌
- 플레이그라운드 전용 Provider 클래스 생성 필요
- 웹팩 별칭 설정 복잡
- 번들링 전략 복잡
- 유지보수 부담 증가

### **해결책: BaseAIProvider Executor 주입** ✅
- BaseAIProvider에 executor 옵션 추가
- 플레이그라운드에서 executor만 주입
- 코드는 완전히 동일, 실행만 다름
- 복잡한 Provider 교체 불필요

## 🏗️ 구현 전략: 최소한의 변경

### **1. BaseAIProvider 업데이트**
```typescript
// packages/core/src/abstracts/base-ai-provider.ts
export abstract class BaseAIProvider {
  protected executor: ExecutorInterface;
  
  constructor(executor: ExecutorInterface) {
    this.executor = executor;
  }
  
  // 추상 메서드들...
  abstract chat(messages: UniversalMessage[], options?: ChatOptions, tools?: ToolSchema[]): Promise<AssistantMessage>;
  abstract chatStream(messages: UniversalMessage[], options?: ChatOptions, tools?: ToolSchema[]): AsyncGenerator<string>;
}
```

### **2. OpenAIProvider 업데이트 (올바른 설계)**
```typescript
// packages/openai/src/provider.ts
export class OpenAIProvider extends BaseAIProvider {
  override readonly name = 'openai';
  override readonly version = '2.0.0';
  
  private config: OpenAIProviderOptions;
  
  constructor(options: OpenAIProviderOptions) {
    // executor 주입되면 사용, 없으면 기본 LocalExecutor 생성
    const executor = options.executor || new LocalExecutor(options);
    
    super(executor);
    this.config = options;
  }
  
  override async chat(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): Promise<AssistantMessage> {
    return await this.executor.executeChat({
      provider: 'openai',
      model: options?.model || this.config.defaultModel || 'gpt-4',
      messages,
      options,
      tools,
      metadata: this.config.metadata
    });
  }
  
  override async *chatStream(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): AsyncGenerator<string> {
    for await (const chunk of this.executor.executeChatStream({
      provider: 'openai',
      model: options?.model || this.config.defaultModel || 'gpt-4',
      messages,
      options,
      tools,
      metadata: this.config.metadata
    })) {
      yield chunk;
    }
  }
}

// 타입 정의 업데이트
export interface OpenAIProviderOptions {
  apiKey?: string;                    // LocalExecutor용 (executor 없을 때)
  defaultModel?: string;
  maxTokens?: number;
  timeout?: number;
  executor?: ExecutorInterface;       // 🆕 주입된 executor (선택사항)
  metadata?: Record<string, any>;
}

// LocalExecutor 구현 예시
export class LocalExecutor implements ExecutorInterface {
  private config: OpenAIProviderOptions;
  
  constructor(config: OpenAIProviderOptions) {
    this.config = config;
  }
  
  async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
    // config.apiKey를 사용해서 직접 OpenAI API 호출
    const openai = new OpenAI({ apiKey: this.config.apiKey });
    return await openai.chat.completions.create({
      model: request.model,
      messages: request.messages,
      ...request.options
    });
  }
  
  async *executeChatStream(request: ChatExecutionRequest): AsyncGenerator<string> {
    const openai = new OpenAI({ apiKey: this.config.apiKey });
    const stream = await openai.chat.completions.create({
      model: request.model,
      messages: request.messages,
      stream: true,
      ...request.options
    });
    
    for await (const chunk of stream) {
      yield chunk.choices[0]?.delta?.content || '';
    }
  }
  
  getCapabilities(): ExecutorCapabilities {
    return {
      supportedProviders: ['openai'],
      supportedFeatures: ['streaming', 'tools', 'vision']
    };
  }
  
  async close(): Promise<void> {
    // 리소스 정리 (필요시)
  }
}
```

## 🎭 플레이그라운드 구현

### **3. 플레이그라운드에서 Executor 주입**
```typescript
// apps/web/src/lib/playground/code-executor.ts
import { RemoteExecutor } from '@robota-sdk/remote';

export class PlaygroundCodeExecutor {
  private remoteExecutor: RemoteExecutor;
  
  constructor() {
    this.remoteExecutor = new RemoteExecutor({
      serverUrl: process.env.NEXT_PUBLIC_PLAYGROUND_API_URL!,
      userApiKey: this.getPlaygroundUserToken(),
      isPlaygroundMode: true
    });
  }
  
  async executeCode(code: string): Promise<any> {
    // 사용자 코드 실행 전에 전역에 executor 주입
    const originalCode = this.injectExecutor(code);
    
    // 사용자 코드 실행
    return await this.runInSandbox(originalCode);
  }
  
  private injectExecutor(code: string): string {
    // 코드에서 Provider 생성 부분을 찾아서 executor 주입
    return code.replace(
      /new (OpenAIProvider|AnthropicProvider|GoogleProvider)\s*\(\s*{([^}]*)}\s*\)/g,
      (match, providerName, options) => {
        // 기존 옵션에 executor 추가
        return `new ${providerName}({ ${options}, executor: __PLAYGROUND_EXECUTOR__ })`;
      }
    );
  }
  
  private async runInSandbox(code: string): Promise<any> {
    // 샌드박스 환경에서 실행
    const sandbox = {
      __PLAYGROUND_EXECUTOR__: this.remoteExecutor,
      // 기타 필요한 imports들...
    };
    
    return await vm.runInNewContext(code, sandbox);
  }
  
  private getPlaygroundUserToken(): string {
    // 플레이그라운드 사용자 토큰 반환
    return 'playground-session-token';
  }
}
```

### **4. 더 간단한 방법: 런타임 주입**
```typescript
// apps/web/src/lib/playground/runtime-injection.ts
export function setupPlaygroundEnvironment() {
  // 전역에 플레이그라운드 executor 설정
  (window as any).__PLAYGROUND_EXECUTOR__ = new RemoteExecutor({
    serverUrl: process.env.NEXT_PUBLIC_PLAYGROUND_API_URL!,
    userApiKey: getCurrentUserToken()
  });
}

// Provider 클래스들이 플레이그라운드 환경을 감지하도록 수정
export class OpenAIProvider extends BaseAIProvider {
  constructor(options: OpenAIProviderOptions) {
    // 플레이그라운드 환경이면 자동으로 executor 주입
    const playgroundExecutor = (window as any).__PLAYGROUND_EXECUTOR__;
    const finalOptions = {
      ...options,
      executor: options.executor || playgroundExecutor
    };
    
    super(finalOptions.executor);
    // 나머지 로직...
  }
}
```

## 🔄 사용자 경험

### **개발자가 작성하는 코드 (변화 없음)**
```typescript
// 플레이그라운드와 로컬 모두 동일한 코드
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const robota = new Robota({
  name: 'ChatBot',
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: 'your-openai-api-key'
    })
  ],
  defaultModel: { provider: 'openai', model: 'gpt-4' }
});

const response = await robota.run('Hello!');
```

### **플레이그라운드에서 실제 동작**
```typescript
// 런타임에 자동으로 executor 주입됨
new OpenAIProvider({ 
  apiKey: 'your-openai-api-key',
  executor: playgroundExecutor  // 🎭 자동 주입!
});
// → 원격 서버로 실행됨
```

### **로컬에서 동작**
```typescript
// executor 주입 없이 그대로 실행
new OpenAIProvider({ 
  apiKey: process.env.OPENAI_API_KEY
});
// → 로컬에서 직접 OpenAI API 호출
```

## 📦 구현 방법 비교

### **방법 1: 코드 변환 (권장)** ⭐
```typescript
// 플레이그라운드에서 실행 전 코드 자동 변환
const transformedCode = code.replace(
  /new OpenAIProvider\(({[^}]*})\)/g,
  'new OpenAIProvider({ ...$1, executor: __PLAYGROUND_EXECUTOR__ })'
);
```

**장점:**
- 사용자 코드 완전히 동일
- 로컬과 플레이그라운드 구분 없음
- 복잡한 환경 감지 불필요

### **방법 2: 환경 감지**
```typescript
// Provider 내부에서 환경 감지
constructor(options: OpenAIProviderOptions) {
  const isPlayground = this.detectPlaygroundEnvironment();
  const executor = isPlayground ? window.__PLAYGROUND_EXECUTOR__ : options.executor;
  
  super(executor);
}
```

**단점:**
- Provider에 플레이그라운드 로직 침투
- 환경 감지 복잡성 증가

## 🎯 최종 구현 전략

### **1. BaseAIProvider 업데이트** 
```typescript
// 모든 Provider가 executor 옵션 지원
export abstract class BaseAIProvider {
  protected executor?: ExecutorInterface;
  constructor(executor?: ExecutorInterface) {
    this.executor = executor;
  }
}
```

### **2. 플레이그라운드 코드 변환**
```typescript
// 실행 전 자동으로 executor 주입
function injectPlaygroundExecutor(userCode: string): string {
  return userCode.replace(
    /new (OpenAIProvider|AnthropicProvider|GoogleProvider)\s*\(\s*({[^}]*})\s*\)/g,
    'new $1({ ...$2, executor: __PLAYGROUND_EXECUTOR__ })'
  );
}
```

### **3. 사용자 경험 (완벽한 투명성)**
- **플레이그라운드**: 코드 → 자동 변환 → 원격 실행
- **로컬**: 동일한 코드 → 그대로 실행 → 로컬 실행
- **개발자**: 차이점을 전혀 느끼지 못함

## 🎉 핵심 이점

### **1. 극도의 간단함** ✨
- BaseAIProvider에 executor 옵션만 추가
- 복잡한 Provider 교체 불필요
- 웹팩 설정 변경 불필요

### **2. 완벽한 투명성** 🔍
- 사용자 코드 완전히 동일
- 로컬과 플레이그라운드 구분 없음
- 자연스러운 전환

### **3. 최소한의 변경** 🛡️
- 기존 Provider 인터페이스 거의 유지
- 기존 사용자에게 영향 없음
- 점진적 마이그레이션 가능

### **4. 확장성** 🚀
- 모든 Provider에 일관되게 적용
- 새로운 Provider 쉽게 추가
- 다양한 Executor 타입 지원

이 방법이 **가장 간단하고 우아한 해결책**입니다! 복잡한 Provider 교체 없이 **BaseAIProvider에 executor 옵션만 추가**하면 모든 문제가 해결되네요! 🎯✨ 