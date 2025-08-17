# 플레이그라운드 실행 전략: 투명한 원격 실행

## 📖 문제 상황 스토리텔링

### **시나리오: SaaS 플레이그라운드 딜레마** 🎭

#### **개발자 여정 1: 플레이그라운드에서 코드 생성**
```typescript
// 플레이그라운드에서 AI가 생성한 코드
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const robota = new Robota({
  name: 'ChatBot',
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: 'sk-proj-...' // 🚨 문제: 실제 API Key가 필요해 보임
    })
  ],
  defaultModel: { provider: 'openai', model: 'gpt-4' }
});

const response = await robota.run('Hello, world!');
console.log(response);
```

#### **개발자의 기대** 💭
> "이 코드를 복사해서 내 서버에 붙여넣으면 바로 동작하겠지?"

#### **현실의 벽** 🧱
1. **플레이그라운드에서**: API Key 없이 실행 불가능
2. **로컬에서**: 실제 OpenAI API Key 필요
3. **딜레마**: 플레이그라운드는 원격 실행이지만 코드는 로컬 실행처럼 보임

### **시나리오: 개발자의 혼란** 😵

#### **개발자 A의 경험**
```typescript
// 플레이그라운드에서 본 코드 (동작함)
const openai = new OpenAIProvider({ apiKey: 'sk-fake-key' });

// 로컬에서 복사해서 실행 (에러!)
const openai = new OpenAIProvider({ apiKey: 'sk-fake-key' });
// ❌ Error: Invalid API key
```

개발자: "플레이그라운드에서는 됐는데 왜 내 컴퓨터에서는 안 되지? 🤔"

#### **개발자 B의 경험**
```typescript
// 실제 API Key로 수정 후 실행
const openai = new OpenAIProvider({ apiKey: 'sk-real-key-123' });
// ✅ 동작하지만...

// 나중에 GitHub에 커밋
git add .
git commit -m "Add AI chatbot"
// 🚨 API Key가 GitHub에 노출됨!
```

개발자: "아! API Key를 실수로 커밋했네! 😱"

## 🎯 해결책: 플레이그라운드 전용 Provider

### **핵심 아이디어: 가짜 API Key로 진짜 실행** 🎭

```typescript
// packages/playground/src/providers/playground-openai-provider.ts
export class PlaygroundOpenAIProvider extends OpenAIProvider {
  constructor(options: OpenAIProviderOptions) {
    // 사용자가 제공한 API Key는 무시하고, 내부적으로 RemoteExecutor 사용
    const playgroundExecutor = new RemoteExecutor({
      serverUrl: process.env.PLAYGROUND_SERVER_URL,
      userApiKey: getPlaygroundUserToken(), // 플레이그라운드 사용자 토큰
      isPlaygroundMode: true
    });
    
    super({
      ...options,
      executor: playgroundExecutor // 🎭 진짜 실행은 원격으로
    });
  }
  
  // API Key 유효성 검사 무시 (플레이그라운드에서는 가짜 키도 허용)
  protected validateApiKey(apiKey: string): boolean {
    return true; // 어떤 키든 허용
  }
}
```

### **플레이그라운드 Provider Factory**
```typescript
// packages/playground/src/factory/provider-factory.ts
export function createPlaygroundProviders(): Record<string, any> {
  return {
    OpenAIProvider: PlaygroundOpenAIProvider,
    AnthropicProvider: PlaygroundAnthropicProvider,
    GoogleProvider: PlaygroundGoogleProvider
  };
}
```

## 🔄 플레이그라운드 실행 흐름

### **1. 코드 생성 시점**
```typescript
// AI가 생성하는 코드 (변화 없음)
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const robota = new Robota({
  name: 'ChatBot',
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: 'your-openai-api-key' // 플레이스홀더
    })
  ]
});
```

### **2. 플레이그라운드 실행 시점**
```typescript
// 플레이그라운드 내부에서 Provider 교체
import { createPlaygroundProviders } from '@robota-sdk/playground';

// 런타임에 Provider 교체
const playgroundProviders = createPlaygroundProviders();
global.OpenAIProvider = playgroundProviders.OpenAIProvider;

// 이제 사용자 코드 실행
eval(userGeneratedCode); // 원격 실행되지만 코드는 로컬처럼 보임
```

### **3. 사용자가 로컬에서 실행**
```typescript
// 사용자가 복사한 코드 (그대로 실행 가능)
import { OpenAIProvider } from '@robota-sdk/openai'; // 진짜 OpenAIProvider

const robota = new Robota({
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: process.env.OPENAI_API_KEY // 실제 API Key로 교체
    })
  ]
});
```

## 🎨 플레이그라운드 UI/UX 개선

### **코드 복사 시 자동 수정**
```typescript
// 플레이그라운드에서 "코드 복사" 버튼 클릭 시
function copyCodeForLocal(code: string): string {
  return code
    .replace(/apiKey: ['"][^'"]*['"]/, "apiKey: process.env.OPENAI_API_KEY")
    .replace(/apiKey: ['"][^'"]*['"]/, "apiKey: process.env.ANTHROPIC_API_KEY")
    // 환경변수 사용 패턴으로 자동 변경
    + `
// 📝 Setup Instructions:
// 1. Create .env file in your project root
// 2. Add: OPENAI_API_KEY=your-actual-api-key
// 3. Install dependencies: npm install @robota-sdk/agents @robota-sdk/openai
`;
}
```

### **스마트 플레이스홀더**
```typescript
// 코드 생성 시 스마트 플레이스홀더 사용
const codeTemplate = `
const robota = new Robota({
  aiProviders: [
    new OpenAIProvider({ 
      apiKey: \${OPENAI_API_KEY} // 🎯 환경변수 사용 권장
    })
  ]
});
`;
```

## 🔧 기술적 구현 방안

### **방안 1: Provider 교체 (추천)** ⭐
```typescript
// 플레이그라운드 전용 번들
import { PlaygroundOpenAIProvider as OpenAIProvider } from '@robota-sdk/playground';

// 장점: 기존 코드 변경 없음
// 단점: 별도 빌드 필요
```

### **방안 2: 런타임 Executor 주입**
```typescript
// 플레이그라운드에서 전역 Executor 설정
window.__ROBOTA_PLAYGROUND_EXECUTOR__ = new RemoteExecutor({...});

// OpenAIProvider 내부에서 감지
export class OpenAIProvider extends BaseAIProvider {
  constructor(options: OpenAIProviderOptions) {
    const playgroundExecutor = (window as any).__ROBOTA_PLAYGROUND_EXECUTOR__;
    
    super({
      ...options,
      executor: playgroundExecutor || this.createLocalExecutor(options)
    });
  }
}
```

### **방안 3: 환경 감지 자동 전환**
```typescript
// 환경에 따른 자동 Executor 선택
export class OpenAIProvider extends BaseAIProvider {
  constructor(options: OpenAIProviderOptions) {
    let executor;
    
    if (this.isPlaygroundEnvironment()) {
      executor = new RemoteExecutor({
        serverUrl: 'https://playground-api.robota.io',
        userApiKey: this.getPlaygroundToken()
      });
    } else {
      executor = new LocalExecutor({
        apiKeys: { openai: options.apiKey }
      });
    }
    
    super({ ...options, executor });
  }
  
  private isPlaygroundEnvironment(): boolean {
    return typeof window !== 'undefined' && 
           window.location?.hostname?.includes('playground.robota.io');
  }
}
```

## 🎯 최종 추천 솔루션

### **하이브리드 접근법** 🎭

#### **1. 플레이그라운드: 자동 원격 실행**
```typescript
// 플레이그라운드 환경에서 자동으로 원격 실행
const openai = new OpenAIProvider({ 
  apiKey: 'demo-key' // 가짜 키도 허용, 자동으로 원격 실행
});
```

#### **2. 로컬 개발: 명시적 설정**
```typescript
// 로컬에서는 명시적 API Key 필요
const openai = new OpenAIProvider({ 
  apiKey: process.env.OPENAI_API_KEY // 실제 키 필요
});
```

#### **3. 코드 복사 시 가이드 제공**
```
📋 코드 복사됨! 

로컬에서 실행하려면:
1. .env 파일 생성
2. OPENAI_API_KEY=your-api-key 추가
3. npm install @robota-sdk/agents @robota-sdk/openai

🔒 보안 팁: API Key를 코드에 직접 쓰지 마세요!
```

## 🎉 최종 사용자 경험

### **플레이그라운드에서** 🖥️
```typescript
// 생성된 코드 (바로 실행 가능!)
const openai = new OpenAIProvider({ apiKey: 'demo-key' });
// ✅ 원격 서버에서 실행됨 (API Key 보안 유지)
```

### **로컬에서** 💻
```typescript
// 복사한 코드 (환경변수로 수정)
const openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
// ✅ 로컬에서 실행됨 (실제 API Key 사용)
```

### **핵심 이점** ✨
1. **일관된 코드**: 플레이그라운드와 로컬에서 동일한 코드
2. **즉시 실행**: 플레이그라운드에서 바로 테스트 가능
3. **보안 유지**: 실제 API Key 노출 없음
4. **원활한 전환**: 복사 후 환경변수만 설정하면 바로 사용

이렇게 하면 **개발자가 혼란 없이** 플레이그라운드에서 테스트하고 로컬로 원활하게 전환할 수 있습니다! 🚀 