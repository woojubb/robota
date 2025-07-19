# AI Provider 의존성 주입 아키텍처

## 📋 개요

각 AI Provider 구현체(OpenAI, Anthropic, Google)가 **의존성 주입**을 통해 로컬/원격 실행을 투명하게 전환할 수 있도록 하는 설계입니다. 
이를 통해 기존 Provider 인터페이스를 유지하면서도 **원격 실행 기능을 선택적으로 활성화**할 수 있습니다.

## 🎯 핵심 아이디어

### **투명한 전환** 🔄
```typescript
// 로컬 실행 (API Key 클라이언트에 노출)
const openai = new OpenAIProvider({ apiKey: 'sk-...' });

// 원격 실행 (API Key 서버에서 안전하게 관리!)
const openai = new OpenAIProvider({ 
  executor: new RemoteExecutor({ 
    serverUrl: 'https://api.robota.io',
    userApiKey: 'user-token-123'  // 실제 AI API Key 아님!
  })
});
```

### **API Key 보안 중심 설계** 🔒
- **로컬 실행**: 클라이언트에 실제 AI API Key 필요 (보안 위험)
- **원격 실행**: 서버에서만 실제 API Key 관리, 클라이언트는 사용자 토큰만 사용
- **완전한 API Key 격리**: 클라이언트 코드에서 OpenAI/Claude API Key 완전 제거

### **공통 인터페이스** 🔗
- 모든 Provider가 동일한 `ExecutorInterface` 사용
- 로컬/원격 전환 시 코드 변경 없음
- API Key 관리 방식만 달라짐 (로컬: 직접, 원격: 사용자 토큰)

### **유연한 구성** ⚙️
- **로컬 Executor**: 직접 API 호출 (API Key 필요)
- **원격 Executor**: 서버를 통한 프록시 호출 (사용자 토큰만 필요)
- **하이브리드 Executor**: 조건부 로컬/원격 전환
- **캐시 Executor**: 응답 캐싱 추가

## 🏗️ 아키텍처 설계

### **1. ExecutorInterface 정의**
```typescript
// packages/core/src/interfaces/executor.ts
export interface ExecutorInterface {
  /**
   * Execute a chat request with the specified parameters
   */
  executeChat(request: ChatExecutionRequest): Promise<AssistantMessage>;
  
  /**
   * Execute a streaming chat request
   */
  executeChatStream(request: ChatExecutionRequest): AsyncGenerator<string>;
  
  /**
   * Get provider-specific capabilities
   */
  getCapabilities(): ExecutorCapabilities;
  
  /**
   * Cleanup resources
   */
  close(): Promise<void>;
}

export interface ChatExecutionRequest {
  provider: string;                    // 'openai', 'anthropic', 'google'
  model: string;                       // 'gpt-4', 'claude-3-sonnet', etc.
  messages: UniversalMessage[];
  options?: ChatOptions;
  tools?: ToolSchema[];
  metadata?: Record<string, any>;      // Provider별 추가 정보
}

export interface ExecutorCapabilities {
  supportedProviders: string[];
  supportedFeatures: string[];         // ['streaming', 'tools', 'vision']
  maxTokens?: number;
  rateLimit?: RateLimitInfo;
}
```

### **2. LocalExecutor 구현**
```typescript
// packages/core/src/executors/local-executor.ts
export class LocalExecutor implements ExecutorInterface {
  private config: LocalExecutorConfig;
  
  constructor(config: LocalExecutorConfig) {
    this.config = config;
  }
  
  async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
    // 직접 AI Provider API 호출
    const apiClient = this.getApiClient(request.provider);
    return await apiClient.chat(request.messages, request.options, request.tools);
  }
  
  async *executeChatStream(request: ChatExecutionRequest): AsyncGenerator<string> {
    const apiClient = this.getApiClient(request.provider);
    for await (const chunk of apiClient.chatStream(request.messages, request.options, request.tools)) {
      yield chunk;
    }
  }
  
  getCapabilities(): ExecutorCapabilities {
    return {
      supportedProviders: ['openai', 'anthropic', 'google'],
      supportedFeatures: ['streaming', 'tools', 'vision'],
      maxTokens: this.config.maxTokens,
    };
  }
  
  private getApiClient(provider: string) {
    // 실제 API 클라이언트 반환 (OpenAI SDK, Anthropic SDK 등)
    switch (provider) {
      case 'openai':
        return new OpenAI({ apiKey: this.config.apiKeys.openai });
      case 'anthropic':
        return new Anthropic({ apiKey: this.config.apiKeys.anthropic });
      case 'google':
        return new GoogleGenerativeAI(this.config.apiKeys.google);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
  
  async close(): Promise<void> {
    // 리소스 정리
  }
}
```

### **3. RemoteExecutor 구현**
```typescript
// packages/remote/src/executors/remote-executor.ts
export class RemoteExecutor implements ExecutorInterface {
  private client: RemoteAPIClient;
  private config: RemoteExecutorConfig;
  
  constructor(config: RemoteExecutorConfig) {
    this.config = config;
    this.client = new RemoteAPIClient(config);
  }
  
  async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
    // 원격 서버로 요청 전송
    const response = await this.client.request({
      endpoint: '/ai/chat',
      method: 'POST',
      data: request
    });
    
    return response;
  }
  
  async *executeChatStream(request: ChatExecutionRequest): AsyncGenerator<string> {
    // WebSocket 또는 SSE로 스트리밍
    const stream = await this.client.requestStream({
      endpoint: '/ai/chat/stream',
      data: request
    });
    
    for await (const chunk of stream) {
      yield chunk;
    }
  }
  
  getCapabilities(): ExecutorCapabilities {
    // 서버에서 지원하는 기능 조회
    return this.config.capabilities || {
      supportedProviders: ['openai', 'anthropic', 'google'],
      supportedFeatures: ['streaming', 'tools', 'vision'],
    };
  }
  
  async close(): Promise<void> {
    await this.client.disconnect();
  }
}
```

### **4. 기존 Provider들 업데이트**
```typescript
// packages/openai/src/provider.ts
export class OpenAIProvider extends BaseAIProvider {
  override readonly name = 'openai';
  override readonly version = '2.0.0';
  
  private executor: ExecutorInterface;
  private config: OpenAIProviderOptions;
  
  constructor(options: OpenAIProviderOptions) {
    super();
    this.config = options;
    
    // Executor 주입 또는 기본 LocalExecutor 사용
    if (options.executor) {
      // 원격 실행: API Key 서버에서 관리
      this.executor = options.executor;
    } else {
      // 로컬 실행: API Key 필수
      if (!options.apiKey) {
        throw new Error('API Key is required for local execution');
      }
      this.executor = new LocalExecutor({
        apiKeys: { openai: options.apiKey },
        maxTokens: options.maxTokens
      });
    }
  }
  
  override async chat(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): Promise<AssistantMessage> {
    // Executor에 위임
    return await this.executor.executeChat({
      provider: 'openai',
      model: options?.model || this.config.defaultModel || 'gpt-4',
      messages,
      options,
      tools,
      metadata: {
        // 로컬 실행시에만 API Key 전달, 원격 실행시에는 서버에서 관리
        ...(this.config.apiKey && { apiKey: this.config.apiKey }),
        ...this.config.metadata
      }
    });
  }
  
  override async *chatStream(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): AsyncGenerator<string> {
    // Executor에 위임
    for await (const chunk of this.executor.executeChatStream({
      provider: 'openai',
      model: options?.model || this.config.defaultModel || 'gpt-4',
      messages,
      options,
      tools,
              metadata: {
          // 로컬 실행시에만 API Key 전달, 원격 실행시에는 서버에서 관리
          ...(this.config.apiKey && { apiKey: this.config.apiKey }),
          ...this.config.metadata
        }
    })) {
      yield chunk;
    }
  }
  
  override async close(): Promise<void> {
    await this.executor.close();
  }
}

// 타입 정의 업데이트
export interface OpenAIProviderOptions {
  // API Key는 로컬 실행시에만 필수, 원격 실행시에는 선택사항
  apiKey?: string;
  defaultModel?: string;
  maxTokens?: number;
  timeout?: number;
  
  // 🆕 Executor 주입 옵션 (원격 실행시 필수)
  executor?: ExecutorInterface;
  
  // Provider별 메타데이터
  metadata?: Record<string, any>;
}
```

## 🔄 사용 예시

### **1. 기본 로컬 사용 (기존과 동일)**
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';

const openai = new OpenAIProvider({
  apiKey: 'sk-...'
});

// 로컬에서 직접 OpenAI API 호출
const response = await openai.chat([{ role: 'user', content: 'Hello' }]);
```

### **2. 원격 실행으로 전환 (API Key 보안)**
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { RemoteExecutor } from '@robota-sdk/remote';

// 원격 Executor 생성 (사용자 토큰만 필요)
const remoteExecutor = new RemoteExecutor({
  serverUrl: 'https://api.robota.io',
  userApiKey: 'user-token-123',  // 실제 OpenAI API Key 아님!
  timeout: 30000
});

// API Key 없이 Provider 생성 (서버에서 관리)
const openai = new OpenAIProvider({
  // apiKey 없음! 서버에서 안전하게 관리
  executor: remoteExecutor
});

// 서버를 통해 OpenAI API 호출 (실제 API Key는 클라이언트에 노출 안됨!)
const response = await openai.chat([{ role: 'user', content: 'Hello' }]);
```

### **3. 모든 Provider가 동일한 방식으로 보안 지원**
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import { RemoteExecutor } from '@robota-sdk/remote';

const remoteExecutor = new RemoteExecutor({
  serverUrl: 'https://api.robota.io',
  userApiKey: 'user-token-123'  // 사용자 인증 토큰
});

// 모든 Provider가 API Key 없이 원격 실행
const providers = [
  new OpenAIProvider({ executor: remoteExecutor }),      // OpenAI API Key 서버에서 관리
  new AnthropicProvider({ executor: remoteExecutor }),   // Claude API Key 서버에서 관리
  new GoogleProvider({ executor: remoteExecutor })       // Google API Key 서버에서 관리
];

// Robota에서 원격 Provider들 사용 (모든 API Key 보안 유지)
const robota = new Robota({
  name: 'SecureRemoteAgent',
  aiProviders: providers,
  defaultModel: { provider: 'openai', model: 'gpt-4' }
});
```

### **4. 하이브리드 Executor 예시**
```typescript
// packages/remote/src/executors/hybrid-executor.ts
export class HybridExecutor implements ExecutorInterface {
  private localExecutor: LocalExecutor;
  private remoteExecutor: RemoteExecutor;
  
  constructor(config: HybridExecutorConfig) {
    this.localExecutor = new LocalExecutor(config.local);
    this.remoteExecutor = new RemoteExecutor(config.remote);
  }
  
  async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
    // 조건에 따라 로컬/원격 선택
    if (this.shouldUseRemote(request)) {
      return await this.remoteExecutor.executeChat(request);
    } else {
      return await this.localExecutor.executeChat(request);
    }
  }
  
  private shouldUseRemote(request: ChatExecutionRequest): boolean {
    // 예: 토큰 수가 많으면 원격, 적으면 로컬
    const tokenCount = this.estimateTokens(request.messages);
    return tokenCount > 1000;
  }
}

// 사용
const hybridExecutor = new HybridExecutor({
  local: { apiKeys: { openai: 'sk-...' } },
  remote: { serverUrl: 'https://api.robota.io', apiKey: 'user-key' }
});

const openai = new OpenAIProvider({
  apiKey: 'sk-...',
  executor: hybridExecutor  // 자동으로 최적 실행 방식 선택
});
```

## 📦 패키지 구조 업데이트

### **@robota-sdk/core** (ExecutorInterface 추가)
```
packages/core/src/
├── interfaces/
│   ├── executor.ts              # 🆕 ExecutorInterface 정의
│   ├── provider.ts              # 기존 Provider 인터페이스
│   └── index.ts
├── executors/
│   ├── local-executor.ts        # 🆕 기본 로컬 실행
│   └── index.ts
└── index.ts
```

### **@robota-sdk/remote** (RemoteExecutor 추가)
```
packages/remote/src/
├── executors/
│   ├── remote-executor.ts       # 🆕 원격 실행
│   ├── hybrid-executor.ts       # 🆕 하이브리드 실행
│   └── cached-executor.ts       # 🆕 캐시 기능 추가
├── client/
│   ├── remote-api-client.ts     # 기존 클라이언트
│   └── stream-handler.ts        # 기존 스트리밍
└── index.ts
```

### **각 Provider 패키지 업데이트**
```
packages/openai/src/
├── provider.ts                  # 🔄 Executor 주입 지원
├── executors/
│   └── openai-local-executor.ts # 🆕 OpenAI 전용 로컬 실행
└── types.ts                     # 🔄 ExecutorInterface 포함
```

## 🎯 주요 이점

### **1. 완벽한 API Key 보안** 🔒
- **완전한 격리**: 클라이언트에서 실제 AI API Key 완전 제거
- **중앙 관리**: 서버에서만 모든 AI Provider API Key 관리
- **사용자 인증**: 사용자별 토큰으로만 서비스 접근

### **2. 투명한 개발자 경험** 🔍
- **동일한 인터페이스**: 로컬/원격 구분 없는 API
- **선택적 보안**: Executor 주입 여부로 보안 모드 전환
- **Drop-in Replacement**: Executor만 교체하면 즉시 보안 전환

### **3. 유연한 확장성** 🚀
- **다양한 Executor**: Local(노출), Remote(보안), Hybrid 등
- **Provider별 보안**: 각 Provider마다 개별 보안 설정
- **조건부 실행**: 상황에 따른 보안/비보안 전환

### **4. 점진적 보안 강화** 📈
- **기존 코드 보호**: LocalExecutor 기본 (기존 방식)
- **선택적 보안화**: 원하는 Provider만 보안 전환
- **단계적 마이그레이션**: API Key를 하나씩 서버로 이전

## 🚀 구현 우선순위

### **Phase 1: Core Infrastructure (1주)**
- [ ] `ExecutorInterface` 정의 및 타입 시스템
- [ ] `LocalExecutor` 기본 구현
- [ ] Core 패키지에 Executor 시스템 추가

### **Phase 2: Provider Integration (1주)**
- [ ] OpenAIProvider에 Executor 주입 지원 추가
- [ ] AnthropicProvider 업데이트
- [ ] GoogleProvider 업데이트
- [ ] 기존 호환성 100% 유지 확인

### **Phase 3: Remote Executor (1주)**
- [ ] `RemoteExecutor` 구현
- [ ] 원격 API 클라이언트 연동
- [ ] 스트리밍 지원 완성

### **Phase 4: Advanced Features (1주)**
- [ ] `HybridExecutor` 구현
- [ ] 캐시 기능 추가
- [ ] 에러 처리 및 재시도 로직

## 🔒 API Key 보안 시나리오

### **문제: 기존 방식의 보안 위험**
```typescript
// ❌ 위험: API Key가 클라이언트 코드에 노출
const openai = new OpenAIProvider({ 
  apiKey: 'sk-proj-abc123...' // 소스코드, 환경변수, 로그에 노출 위험
});

// 브라우저에서 실행시 개발자 도구에서 확인 가능
// 로그에 실수로 포함될 수 있음
// Git에 커밋될 위험
```

### **해결: 원격 실행으로 완전 격리**
```typescript
// ✅ 안전: 실제 API Key는 서버에만 존재
const openai = new OpenAIProvider({
  executor: new RemoteExecutor({
    serverUrl: 'https://api.robota.io',
    userApiKey: 'user_token_xyz789'  // 사용자 인증 토큰 (AI API Key 아님!)
  })
});

// 클라이언트 코드에는 AI API Key가 전혀 없음
// 서버에서만 실제 OpenAI API Key 사용
// 사용자별 권한 및 사용량 제어 가능
```

### **서버 측 API Key 관리**
```typescript
// server/src/config/api-keys.ts
export class APIKeyManager {
  private keys = {
    openai: process.env.OPENAI_API_KEY,      // 서버 환경변수에서만 로드
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY
  };
  
  getKey(provider: string, userId: string): string {
    // 사용자 권한 확인 후 API Key 반환
    if (!this.hasPermission(userId, provider)) {
      throw new Error('Access denied');
    }
    return this.keys[provider];
  }
  
  private hasPermission(userId: string, provider: string): boolean {
    // 사용자별 권한 체크
    // 사용량 제한 확인
    // 구독 상태 확인 등
    return true;
  }
}
```

이 설계를 통해 **완전한 API Key 보안**을 달성하면서도 **기존 Provider 인터페이스를 유지**할 수 있습니다! 🎉

### **핵심 보안 원칙** 🛡️
1. **Zero Trust**: 클라이언트에는 절대 실제 API Key 저장 안함
2. **서버 중심**: 모든 AI API Key는 서버에서만 관리
3. **사용자 인증**: 토큰 기반 접근 제어
4. **투명한 전환**: 기존 코드 수정 없이 보안 강화 