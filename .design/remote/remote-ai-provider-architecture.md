# Remote AI Provider 아키텍처 설계

## 📋 개요

Robota SDK의 AI Provider를 원격 API로 확장하여 클라이언트에서 서버의 AI 기능을 안전하게 사용할 수 있도록 하는 시스템 설계입니다. 
이 설계를 통해 API Key 보안, 비용 제어, 중앙 관리 등의 이점을 얻으면서도 기존 Robota 생태계와 완벽한 호환성을 유지합니다.

## 🎯 핵심 아이디어

### **레버리지 효과** 🚀
AIProvider 레벨에서 원격 지원을 구현하면:
- ✅ **Robota** → 자동으로 원격 지원
- ✅ **SessionManager** → 자동으로 원격 지원  
- ✅ **TeamContainer** → 자동으로 원격 지원
- ✅ **모든 상위 라이브러리** → 자동으로 원격 지원

### **보안 및 제어** 🔒
- API Key를 서버에서 안전하게 관리
- 사용량 제한 및 모니터링 가능
- 사용자별 권한 관리
- 비용 추적 및 제어

## 🏗️ 아키텍처 설계

### **1. 전체 구조도**
```
클라이언트 측                     서버 측
┌─────────────────────┐         ┌─────────────────────┐
│   Robota Agent      │         │   Remote Server     │
│  ┌───────────────┐  │         │  ┌───────────────┐  │
│  │ RemoteAIProvider│◄─────────┼──┤ AIProvider    │  │
│  │               │  │  HTTP/WS │  │ Proxy         │  │
│  └───────────────┘  │         │  └───────────────┘  │
│                     │         │         │           │
│ Sessions/Team 등도  │         │  ┌───────▼───────┐  │
│ 자동으로 원격 지원  │         │  │ OpenAI/Claude  │  │
└─────────────────────┘         │  │ /Google APIs   │  │
                                │  └───────────────┘  │
                                └─────────────────────┘
```

### **2. RemoteAIProvider 구현**
```typescript
// packages/remote/src/providers/remote-ai-provider.ts
export class RemoteAIProvider extends BaseAIProvider {
  override readonly name = 'remote';
  override readonly version = '1.0.0';
  
  private apiClient: RemoteAPIClient;
  private config: RemoteProviderConfig;
  
  constructor(config: RemoteProviderConfig) {
    super();
    this.config = config;
    this.apiClient = new RemoteAPIClient(config);
  }
  
  override async chat(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): Promise<AssistantMessage> {
    // HTTP/WebSocket을 통해 서버의 실제 AI Provider에 요청
    const response = await this.apiClient.request({
      endpoint: '/ai/chat',
      method: 'POST',
      data: {
        messages,
        options,
        tools,
        provider: this.config.targetProvider, // 'openai', 'anthropic', 'google'
        model: this.config.model
      }
    });
    
    return response;
  }
  
  override async *chatStream(
    messages: UniversalMessage[],
    options?: ChatOptions,
    tools?: ToolSchema[]
  ): AsyncGenerator<string> {
    // WebSocket 또는 Server-Sent Events로 스트리밍
    const stream = await this.apiClient.requestStream({
      endpoint: '/ai/chat/stream',
      data: {
        messages,
        options,
        tools,
        provider: this.config.targetProvider,
        model: this.config.model
      }
    });
    
    for await (const chunk of stream) {
      yield chunk;
    }
  }
}
```

### **3. 서버 측 AI Provider Proxy**
```typescript
// server/src/providers/ai-provider-proxy.ts
export class AIProviderProxy {
  private providers: Map<string, BaseAIProvider> = new Map();
  
  constructor() {
    // 서버에서 실제 AI Provider들 초기화 (API Key 포함)
    this.providers.set('openai', new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY
    }));
    
    this.providers.set('anthropic', new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY
    }));
    
    this.providers.set('google', new GoogleProvider({
      apiKey: process.env.GOOGLE_AI_API_KEY
    }));
  }
  
  async executeChat(request: RemoteChatRequest): Promise<AssistantMessage> {
    const provider = this.providers.get(request.provider);
    if (!provider) {
      throw new Error(`Provider ${request.provider} not available`);
    }
    
    // 사용량 체크, 권한 확인 등
    await this.validateRequest(request);
    
    // 실제 AI Provider에 요청
    return await provider.chat(
      request.messages,
      request.options,
      request.tools
    );
  }
  
  async *executeChatStream(request: RemoteChatRequest): AsyncGenerator<string> {
    const provider = this.providers.get(request.provider);
    if (!provider) {
      throw new Error(`Provider ${request.provider} not available`);
    }
    
    await this.validateRequest(request);
    
    for await (const chunk of provider.chatStream(
      request.messages,
      request.options,
      request.tools
    )) {
      yield chunk;
    }
  }
  
  private async validateRequest(request: RemoteChatRequest): Promise<void> {
    // 사용자 권한 확인
    // 사용량 제한 확인
    // 비용 계산 및 제한 확인
    // 로깅 및 모니터링
  }
}
```

## 📦 패키지 구조

### **@robota-sdk/remote**
```
packages/remote/
├── src/
│   ├── providers/
│   │   ├── remote-ai-provider.ts       # 원격 AI Provider
│   │   └── provider-config.ts          # 설정 타입 정의
│   ├── client/
│   │   ├── remote-api-client.ts        # HTTP/WebSocket 클라이언트
│   │   ├── stream-handler.ts           # 스트리밍 처리
│   │   └── error-handler.ts            # 에러 처리
│   ├── auth/
│   │   ├── auth-manager.ts             # 인증 관리
│   │   └── token-manager.ts            # 토큰 관리
│   ├── types/
│   │   ├── remote-types.ts             # 원격 요청/응답 타입
│   │   └── config-types.ts             # 설정 타입
│   └── index.ts
├── examples/
└── README.md
```

### **Robota Remote Server** (별도 저장소)
```
robota-remote-server/
├── src/
│   ├── routes/
│   │   ├── ai/                         # AI API 엔드포인트
│   │   └── auth/                       # 인증 엔드포인트
│   ├── providers/
│   │   ├── ai-provider-proxy.ts        # AI Provider 프록시
│   │   └── provider-manager.ts         # Provider 관리
│   ├── middleware/
│   │   ├── auth.ts                     # 인증 미들웨어
│   │   ├── rate-limit.ts               # 속도 제한
│   │   └── usage-tracking.ts           # 사용량 추적
│   ├── services/
│   │   ├── user-service.ts             # 사용자 관리
│   │   └── billing-service.ts          # 과금 관리
│   └── app.ts
├── docker/
├── deploy/
└── README.md
```

## 🔄 사용 예시

### **1. 기본 사용법 (기존 코드와 동일)**
```typescript
import { Robota } from '@robota-sdk/agents';
import { RemoteAIProvider } from '@robota-sdk/remote';

// 원격 AI Provider 설정
const remoteProvider = new RemoteAIProvider({
  serverUrl: 'https://api.robota.io',
  apiKey: 'user-api-key-123',
  targetProvider: 'openai',
  model: 'gpt-4'
});

// 기존과 동일한 방식으로 사용
const robota = new Robota({
  name: 'RemoteAgent',
  aiProviders: [remoteProvider],
  defaultModel: {
    provider: 'remote',
    model: 'gpt-4'
  }
});

// 모든 기능이 자동으로 원격에서 동작
const response = await robota.run('Hello, world!');
```

### **2. SessionManager도 자동으로 원격 지원**
```typescript
import { SessionManager } from '@robota-sdk/sessions';

const sessionManager = new SessionManager();

// RemoteAIProvider를 사용하는 세션 생성
const sessionId = sessionManager.createSession({
  aiProviders: [remoteProvider],
  defaultModel: { provider: 'remote', model: 'gpt-4' }
});

// 원격 AI가 자동으로 사용됨
const chat = sessionManager.getSession(sessionId);
await chat.run('원격에서 처리되는 메시지');
```

### **3. TeamContainer도 자동으로 원격 지원**
```typescript
import { TeamContainer } from '@robota-sdk/team';

const team = new TeamContainer({
  agents: [
    {
      name: 'RemoteAgent1',
      aiProviders: [remoteProvider],
      defaultModel: { provider: 'remote', model: 'gpt-4' }
    }
  ]
});

// 팀 협업도 원격 AI로 처리
await team.delegateWork('복잡한 작업을 팀에서 처리');
```

## 🔒 보안 및 인증

### **1. API Key 관리**
```typescript
// 클라이언트는 사용자 API Key만 관리
const remoteProvider = new RemoteAIProvider({
  serverUrl: 'https://api.robota.io',
  apiKey: 'user-api-key-123',  // 사용자별 API Key
  // 실제 OpenAI/Claude API Key는 서버에서 관리
});
```

### **2. 권한 제어**
```typescript
// 서버에서 사용자별 권한 관리
interface UserPermissions {
  allowedProviders: string[];     // ['openai', 'anthropic']
  allowedModels: string[];        // ['gpt-4', 'claude-3-sonnet']
  monthlyTokenLimit: number;      // 100000
  dailyRequestLimit: number;      // 1000
  allowedFeatures: string[];      // ['chat', 'stream', 'tools']
}
```

### **3. 사용량 추적**
```typescript
// 실시간 사용량 모니터링
interface UsageMetrics {
  tokensUsed: number;
  requestCount: number;
  cost: number;
  lastUsed: Date;
  provider: string;
  model: string;
}
```

## 🚀 구현 계획

### **Phase 1: 기본 Remote Provider (3주)**
#### 1.1 RemoteAIProvider 구현
- [ ] BaseAIProvider 확장한 RemoteAIProvider 클래스
- [ ] HTTP 기반 chat() 메서드 구현
- [ ] 기본 에러 처리 및 재시도 로직
- [ ] 설정 타입 정의

#### 1.2 기본 서버 구현
- [ ] Express.js 기반 서버 구조
- [ ] AI Provider Proxy 구현
- [ ] 기본 인증 시스템
- [ ] OpenAI Provider 연동

#### 1.3 기본 테스트
- [ ] RemoteAIProvider 단위 테스트
- [ ] 서버 API 통합 테스트
- [ ] 기본 Robota 연동 테스트

### **Phase 2: 스트리밍 및 고급 기능 (2주)**
#### 2.1 스트리밍 지원
- [ ] WebSocket 기반 스트리밍 구현
- [ ] chatStream() 메서드 구현
- [ ] 연결 안정성 및 재연결 로직

#### 2.2 다중 Provider 지원
- [ ] Anthropic Provider 연동
- [ ] Google Provider 연동
- [ ] Provider 선택 로직 구현

#### 2.3 Tool Calling 지원
- [ ] 원격 Tool 실행 구현
- [ ] Tool Schema 전송/검증
- [ ] Tool 실행 결과 처리

### **Phase 3: 보안 및 제어 시스템 (2주)**
#### 3.1 인증 및 권한 시스템
- [ ] JWT 기반 인증 구현
- [ ] 사용자별 권한 관리
- [ ] API Key 관리 시스템

#### 3.2 사용량 제어
- [ ] Rate Limiting 구현
- [ ] 사용량 추적 시스템
- [ ] 비용 계산 및 제한

#### 3.3 모니터링 및 로깅
- [ ] 요청/응답 로깅 시스템
- [ ] 성능 메트릭 수집
- [ ] 에러 추적 및 알림

### **Phase 4: 배포 및 최적화 (1주)**
#### 4.1 배포 시스템
- [ ] Docker 컨테이너화
- [ ] CI/CD 파이프라인 구성
- [ ] 서버 배포 자동화

#### 4.2 성능 최적화
- [ ] 응답 캐싱 시스템
- [ ] 연결 풀링 최적화
- [ ] 부하 분산 준비

#### 4.3 문서화
- [ ] API 문서 작성
- [ ] 설치/설정 가이드
- [ ] 예제 및 튜토리얼

## 💡 주요 이점

### **1. 개발자 경험** 🎯
- **Zero Code Change**: 기존 Robota 코드 수정 없이 원격 사용
- **완전한 호환성**: 모든 Robota 기능 그대로 사용 가능
- **투명한 동작**: 로컬과 원격 구분 없는 동일한 API

### **2. 보안** 🔒
- **API Key 보호**: 클라이언트에 실제 AI API Key 노출 없음
- **중앙 제어**: 서버에서 모든 API 사용 통제
- **사용자별 권한**: 세밀한 권한 관리 가능

### **3. 비용 관리** 💰
- **사용량 추적**: 실시간 토큰 사용량 모니터링
- **제한 설정**: 사용자별/기능별 제한 가능
- **비용 최적화**: 캐싱 및 배치 처리로 비용 절감

### **4. 확장성** 🚀
- **레버리지 효과**: 하나의 구현으로 모든 상위 라이브러리 지원
- **중앙 업그레이드**: 서버 업데이트로 모든 클라이언트 혜택
- **다중 Provider**: 여러 AI Provider 통합 관리

## 🎯 성공 지표

### **기능적 목표**
- [ ] 모든 BaseAIProvider 기능 원격 지원
- [ ] 기존 Robota 코드 100% 호환성
- [ ] 스트리밍 응답 완벽 지원
- [ ] Tool Calling 완전 지원

### **성능 목표**
- [ ] 응답 시간 증가 < 200ms
- [ ] 스트리밍 지연 < 100ms
- [ ] 99.9% 가용성
- [ ] 1000 동시 연결 지원

### **보안 목표**
- [ ] API Key 완전 보호
- [ ] 사용자별 권한 제어
- [ ] 사용량 실시간 추적
- [ ] 비용 제한 시스템

이 설계를 통해 **Robota 생태계 전체를 원격화**하면서도 **기존 개발자 경험을 그대로 유지**할 수 있는 강력한 시스템을 구축할 수 있습니다! 🚀 