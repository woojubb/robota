# @robota-sdk/agents 패키지 개발 계획

## 📋 개요

`@robota-sdk/agents` 패키지는 기존 `@robota-sdk/core`와 `@robota-sdk/tools`의 기능을 통합하여 완전히 새롭게 만드는 통합 AI 에이전트 패키지입니다. 

### 주요 목표

1. **완전한 독립성**: 기존 core, tools 패키지를 import 하지 않고 순수하게 새로 구현
2. **모듈화된 설계**: 각 기능을 추상화부터 구체 구현까지 여러 파일로 분산
3. **기존 패키지 호환성**: sessions, team, openai, anthropic, google 패키지와 완벽 호환
4. **확장 가능한 아키텍처**: 미래 기능 추가를 위한 유연한 구조
5. **🆕 개발 가이드라인 준수**: 모든 코드는 프로젝트 개발 가이드라인을 엄격히 준수

## 🎯 구현된 핵심 기능

### 🏗️ 아키텍처 및 추상화 시스템
- **계층화된 추상 클래스**: BaseAgent, BaseManager, BaseProvider, BaseAIProvider, BaseTool, BasePlugin
- **인터페이스 우선 설계**: AgentInterface, AIProvider, ToolProvider, Manager 인터페이스들
- **모듈화된 구조**: abstracts/, interfaces/, managers/, services/, plugins/, utils/ 분리

### 🤖 에이전트 시스템
- **Robota 클래스**: BaseAgent 구현체로 AI 대화 + 도구 시스템 + Plugin System 통합
- **무상태 서비스 레이어**: ConversationService, ToolExecutionService, ExecutionService
- **매니저 레이어**: AIProviders, Tools, AgentFactory, Plugins, ConversationHistory
- **스트리밍 지원**: 실시간 응답 스트리밍 처리
- **병렬 도구 실행**: 동시 다중 도구 호출 지원

### 🔧 도구 시스템
- **ToolRegistry**: 도구 스키마 저장소 및 검증 시스템
- **Function Tools**: Zod 스키마 기반 함수 도구 구현
- **OpenAPI/MCP 지원**: 기본 구조 구현 (확장 가능)
- **도구 상태 관리**: 등록/해제/조회 기능

### 🔌 플러그인 시스템 (생명주기 후킹)
- **ConversationHistoryPlugin**: 대화 내역 저장 (메모리/파일/DB)
- **UsagePlugin**: 사용량 통계 수집 (호출 횟수, 토큰 사용량, 비용)
- **LoggingPlugin**: 동작 로그 기록 (Console/File/Remote, 환경변수 제어)
- **PerformancePlugin**: 성능 메트릭 수집 (응답시간, 메모리, CPU)
- **ErrorHandlingPlugin**: 에러 로깅/복구/재시도 처리
- **LimitsPlugin**: 토큰/요청 한도 제한 (Rate Limiting, 비용 제어)
- **EventEmitterPlugin**: Tool 이벤트 감지/전파 (실행 전후, 성공/실패)
- **WebhookPlugin**: 웹훅 알림 전송 (외부 시스템 알림)
- **Plugin 생명주기 관리**: 의존성 그래프, 초기화 순서, 우선순위 기반 관리

### 🔗 유틸리티 및 지원 기능
- **Universal Message 시스템**: Provider별 메시지 어댑터
- **Logger 시스템**: 환경변수 기반 로그 레벨 제어 (silent 포함)
- **Error 클래스**: 표준화된 에러 처리 (ProviderError 등)
- **Agent Template**: 스키마 정의 및 내장 템플릿
- **Validation 유틸리티**: 설정 검증 및 기본값 적용

### 📦 패키지 호환성 및 마이그레이션
- **Provider 패키지 통합**: OpenAI, Anthropic, Google 모두 agents 표준 적용 완료
- **Team 패키지**: agents 표준 완전 마이그레이션 완료, 무한위임 방지 시스템 구현
- **Examples**: agents 표준 사용 및 정상 동작 확인
- **Sessions 패키지**: 기본 구조 마이그레이션 완료 (ConversationHistory 통합)
- **Tool 전달 시스템**: BaseAIProvider와 provider별 adapter 간 올바른 tool schema 전달 보장

### 🎛️ 개발 가이드라인 준수
- **Service 무상태화**: 모든 Service 클래스를 순수 함수 기반으로 설계
- **Manager 책임 분리**: Plugin 생명주기 관리 전담 Plugins 클래스 구현
- **인터페이스 통합**: interfaces/service.ts 통합 인터페이스 구조
- **에러 처리 표준화**: 일관된 에러 타입 및 컨텍스트 적용
- **순환 의존성 제거**: Provider re-export 방지로 깔끔한 의존성 구조

## 🏗️ 아키텍처 설계

### 핵심 추상화 계층

```
BaseAgent (추상 클래스)
└── Robota (BaseAgent 구현체 - AI 대화 + 도구 시스템 + Plugin System)

Plugin System (확장 기능):
├── BasePlugin (추상 플러그인 클래스)
├── ConversationHistoryPlugin, UsagePlugin, LoggingPlugin
├── PerformancePlugin, ErrorHandlingPlugin, LimitsPlugin
├── EventEmitterPlugin, WebhookPlugin
└── CustomPlugin (사용자 정의)
```

### 모듈 분리 구조

```
packages/agents/src/
├── abstracts/           # 추상 클래스들
│   ├── base-agent.ts
│   ├── base-manager.ts
│   ├── base-provider.ts
│   ├── base-ai-provider.ts
│   ├── base-tool.ts
│   └── base-plugin.ts
├── interfaces/          # 인터페이스 정의 (service.ts 통합)
│   ├── agent.ts
│   ├── provider.ts
│   ├── manager.ts
│   └── tool.ts
├── agents/             # 에이전트 시스템 전체
│   ├── robota.ts
│   ├── managers/       # 상태/리소스 관리자들 (AIProviders, Tools, AgentFactory, Plugins)
│   ├── services/       # 무상태 비즈니스 로직 처리자들
│   ├── tools/          # 도구 시스템 (registry, implementations)
│   ├── schemas/ 및 templates/
├── plugins/            # 플러그인 시스템 (8개 핵심 플러그인)
├── utils/              # 핵심 유틸리티 (Logger, Error, Validation)
└── index.ts            # 메인 export (순환 의존성 방지)
```

## 📦 호환성 보장

### 기존 패키지와의 호환성
- **@robota-sdk/sessions**: 기본 구조 마이그레이션 완료, ConversationHistory 통합
- **@robota-sdk/team**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/openai**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/anthropic**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/google**: agents 표준 완전 마이그레이션 완료

### API 설계 원칙
- **명확한 계층**: BaseAgent(추상) → Robota(구현체) → Plugin System(확장)
- **단일 책임**: 각 클래스는 명확한 범위의 기능만 담당
- **조합 가능**: 플러그인을 통해 필요한 기능만 선택적으로 추가
- **확장 용이**: 새로운 플러그인 추가를 통한 기능 확장

## 📋 남은 개발 작업

### Phase 1: 플러그인 시스템 완성
- [x] **Team Container 무한반복 해결**: allowFurtherDelegation 파라미터 추가로 위임 제어
- [x] **Tool 전달 문제 해결**: BaseAIProvider에서 올바른 tool schema 전달 수정
- [x] **Singleton 제거**: 완전한 인스턴스 격리를 위한 매니저 클래스들 수정
- [x] **ExecutionService 초기화 시점 수정**: Tool 등록 후 서비스 생성으로 변경
- [ ] **AgentTemplate**: 에이전트 설정 템플릿 로드

### Phase 3: 스트리밍 응답 지원 (11단계)
- [ ] OpenAI Provider 스트리밍 기능 구현
  - [ ] `generateStreamingResponse` 메서드 구현
  - [ ] OpenAI 스트리밍 API 연동
  - [ ] 스트리밍 응답 포맷 변환
- [ ] Anthropic Provider 스트리밍 기능 구현
  - [ ] Claude 스트리밍 API 연동
  - [ ] 응답 포맷 표준화
- [ ] Google Provider 스트리밍 기능 구현
  - [ ] Gemini 스트리밍 API 연동
  - [ ] 응답 포맷 표준화
- [ ] 스트리밍 예제 및 테스트
  - [ ] 기본 스트리밍 예제 작성
  - [ ] 도구 호출과 스트리밍 조합 테스트
  - [ ] 에러 처리 및 중단 기능

### Phase 4: 개발 가이드라인 검증
- [ ] **Package Independence**: 각 패키지가 독립적으로 사용 가능한지 검증
- [ ] **Stateless Services**: 모든 Service 클래스가 무상태인지 확인
- [ ] **Interface-first approach**: 인터페이스 우선 설계 원칙 적용
- [ ] **Lifecycle Management**: Manager와 Plugin의 적절한 생명주기 관리
- [ ] **Constructor Injection**: 의존성 주입이 constructor에서 이루어지는지 확인
- [ ] **Documentation Standards**: 모든 영어 주석, 의미있는 예제 포함
- [ ] **No console.log**: 직접적인 console.log 사용 금지 확인
- [ ] **Type Safety Standards**: Strict TypeScript 설정 준수

### Phase 5: 구현 품질 검증
**목적**: 구현된 모든 기능이 개발 가이드라인을 제대로 준수하는지 검증하고 바로잡기

#### 🎯 핵심 기능별 검증
- [ ] **Robota 클래스 검증**
  - [ ] BaseAgent 상속 구조 및 인터페이스 준수 확인
  - [ ] 매니저와 서비스 통합 방식 검증
  - [ ] 스트리밍 지원 구현 품질 확인
  - [ ] 플러그인 시스템 통합 검증
  - [ ] 에러 처리 및 생명주기 관리 검증

- [ ] **매니저 레이어 검증**
  - [ ] AIProviders: Singleton 패턴 및 상태 관리 검증
  - [ ] Tools: 도구 등록/관리 로직 검증
  - [ ] AgentFactory: 에이전트 생성/구성 검증
  - [ ] Plugins: 의존성 그래프 및 생명주기 검증
  - [ ] ConversationHistory: 대화 관리 검증

- [ ] **서비스 레이어 검증**
  - [ ] ConversationService: 무상태 구현 및 순수 함수 검증
  - [ ] ToolExecutionService: 병렬/순차 실행 로직 검증
  - [ ] ExecutionService: 파이프라인 워크플로우 검증

- [ ] **플러그인 시스템 검증**
  - [ ] 각 플러그인의 생명주기 후킹 검증
  - [ ] Plugin 의존성 및 초기화 순서 검증
  - [ ] 에러 처리 및 복구 메커니즘 검증
  - [ ] 성능 영향 및 메모리 사용량 검증

#### 🔍 코드 품질 검증
- [ ] **아키텍처 원칙 준수**
  - [ ] 단일 책임 원칙 (SRP) 준수 확인
  - [ ] 의존성 역전 원칙 (DIP) 준수 확인
  - [ ] 인터페이스 분리 원칙 (ISP) 준수 확인
  - [ ] 개방-폐쇄 원칙 (OCP) 준수 확인

- [ ] **타입 안전성 검증**
  - [ ] Strict TypeScript 설정 준수 확인
  - [ ] any 타입 사용 최소화 확인
  - [ ] Generic 타입 활용 적절성 확인
  - [ ] 타입 가드 함수 구현 검증

- [ ] **에러 처리 표준화 검증**
  - [ ] 모든 에러가 표준 에러 클래스 사용하는지 확인
  - [ ] 에러 컨텍스트 정보 적절성 확인
  - [ ] 에러 전파 및 복구 로직 검증

- [ ] **성능 및 메모리 최적화 검증**
  - [ ] 메모리 누수 방지 로직 확인
  - [ ] 불필요한 객체 생성 최소화 확인
  - [ ] 비동기 처리 최적화 확인

#### 🧪 통합 테스트 검증
- [ ] **패키지 간 호환성 테스트**
  - [ ] Provider 패키지들과의 통합 테스트
  - [ ] Team 패키지와의 연동 테스트
  - [ ] Sessions 패키지와의 기본 연동 테스트
  - [ ] Examples 실행 결과 검증

- [ ] **실제 사용 시나리오 테스트**
  - [ ] 기본 대화 시나리오 테스트
  - [ ] 도구 호출 시나리오 테스트
  - [ ] 플러그인 조합 시나리오 테스트
  - [ ] 에러 상황 처리 시나리오 테스트

### Phase 6: 테스트 및 문서화 (9단계)
- [ ] **JSDoc 완성**: 모든 public API에 완전한 JSDoc 추가
- [ ] 단위 테스트 작성
  - [ ] 각 클래스별 테스트
  - [ ] 통합 테스트
- [ ] 타입 정의 완성
  - [ ] TypeScript 타입 안전성 확보
  - [ ] JSDoc 문서화
- [ ] 사용 예제 작성
  - [ ] 기본 사용법
  - [ ] 고급 설정

### Phase 7: 빌드 및 배포 준비
- [ ] 통합 검증 및 최종 빌드
  - [ ] 모든 패키지 빌드 성공 확인
  - [ ] 타입 검사 통과 확인  
  - [ ] 예제 앱 정상 동작 확인
- [ ] 문서 업데이트
  - [ ] README 통합 가이드 작성
  - [ ] 마이그레이션 가이드 작성
  - [ ] CHANGELOG 작성

## 🔗 의존성 관리

### 외부 의존성 (최소화)
```json
{
  "dependencies": {
    "zod": "^3.24.4",
    "@dqbd/tiktoken": "^1.0.21"
  }
}
```

### Peer Dependencies (호환성용)
```json
{
  "peerDependencies": {
    "@robota-sdk/openai": "workspace:*",
    "@robota-sdk/anthropic": "workspace:*", 
    "@robota-sdk/google": "workspace:*"
  }
}
```

## 🚀 예상 사용법

```typescript
// 기본 사용법
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

// 기본 AI + 도구 기능
const robota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  tools: [weatherTool, calculatorTool]
});

// 플러그인 시스템 사용법 - 에이전트 생명주기 후킹
import { 
  ConversationHistoryPlugin,  // 대화 내역 저장
  AgentTemplatePlugin,        // 에이전트 설정 템플릿 저장
  UsagePlugin,                // 사용량 통계 수집
  LoggingPlugin,              // 동작 로그 기록
  PerformancePlugin,          // 성능 메트릭 수집
  ErrorHandlingPlugin,        // 에러 처리
  LimitsPlugin,               // 토큰/요청 한도 제한
  EventEmitterPlugin,         // Tool 이벤트 감지/전파
  WebhookPlugin               // 웹훅 알림 전송
} from '@robota-sdk/agents';

// 기본 + 필요한 플러그인만 주입
const basicRobota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai', 
  currentModel: 'gpt-4',
  tools: [weatherTool, calculatorTool],
  plugins: [
    new ConversationHistoryPlugin({ storage: 'memory', maxHistory: 100 }),
    new LoggingPlugin({ strategy: 'console', level: 'info' })
  ]
});

// 고급 설정 - 개발자가 다양한 전략 주입
const advancedRobota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4', 
  tools: [weatherTool, calculatorTool],
  plugins: [
    new ConversationHistoryPlugin({ storage: 'database', connectionString: 'postgresql://...' }),
    new AgentTemplatePlugin({ storage: 'file', templateDir: './templates' }),
    new LoggingPlugin({ strategy: 'file', level: 'debug', filePath: './logs' }),
    new PerformancePlugin({ strategy: 'prometheus', endpoint: '/metrics' }),
    new UsagePlugin({ strategy: 'remote', endpoint: 'https://analytics.example.com' }),
    new ErrorHandlingPlugin({ strategy: 'circuit-breaker', retryAttempts: 3 }),
    new LimitsPlugin({ strategy: 'sliding-window', maxTokens: 50000 }),
    new EventEmitterPlugin({ 
      events: ['tool.beforeExecute', 'tool.afterExecute', 'tool.success', 'tool.error']
    }),
    new WebhookPlugin({
      endpoints: ['https://webhook.example.com/agent-events'],
      events: ['conversation.completed', 'error.occurred'],
      headers: { 'Authorization': 'Bearer token123' }
    })
  ]
});

await advancedRobota.run('복잡한 작업을 수행해줘');
```
