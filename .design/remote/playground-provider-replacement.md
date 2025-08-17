# 플레이그라운드 Provider 교체 전략

## 🎯 핵심 원칙: 기존 패키지 보호

### **왜 방안 1이 최적인가?** ⭐

#### **✅ 방안 1: Provider 교체 (선택됨)**
- **기존 패키지 보호**: OpenAI, Anthropic, Google 패키지 변경 없음
- **완전한 투명성**: 개발자는 전혀 눈치채지 못함
- **깔끔한 분리**: 플레이그라운드 로직과 core 로직 완전 분리
- **유지보수성**: 각 환경별 독립적 개발 가능

#### **❌ 방안 2, 3이 문제인 이유**
```typescript
// ❌ 방안 2: 런타임 주입 - 전역 오염
window.__ROBOTA_PLAYGROUND_EXECUTOR__ = executor; // 전역 변수 오염

// ❌ 방안 3: 환경 감지 - 인위적 로직
if (this.isPlaygroundEnvironment()) { // 불필요한 복잡성
  // 플레이그라운드 로직
} else {
  // 일반 로직
}
```

## 🏗️ 구현 전략: 투명한 Provider 교체

### **1. 플레이그라운드 전용 패키지 구조**
```
packages/playground/
├── src/
│   ├── providers/
│   │   ├── playground-openai-provider.ts    # OpenAI 래퍼
│   │   ├── playground-anthropic-provider.ts # Anthropic 래퍼
│   │   ├── playground-google-provider.ts    # Google 래퍼
│   │   └── base-playground-provider.ts      # 공통 로직
│   ├── executors/
│   │   └── playground-executor.ts           # 플레이그라운드 전용 실행
│   ├── bundle/
│   │   └── playground-bundle.ts             # 번들링 설정
│   └── index.ts
├── package.json
└── README.md
```

### **2. PlaygroundOpenAIProvider 구현**
```typescript
// packages/playground/src/providers/playground-openai-provider.ts
import { BaseAIProvider, UniversalMessage, AssistantMessage, ChatOptions, ToolSchema } from '@robota-sdk/core';
import { PlaygroundExecutor } from '../executors/playground-executor';

export class PlaygroundOpenAIProvider extends BaseAIProvider {
  override readonly name = 'openai';
  override readonly version = '1.0.0';
  
  private executor: PlaygroundExecutor;
  private config: PlaygroundProviderConfig;
  
  constructor(options: any) {
    super();
    
    // 사용자가 제공한 옵션은 무시하고 플레이그라운드 설정 사용
    this.config = {
      ...options,
      // 플레이그라운드 전용 설정으로 override
    };
    
    this.executor = new PlaygroundExecutor({
      provider: 'openai',
      serverUrl: process.env.PLAYGROUND_API_URL,
      sessionToken: this.getPlaygroundSessionToken()
    });
  }
  
  override async chat(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): Promise<AssistantMessage> {
    // 플레이그라운드 서버로 요청 전송
    return await this.executor.executeChat({
      provider: 'openai',
      model: options?.model || 'gpt-4',
      messages,
      options,
      tools
    });
  }
  
  override async *chatStream(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): AsyncGenerator<string> {
    // 플레이그라운드 서버로 스트리밍 요청
    for await (const chunk of this.executor.executeChatStream({
      provider: 'openai',
      model: options?.model || 'gpt-4',
      messages,
      options,
      tools
    })) {
      yield chunk;
    }
  }
  
  private getPlaygroundSessionToken(): string {
    // 플레이그라운드 세션에서 토큰 추출
    return (window as any).__PLAYGROUND_SESSION_TOKEN__ || 'anonymous';
  }
  
  override async close(): Promise<void> {
    await this.executor.close();
  }
}
```

### **3. PlaygroundExecutor 구현**
```typescript
// packages/playground/src/executors/playground-executor.ts
export class PlaygroundExecutor {
  private client: PlaygroundAPIClient;
  private config: PlaygroundExecutorConfig;
  
  constructor(config: PlaygroundExecutorConfig) {
    this.config = config;
    this.client = new PlaygroundAPIClient({
      serverUrl: config.serverUrl,
      sessionToken: config.sessionToken
    });
  }
  
  async executeChat(request: PlaygroundChatRequest): Promise<AssistantMessage> {
    // 플레이그라운드 서버로 요청
    const response = await this.client.request({
      endpoint: '/playground/ai/chat',
      method: 'POST',
      data: {
        ...request,
        sessionId: this.config.sessionToken,
        timestamp: Date.now()
      }
    });
    
    return response;
  }
  
  async *executeChatStream(request: PlaygroundChatRequest): AsyncGenerator<string> {
    // WebSocket 연결로 스트리밍
    const stream = await this.client.requestStream({
      endpoint: '/playground/ai/chat/stream',
      data: {
        ...request,
        sessionId: this.config.sessionToken
      }
    });
    
    for await (const chunk of stream) {
      yield chunk;
    }
  }
  
  async close(): Promise<void> {
    await this.client.disconnect();
  }
}
```

## 📦 플레이그라운드 번들 생성

### **4. 번들링 전략**
```typescript
// packages/playground/src/bundle/playground-bundle.ts
export { PlaygroundOpenAIProvider as OpenAIProvider } from '../providers/playground-openai-provider';
export { PlaygroundAnthropicProvider as AnthropicProvider } from '../providers/playground-anthropic-provider';
export { PlaygroundGoogleProvider as GoogleProvider } from '../providers/playground-google-provider';

// 다른 패키지들은 원본 그대로 re-export
export * from '@robota-sdk/agents';
export * from '@robota-sdk/sessions';
export * from '@robota-sdk/team';
export * from '@robota-sdk/core';
```

### **5. 플레이그라운드 웹팩 설정**
```javascript
// apps/web/webpack.playground.config.js
module.exports = {
  resolve: {
    alias: {
      // 플레이그라운드에서만 Provider 교체
      '@robota-sdk/openai': path.resolve(__dirname, '../../packages/playground/src/providers/playground-openai-provider'),
      '@robota-sdk/anthropic': path.resolve(__dirname, '../../packages/playground/src/providers/playground-anthropic-provider'),
      '@robota-sdk/google': path.resolve(__dirname, '../../packages/playground/src/providers/playground-google-provider'),
    }
  },
  // 나머지 설정...
};
```

## 🔄 개발자 경험

### **개발자가 보는 코드 (변화 없음)**
```typescript
// 플레이그라운드에서 생성된 코드
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const robota = new Robota({
  name: 'ChatBot',
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: 'your-openai-api-key'  // 플레이스홀더
    })
  ],
  defaultModel: { provider: 'openai', model: 'gpt-4' }
});

const response = await robota.run('Hello!');
```

### **플레이그라운드에서 실제 동작**
```typescript
// 내부적으로는 PlaygroundOpenAIProvider가 실행됨
// 1. apiKey는 무시됨
// 2. PlaygroundExecutor가 원격 서버로 요청
// 3. 개발자는 전혀 모름
// 4. 결과만 정상적으로 받음
```

### **로컬에서 복사 후 사용**
```typescript
// 동일한 코드, 다른 패키지
import { OpenAIProvider } from '@robota-sdk/openai'; // 진짜 OpenAIProvider

const robota = new Robota({
  name: 'ChatBot',
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: process.env.OPENAI_API_KEY  // 실제 키 필요
    })
  ]
});
```

## 🚀 배포 전략

### **빌드 프로세스**
```bash
# 1. 일반 패키지 빌드 (변화 없음)
npm run build:packages

# 2. 플레이그라운드 전용 빌드
npm run build:playground

# 3. 웹 앱에서 플레이그라운드 번들 사용
npm run build:web -- --playground
```

### **패키지 분리**
```json
// package.json dependencies
{
  "dependencies": {
    "@robota-sdk/agents": "^1.0.0",
    "@robota-sdk/sessions": "^1.0.0",
    "@robota-sdk/team": "^1.0.0"
  },
  "devDependencies": {
    "@robota-sdk/playground": "^1.0.0"  // 개발용만
  }
}
```

## 🎯 핵심 이점

### **1. 완전한 투명성** 🔍
- 개발자는 Provider 교체를 전혀 눈치채지 못함
- 코드는 완전히 동일함
- 동작도 완전히 동일함 (결과만 보면)

### **2. 기존 패키지 보호** 🛡️
- OpenAI, Anthropic, Google 패키지 수정 없음
- 기존 사용자에게 영향 없음
- 버전 관리 독립적

### **3. 유지보수성** 🔧
- 플레이그라운드 로직과 core 로직 완전 분리
- 각각 독립적으로 개발/배포 가능
- 문제 발생 시 격리된 디버깅

### **4. 확장성** 🚀
- 새로운 Provider 쉽게 추가
- 플레이그라운드 전용 기능 자유롭게 개발
- A/B 테스트나 실험적 기능 안전하게 적용

## 🎉 최종 결과

### **개발자 여정 (완벽함)** ✨
1. **플레이그라운드**: 코드 생성 → 바로 실행 (원격)
2. **코드 복사**: 동일한 코드 그대로 복사
3. **로컬 실행**: 환경변수만 설정하면 바로 동작 (로컬)

### **기술적 완벽성** 🔧
- ✅ **기존 패키지 무수정**
- ✅ **완전한 투명성**  
- ✅ **깔끔한 분리**
- ✅ **독립적 유지보수**

**방안 1**으로 **개발자도 모르게** 플레이그라운드에서는 원격 실행, 로컬에서는 로컬 실행이 자연스럽게 이루어지는 **완벽한 시스템**이 완성됩니다! 🚀 