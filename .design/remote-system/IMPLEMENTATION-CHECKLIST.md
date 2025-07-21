# Remote System 구현 통합 체크리스트

## 📋 개요

이 문서는 Robota SDK Remote System 구현을 위한 **통합 체크리스트**입니다. 
여러 설계 문서에 분산되어 있던 체크리스트들을 하나로 통합하고, 명확한 우선순위와 실행 순서를 정리했습니다.

## 🎯 핵심 설계 원칙

### ✅ **확정된 아키텍처**
- **Executor 주입 방식** (RemoteAIProviders 방식 대신)
- **명시적 모델 전환** (setModel() 메서드만 사용, run() 파라미터 모델 전환 금지)
- **Provider 모델 설정 제거** (defaultModel에서 통합 관리)
- **Breaking Change 적용** (Client 주입 → Executor 주입)

---

## 🚀 Phase 1: 기반 정리 및 패키지 구조 (1주) 

### **1.1 Deprecated 패키지 정리** 🗑️ **[최우선]**
- [ ] `packages/core` 패키지 삭제 (deprecated)
- [ ] `packages/tools` 패키지 삭제 (deprecated)
- [ ] 관련 import 구문 정리
- [ ] 빌드 스크립트에서 제거

### **1.2 @robota-sdk/remote 패키지 구조 설계** 📦
- [x] **일관성 있는 계층 구조 설계** - 표준 src/ 폴더 구조로 완성
  - `packages/remote/src/shared/` - 공통 타입/인터페이스
  - `packages/remote/src/transport/` - 네트워크 통신 (HTTP, WebSocket, gRPC)
  - `packages/remote/src/core/` - 공통 비즈니스 로직 (클라이언트/서버 공통)
  - `packages/remote/src/client/` - 클라이언트 조합 (core + transport)
  - `packages/remote/src/server/` - 서버 조합 (core + transport)
- [x] `package.json` 설정 및 의존성 정의
- [x] TypeScript 설정 (`tsconfig.json`)
- [x] 빌드 스크립트 설정

### **1.3 RemoteExecutor 통합** 🔄
- [x] 기존 `packages/remote/src/executors/remote-executor.ts` 정리
- [x] 새로운 구조로 마이그레이션:
  - `packages/remote/src/core/` - AI Provider 처리 엔진
  - `packages/remote/src/client/` - RemoteExecutor 구현 (core + transport 조합)
- [x] import 경로 업데이트
- [x] 중복 코드 제거 및 일관성 있는 구현

---

## 🏗️ Phase 2: Core Infrastructure (1주)

### **2.1 공통 인터페이스 및 타입 정의** 🎯
- [x] `packages/agents/src/interfaces/executor.ts` 에 ExecutorInterface 정의 완료
- [x] `ChatExecutionRequest`, `StreamExecutionRequest` 타입 정의 완료
- [x] `LocalExecutorConfig`, `RemoteExecutorConfig` 타입 정의 완료
- [x] `packages/remote/src/shared/` 에 서버-클라이언트 공통 타입 정의
- [x] `CommunicationProtocol` enum 정의
- [x] Transport 관련 인터페이스 정의

### **2.2 Core Layer 구현** 💻
- [x] `packages/remote/src/core/ai-provider-engine.ts` - AI Provider 처리 엔진
- [ ] `packages/remote/src/core/auth-service.ts` - 인증/권한 관리
- [ ] `packages/remote/src/core/request-processor.ts` - 요청 검증/변환
- [ ] `packages/remote/src/core/response-processor.ts` - 응답 검증/변환

### **2.3 Transport Layer 구현** 🌐
- [x] `packages/remote/src/transport/transport-interface.ts` - 공통 Transport 인터페이스
- [x] `packages/remote/src/transport/http-transport.ts` - HTTP 통신 구현
- [ ] `packages/remote/src/transport/websocket-transport.ts` - WebSocket 통신 구현
- [ ] `packages/remote/src/transport/protocol-adapter.ts` - 프로토콜 선택 로직

### **2.4 BaseAIProvider 업데이트** 🔧
- [x] `executeViaExecutorOrDirect()` 메서드 검증 완료
- [x] `executeStreamViaExecutorOrDirect()` 메서드 검증 완료
- [x] Executor 감지 로직 확인 완료
- [x] 기존 호환성 100% 보장 완료

---

## 🔌 Phase 3: Client & Server Integration (1주)

### **3.1 Client Layer 구현** 📱
- [x] `packages/remote/src/client/remote-executor.ts` - RemoteExecutor 구현 (core + transport 조합)
- [ ] `packages/remote/src/client/remote-client.ts` - 클라이언트 SDK
- [ ] `packages/remote/src/client/connection-manager.ts` - 연결 관리 (재시도, 회로차단기)
- [ ] Client 통합 테스트

### **3.2 Server Layer 구현** 🖥️
- [x] `packages/remote/src/server/remote-server.ts` - 서버 엔진 (core + transport 조합)
- [ ] `packages/remote/src/server/route-handler.ts` - Express 라우터 생성 (통합됨)
- [ ] `packages/remote/src/server/middleware.ts` - 서버 미들웨어 (인증, 로깅, 에러처리)
- [ ] Server 통합 테스트

### **3.3 Provider Integration 업데이트** 🔧
- [x] **OpenAI Provider** - Executor 주입 지원 완료
- [x] **Anthropic Provider** - Executor 주입 지원 완료
- [x] **Google Provider** - Executor 주입 지원 완료
- [ ] 모든 Provider에서 모델 설정 필드 제거
- [ ] Provider 통합 테스트 업데이트

---

## 🌐 Phase 4: Application Implementation (1주)

### **4.1 API Server Application** 🏗️
- [x] **하이브리드 Express.js 구조 설계** - 독립 서버 + Firebase Functions 호환
- [x] `apps/api-server/` 프로젝트 기본 구조 완성
- [x] `@robota-sdk/remote` 패키지 활용한 얇은 애플리케이션 레이어
- [ ] Docker 설정 및 환경 구성
- [ ] Firebase Functions 배포 설정

### **4.2 API Endpoints 구현** 🔄
- [x] `/v1/remote/chat` 통합 엔드포인트 (RemoteServer 활용)
- [x] `/v1/remote/stream` SSE 스트리밍 지원 (WebSocket은 선택사항)
- [x] `/health` 헬스체크 엔드포인트
- [ ] API 문서화 (OpenAPI/Swagger)

### **4.3 인증 및 보안 시스템** 🔒
- [ ] JWT 기반 사용자 인증
- [ ] API Key 안전 관리 시스템
- [ ] 사용자별 권한 제어
- [ ] Rate Limiting 구현

### **4.4 스트리밍 지원** 📡
- [ ] WebSocket 기반 실시간 통신
- [ ] Server-Sent Events (SSE) 구현
- [ ] 연결 안정성 및 재연결 로직
- [ ] 스트리밍 응답 청크 처리

---

## 🔍 **RemoteExecutor 아키텍처 심화 분석**

### **🎯 Zero-Config 및 캡슐화 요구사항 분석**

RemoteExecutor의 구현에서 **기능 사용에 대한 zero-config**와 **완벽한 캡슐화**를 달성하기 위해 다음과 같이 설계했습니다:

#### **🎮 Zero-Config 기능 사용 목표**

**❌ 현재 문제 (복잡한 설정 필요)**
```typescript
const executor = new RemoteExecutor({
  serverUrl: 'https://api.robota.io',
  userApiKey: 'user-token',
  protocol: CommunicationProtocol.HTTP_REST,
  timeout: 30000,
  retryCount: 3,
  enableWebSocket: false,
  headers: { 'User-Agent': 'MyApp' }
});
```

**✅ Zero-Config 목표 (최소한의 설정만)**
```typescript
// 사용자는 서버 URL만 제공
const executor = new RemoteExecutor({
  serverUrl: 'https://api.robota.io'  // 이것만 필수!
});

// 또는 더 간단하게
const executor = RemoteExecutor.create('https://api.robota.io');

// 내부적으로 모든 것이 자동으로:
// - 최적 프로토콜 자동 감지 (HTTP/1.1 → HTTP/2 → WebSocket)
// - 자동 재시도 및 타임아웃
// - 자동 에러 처리 및 회로차단기
// - 자동 로드밸런싱
// - 자동 압축 및 캐싱
```

#### **🔄 자동화된 기능들**

1. **프로토콜 자동 선택**: 환경에 따라 HTTP/1.1 → HTTP/2 → WebSocket 자동 업그레이드
2. **Provider 자동 등록**: 환경변수만 있으면 모든 AI Provider 자동 활성화
3. **에러 처리 자동화**: 재시도, 회로차단기, 타임아웃 자동 처리
4. **응답 검증 자동화**: 모든 응답 자동 검증 및 변환
5. **스트리밍 자동화**: SSE 자동 설정 및 처리

다음 통신 방식들을 비교 분석했습니다:

#### **1. HTTP/2 + REST (현재 구현)**
**장점:**
- 🌐 **Universal Browser 지원**: 브라우저에서 바로 작동
- ⚡ **Zero-Config**: 별도 툴링 없이 curl, Postman으로 테스트 가능
- 🔍 **Debugging 용이**: JSON으로 human-readable한 디버깅
- 📚 **광범위한 생태계**: 모든 언어에서 HTTP 클라이언트 지원
- 🔄 **HTTP/2 Multiplexing**: 연결 재사용으로 성능 향상

**단점:**
- 📦 **JSON Overhead**: Binary 대비 3-5배 큰 payload 크기
- 🐌 **Serialization Cost**: JSON parsing이 Protobuf 대비 느림

#### **2. gRPC + HTTP/2 (고성능 대안)**
**장점:**
- ⚡ **고성능**: Protocol Buffers로 3-5배 빠른 직렬화
- 🔄 **Bidirectional Streaming**: 완벽한 실시간 통신
- 💪 **강타입 시스템**: Protobuf로 컴파일타임 검증
- 🌍 **Polyglot 지원**: 다양한 언어로 자동 코드 생성

**단점:**
- 🚫 **브라우저 비지원**: 직접 브라우저 사용 불가 (gRPC-Web 필요)
- 🔧 **복잡한 툴링**: protoc, specialized debugging tools 필요
- 📈 **Learning Curve**: 팀의 gRPC 학습 비용

#### **3. WebSocket (실시간 중심)**
**장점:**
- 🔄 **Full Duplex**: 양방향 실시간 통신
- 🌐 **브라우저 지원**: 네이티브 WebSocket API
- ⚡ **낮은 지연시간**: Connection overhead 최소화

**단점:**
- 🔧 **Connection 관리 복잡**: 연결 상태, 재연결 로직 필요
- 🚫 **Caching 불가**: HTTP 캐싱 메커니즘 사용 불가
- 🏗️ **Infrastructure 복잡**: Load balancer sticky session 필요

### **🏆 권장 아키텍처: Hybrid HTTP/2 + Smart Fallback**

**최적의 zero-config 솔루션:**

```typescript
// RemoteExecutor가 자동으로 최적 통신 방식 선택 (Zero-Config)
export class RemoteExecutor implements ExecutorInterface {
  // ✅ 정적 팩토리 메서드로 더 간단한 생성
  static create(serverUrl: string): RemoteExecutor {
    return new RemoteExecutor({ serverUrl });
  }

  constructor(config: RemoteExecutorConfig) {
    // ✅ 필수는 serverUrl만, 나머지는 모두 스마트 기본값
    this.config = {
      serverUrl: config.serverUrl,
      userApiKey: config.userApiKey || this.generateAnonymousToken(),
      timeout: config.timeout || this.detectOptimalTimeout(),
      maxRetries: config.maxRetries || 3,
      enableWebSocket: config.enableWebSocket ?? this.shouldEnableWebSocket(),
      headers: config.headers || {}
    };
    
    // ✅ 자동으로 최적 Transport 생성
    this.transport = this.createOptimalTransport();
  }

  private async detectOptimalProtocol(): Promise<Protocol> {
    // 1. HTTP/2 지원 여부 자동 확인
    if (await this.supportsHTTP2()) {
      return Protocol.HTTP2_REST;
    }
    
    // 2. WebSocket 실시간 요구사항 자동 감지
    if (this.config.enableWebSocket) {
      return Protocol.WEBSOCKET;
    }
    
    // 3. 안전한 기본값으로 HTTP/1.1 폴백
    return Protocol.HTTP1_REST;
  }

  private generateAnonymousToken(): string {
    // ✅ API Key가 없어도 동작하는 익명 토큰 자동 생성
    return `anonymous_${Date.now()}_${Math.random().toString(36)}`;
  }

  private detectOptimalTimeout(): number {
    // ✅ 네트워크 환경에 따른 최적 타임아웃 자동 감지
    return navigator?.connection?.effectiveType === '4g' ? 15000 : 30000;
  }

  private shouldEnableWebSocket(): boolean {
    // ✅ 환경에 따라 WebSocket 필요 여부 자동 판단
    return typeof WebSocket !== 'undefined' && !this.isFirebaseFunction();
  }
}
```

### **🔄 Progressive Enhancement Strategy**

#### **Level 1: HTTP/1.1 + JSON (Baseline)**
- ✅ **100% 호환성**: 모든 환경에서 작동
- ⚙️ **Zero-Config**: 별도 설정 없이 즉시 사용

#### **Level 2: HTTP/2 + JSON (Performance)**
- ⚡ **자동 업그레이드**: HTTP/2 지원 시 자동 활성화
- 🔄 **Multiplexing**: 단일 연결에서 다중 요청

#### **Level 3: HTTP/2 + Streaming (Advanced)**
- 🌊 **Server-Sent Events**: 실시간 스트리밍
- 🔄 **Bidirectional Streaming**: WebSocket 대안

#### **Level 4: gRPC-Web + Protobuf (Expert)**
- 🚀 **최고 성능**: Binary 프로토콜로 최적화
- 🔧 **Advanced Setup**: 전문가용 고성능 모드

### **🛡️ 캡슐화 전략: API Gateway Pattern**

```typescript
// ✅ Zero-Config 사용법 1: 기본 생성자
const executor = new RemoteExecutor({
  serverUrl: 'https://api.robota.io'  // 이것만 필수!
  // userApiKey 없어도 익명 토큰 자동 생성
  // timeout, retryCount 등 모두 환경에 최적화된 기본값
});

// ✅ Zero-Config 사용법 2: 정적 팩토리 메서드 (더 간단)
const executor = RemoteExecutor.create('https://api.robota.io');

// ✅ AI Provider와의 Zero-Config 통합
const robota = new Robota({
  name: 'MyAgent',
  aiProviders: {
    openai: new OpenAIProvider({
      executor: RemoteExecutor.create('https://api.robota.io')
      // API Key, 모델 설정 등 모두 서버에서 자동 처리
    })
  },
  currentProvider: 'openai'
});

// ✅ 사용자는 복잡한 설정을 전혀 몰라도 됨
const response = await robota.run('Hello!');

// 내부적으로는 복잡한 최적화 로직이 자동 실행
class RemoteExecutor {
  async executeChat(request: ChatExecutionRequest) {
    // 1. 자동 프로토콜 감지 및 업그레이드
    // 2. 자동 인증 처리 (익명 토큰 또는 사용자 토큰)
    // 3. 자동 에러 재시도 (네트워크 상태 기반)
    // 4. 자동 회로차단기 (장애 감지 시)
    // 5. 자동 응답 검증 및 변환
    // 6. 자동 스트리밍 최적화
  }
}
```

### **📊 성능 벤치마크 목표**

| 통신 방식 | 지연시간 목표 | 처리량 목표 | Zero-Config |
|-----------|---------------|-------------|-------------|
| **HTTP/2 + JSON** | < 50ms | 1000 req/s | ✅ |
| **gRPC-Web** | < 30ms | 5000 req/s | ⚠️ |
| **WebSocket** | < 20ms | 10000 msg/s | ✅ |

### **🔧 Zero-Config 구현 우선순위**

#### **4.1 클라이언트 Zero-Config** (우선순위: 🔥 최고)
- [ ] **정적 팩토리 메서드**: `RemoteExecutor.create(serverUrl)` 구현
- [ ] **스마트 기본값 자동 설정**: timeout, retryCount, protocol 자동 감지
- [ ] **익명 토큰 자동 생성**: userApiKey 없어도 동작하는 시스템
- [ ] **프로토콜 자동 업그레이드**: HTTP/1.1 → HTTP/2 → WebSocket 자동 선택

#### **4.2 서버 Provider 자동 등록** (우선순위: 🔥 최고)  
- [x] **환경변수 기반 자동 활성화**: API Key 있으면 자동으로 Provider 등록
- [ ] **Provider 상태 자동 감지**: 사용 가능한 Provider만 활성화
- [ ] **Auto-Failover**: Provider 장애 시 자동 대체
- [ ] **로드밸런싱**: 다중 Provider 간 자동 부하 분산

#### **4.3 네트워크 최적화 자동화** (우선순위: 🔥 최고)
- [ ] **연결 상태 자동 감지**: 네트워크 품질에 따른 설정 자동 조정
- [ ] **회로차단기**: 장애 감지 시 자동 차단 및 복구
- [ ] **자동 재시도**: 지수 백오프로 스마트 재시도
- [ ] **Connection Pooling**: 효율적인 연결 재사용 자동 관리

#### **4.4 스트리밍 자동화** (우선순위: 🔥 최고)
- [x] **SSE 자동 설정**: Server-Sent Events 자동 구성
- [ ] **Adaptive Streaming**: 네트워크 상태에 따른 자동 조정
- [ ] **자동 재연결**: 연결 끊김 시 자동 재연결
- [ ] **Backpressure Handling**: 과부하 방지 자동 제어

### **🏗️ Zero-Config 사용자 경험**

#### **📖 사용 시나리오**

**🎯 시나리오 1: 완전 초보자 (최소 설정)**
```typescript
// 1. 가장 간단한 사용법
const executor = RemoteExecutor.create('https://api.robota.io');

// 2. AI Provider와 연동
const robota = new Robota({
  name: 'MyAgent',
  aiProviders: {
    openai: new OpenAIProvider({ executor })
  },
  currentProvider: 'openai'
});

// 3. 바로 사용 가능 (모든 복잡한 설정은 자동!)
const response = await robota.run('Hello!');
```

**🔧 시나리오 2: 개발자 (선택적 커스터마이징)**
```typescript
// 기본은 Zero-Config, 필요시에만 오버라이드
const executor = new RemoteExecutor({
  serverUrl: 'https://api.robota.io',
  // userApiKey는 자동 생성됨 (명시하면 우선 사용)
  userApiKey: 'my-custom-token',  // 선택사항
  // timeout은 네트워크 상태에 따라 자동 감지됨
  timeout: 60000  // 선택사항: 특별한 요구사항이 있을 때만
});
```

**🚀 시나리오 3: 프로덕션 (환경변수만으로 모든 설정)**
```bash
# 서버 운영자는 환경변수만 설정
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
npm start

# ✅ 모든 Provider 자동 활성화
# ✅ 프로덕션 최적화 설정 자동 적용
# ✅ 보안, 모니터링, 로깅 자동 활성화
```

### **🚀 결론: 진정한 Zero-Config RemoteExecutor**

#### **🎯 Zero-Config 철학**
1. **최소 필수 정보만**: serverUrl 하나만 제공하면 모든 것이 동작
2. **스마트 기본값**: 환경과 상황에 맞는 최적 설정 자동 적용
3. **점진적 향상**: 기본 동작 → 환경 감지 → 자동 최적화
4. **완벽한 캡슐화**: 복잡한 네트워크/보안 로직은 내부에 숨김
5. **선택적 커스터마이징**: 필요시에만 세부 설정 오버라이드 가능

#### **✅ 달성 목표**
- **🔥 개발자 경험**: `RemoteExecutor.create(url)` 한 줄로 모든 기능 사용
- **⚡ 자동 최적화**: 프로토콜, 타임아웃, 재시도 모두 환경에 맞게 자동 설정
- **🛡️ 자동 안정성**: 에러 처리, 회로차단기, 재연결 모두 자동 처리
- **🌍 환경 적응**: 브라우저, Node.js, Firebase Functions 어디서든 최적 동작

이 아키텍처로 **진정한 Zero-Config**와 **최고의 개발자 경험**을 제공하는 RemoteExecutor를 구축할 수 있습니다! 🎯

---

## 🎮 Phase 5: Playground Integration (1주)

### **5.1 RemoteExecutor 통합** 🔗
- [ ] 플레이그라운드에서 `@robota-sdk/remote` import
- [ ] 기존 Mock RemoteExecutor를 실제 구현체로 교체
- [ ] 설정 및 초기화 로직 업데이트

### **5.2 실제 서버 연동** 🌐
- [ ] 플레이그라운드 → 실제 Remote Server 연결
- [ ] API 엔드포인트 설정 및 환경 변수
- [ ] 에러 처리 및 폴백 로직
- [ ] 연결 상태 모니터링

### **5.3 인증 시스템 완성** 🔐
- [ ] 실제 플레이그라운드 토큰 생성 API 구현
- [ ] Firebase Auth → 플레이그라운드 토큰 교환
- [ ] 토큰 유효성 검증 및 갱신
- [ ] 사용량 제한 및 권한 확인

---

## 🧪 Phase 6: Testing & Quality Assurance (1주)

### **6.1 Unit Tests** 🔬
- [ ] RemoteExecutor 단위 테스트
- [ ] Provider Executor 통합 테스트
- [ ] 서버 API 엔드포인트 테스트
- [ ] 인증 및 권한 시스템 테스트

### **6.2 Integration Tests** 🔗
- [ ] 전체 Remote System 통합 테스트
- [ ] 플레이그라운드 → 서버 → Provider 전체 플로우
- [ ] 스트리밍 기능 테스트
- [ ] 에러 시나리오 테스트

### **6.3 Performance Tests** ⚡
- [ ] 응답 시간 측정 (목표: < 200ms 추가 지연)
- [ ] 동시 연결 테스트 (목표: 1000 동시 연결)
- [ ] 스트리밍 지연 측정 (목표: < 100ms)
- [ ] 부하 테스트 및 최적화

---

## 📚 Phase 7: Documentation & Examples (1주)

### **7.1 API 문서** 📖
- [ ] RemoteExecutor API 문서 작성
- [ ] Provider Executor 옵션 가이드
- [ ] 서버 API 엔드포인트 문서
- [ ] 인증 및 토큰 관리 가이드

### **7.2 마이그레이션 가이드** 🔄
- [ ] 기존 Provider 설정 → 새로운 방식 마이그레이션
- [ ] Breaking Changes 상세 설명
- [ ] 코드 예제 및 변환 스크립트
- [ ] 문제 해결 가이드

### **7.3 예제 및 튜토리얼** 🎯
- [ ] 기본 Remote 사용법 예제
- [ ] 플레이그라운드 통합 예제
- [ ] 로컬/원격 하이브리드 사용법
- [ ] 고급 설정 및 최적화 예제

---

## 🚀 Phase 8: Advanced Features (1주) **[Optional]**

### **8.1 HybridExecutor** ⚖️
- [ ] 조건부 로컬/원격 전환 로직
- [ ] 토큰 수 기반 자동 전환
- [ ] 네트워크 상태 기반 폴백
- [ ] 비용 최적화 알고리즘

### **8.2 Caching System** 💾
- [ ] 응답 캐싱 구현 (`CacheExecutor`)
- [ ] 캐시 키 생성 전략
- [ ] TTL 및 무효화 로직
- [ ] 메모리 및 Redis 캐시 지원

### **8.3 Monitoring & Analytics** 📊
- [ ] 사용량 추적 시스템
- [ ] 성능 메트릭 수집
- [ ] 에러 추적 및 알림
- [ ] 대시보드 및 리포팅

---

## ✅ 완료 기준

### **Phase 1-3 완료 기준** (핵심 기능)
- [ ] 모든 Provider에서 Executor 주입 방식 지원
- [ ] 기존 코드 100% 하위 호환성 유지
- [ ] RemoteExecutor를 통한 기본 원격 실행 가능
- [ ] 플레이그라운드에서 API Key 없이 안전한 실행

### **Phase 4-6 완료 기준** (프로덕션 준비)
- [ ] 실제 Remote Server 배포 및 운영
- [ ] 모든 AI Provider (OpenAI, Anthropic, Google) 프록시 지원
- [ ] 스트리밍 응답 완벽 지원
- [ ] 보안 및 인증 시스템 완성
- [ ] 99.9% 가용성 달성

### **Phase 7-8 완료 기준** (완전체)
- [ ] 완전한 문서화 및 예제
- [ ] 고급 기능 (Hybrid, Cache) 지원
- [ ] 모니터링 및 분석 시스템
- [ ] 커뮤니티 피드백 반영

---

## 🎯 다음 단계 우선순위

### **즉시 시작 (이번 주)**
1. **packages/core & packages/tools 삭제**
2. **@robota-sdk/remote 패키지 생성**
3. **RemoteExecutor 통합 이동**

### **1주 내 완료**
4. **Anthropic & Google Provider Executor 지원**
5. **Provider 모델 설정 필드 제거**

### **2주 내 완료** 
6. **Remote Server 기본 구현**
7. **플레이그라운드 실제 서버 연동**

---

## 📝 Notes

- **Breaking Change 허용**: v2.0.0으로 메이저 버전 업그레이드
- **명시적 모델 전환만**: `setModel()` 메서드만 사용, `run()` 파라미터 모델 전환 금지
- **API Key 완전 격리**: 클라이언트에서 실제 AI API Key 완전 제거
- **점진적 마이그레이션**: Phase별로 단계적 구현 및 검증

이 체크리스트를 통해 체계적이고 안정적인 Remote System 구현이 가능합니다! 🚀 