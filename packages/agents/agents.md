# @robota-sdk/agents 패키지 개발 계획

## 📋 개요

`@robota-sdk/agents` 패키지는 기존 `@robota-sdk/core`와 `@robota-sdk/tools`의 기능을 통합하여 완전히 새롭게 만드는 통합 AI 에이전트 패키지입니다. 

### 주요 목표

1. **완전한 독립성**: 기존 core, tools 패키지를 import 하지 않고 순수하게 새로 구현
2. **모듈화된 설계**: 각 기능을 추상화부터 구체 구현까지 여러 파일로 분산
3. **기존 패키지 호환성**: sessions, team, openai, anthropic, google 패키지와 완벽 호환
4. **확장 가능한 아키텍처**: 미래 기능 추가를 위한 유연한 구조

## 🏗️ 아키텍처 설계

### 핵심 추상화 계층

```
BaseAgent (추상 클래스)
└── Robota (BaseAgent 구현체 - AI 대화 + 도구 시스템 + Plugin System)

Plugin System (확장 기능):
├── BasePlugin (추상 플러그인 클래스)
├── AnalyticsPlugin (사용량 분석)
├── LimitsPlugin (토큰/요청 제한)
├── CachingPlugin (응답 캐싱)
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
├── interfaces/          # 인터페이스 정의
│   ├── agent.ts
│   ├── provider.ts
│   ├── manager.ts
│   └── tool.ts
├── agents/             # 에이전트 시스템 전체 (Agent의 모든 구성 요소)
│   ├── robota.ts
│   ├── managers/       # 상태/리소스 관리자들 (등록, 선택, 구성)
│   │   ├── ai-provider-manager.ts    # AI Provider 등록/선택 관리
│   │   ├── tool-manager.ts           # Tool 등록/관리
│   │   └── agent-factory.ts          # Agent 생성/구성 관리
│   ├── services/       # 비즈니스 로직 처리자들 (무상태 워크플로우)
│   │   ├── conversation-service.ts   # 대화 처리 로직
│   │   ├── execution-service.ts      # 실행 파이프라인 로직
│   │   └── tool-execution-service.ts # Tool 실행 로직
│   ├── tools/          # 도구 시스템
│   │   ├── registry/
│   │   │   └── tool-registry.ts
│   │   └── implementations/
│   │       ├── function-tool.ts
│   │       ├── openapi-tool.ts
│   │       └── mcp-tool.ts
│   ├── schemas/
│   │   └── agent-template-schema.ts
│   └── templates/
│       └── builtin-templates.json
├── plugins/            # 플러그인 시스템 (에이전트 생명주기 후킹)
│   ├── conversation-history-plugin.ts      # 대화 내역을 DB/파일/메모리에 저장
│   ├── agent-template-plugin.ts            # 에이전트 설정 템플릿을 저장/로드
│   ├── usage-plugin.ts                     # 사용량 통계 수집 (호출 횟수, 토큰 사용량 등)
│   ├── logging-plugin.ts                   # 에이전트 동작 로그 기록 (디버깅/감사용)
│   ├── performance-plugin.ts               # 성능 메트릭 수집 (응답시간, 메모리 사용량)
│   ├── error-handling-plugin.ts            # 에러 발생 시 로깅/복구/재시도 처리
│   ├── limits-plugin.ts                    # 토큰/요청 한도 제한 (Rate Limiting)
│   ├── event-emitter-plugin.ts             # Tool 이벤트 감지/전파 (실행 전후, 성공/실패)
│   └── webhook-plugin.ts                   # 웹훅 알림 전송 (외부 시스템 알림)
├── utils/              # 핵심 유틸리티 함수들 (고정 기능)
│   └── message-converter.ts
└── index.ts            # 메인 export
```

## 📦 호환성 보장 계획

### 기존 패키지와의 호환성

- **@robota-sdk/sessions**: `AgentInterface` 구현으로 호환
- **@robota-sdk/team**: `TeamAgent` 인터페이스 구현으로 호환  
- **@robota-sdk/openai**: `AIProvider` 인터페이스로 호환
- **@robota-sdk/anthropic**: `AIProvider` 인터페이스로 호환
- **@robota-sdk/google**: `AIProvider` 인터페이스로 호환

### API 설계 원칙

- **명확한 계층**: BaseAgent(추상) → Robota(구현체) → Plugin System(확장)
- **단일 책임**: 각 클래스는 명확한 범위의 기능만 담당
- **조합 가능**: 플러그인을 통해 필요한 기능만 선택적으로 추가
- **확장 용이**: 새로운 플러그인 추가를 통한 기능 확장

## ✅ 개발 체크리스트

### Phase 1: 기본 구조 및 추상화 (1단계)
- [ ] 프로젝트 기본 구조 생성 (package.json, tsconfig.json 등)
- [ ] 기본 인터페이스 정의 (interfaces/ 폴더)
  - [ ] `AgentInterface` 정의
  - [ ] `AIProvider` 인터페이스 정의
  - [ ] `ToolProvider` 인터페이스 정의
  - [ ] `Manager` 인터페이스들 정의
- [ ] 추상 클래스들 구현 (abstracts/ 폴더)
  - [ ] `BaseAgent` 추상 클래스
  - [ ] `BaseManager` 추상 클래스
  - [ ] `BaseProvider` 추상 클래스
  - [ ] `BaseAIProvider` 추상 클래스
  - [ ] `BaseTool` 추상 클래스
  - [ ] `BasePlugin` 추상 클래스

### Phase 2: 유틸리티 및 기반 구조 (2단계) - 필수 지원 기능
- [ ] 메시지 변환기 구현 (utils/)
  - [ ] Universal Message 포맷 (고정)
  - [ ] Provider별 메시지 어댑터 (고정)
- [ ] Schemas & Templates (agents/)
  - [ ] Agent Template 스키마 정의
  - [ ] 내장 에이전트 템플릿들

### Phase 3: 도구 시스템 구현 (3단계) - 하위 레벨부터
- [ ] Tool Registry 구현 (agents/tools/registry/)
  - [ ] `ToolRegistry` 클래스 (도구 스키마 저장소)
  - [ ] 도구 스키마 정의 및 검증
- [ ] Tool Implementations (agents/tools/implementations/)
  - [ ] Zod 스키마 기반 함수 도구
  - [ ] OpenAPI 스키마 도구
  - [ ] MCP 프로토콜 도구

### Phase 4: 매니저들 구현 (4단계) - 상태/리소스 관리 레이어
- [ ] AI Provider Manager 구현 (agents/managers/)
  - [ ] `AIProviderManager` 클래스  
  - [ ] Provider 등록/해제/조회 기능
  - [ ] 현재 Provider 선택/변경 관리
  - [ ] Provider 상태 관리
- [ ] Tool Manager 구현 (agents/managers/)
  - [ ] `ToolManager` 클래스
  - [ ] 도구 등록/해제/조회 기능 (Tool Registry 사용)
  - [ ] 도구 상태 관리
- [ ] Agent Factory 구현 (agents/managers/)
  - [ ] `AgentFactory` 클래스
  - [ ] 에이전트 생성/구성 관리
  - [ ] 설정 검증 및 기본값 적용

### Phase 5: 서비스 구현 (5단계) - 무상태 비즈니스 로직 레이어
- [ ] Conversation Service (agents/services/)
  - [ ] 대화 컨텍스트 준비 로직
  - [ ] AI Provider 호출 및 응답 처리
  - [ ] 스트리밍 응답 처리 워크플로우
- [ ] Tool Execution Service (agents/services/)
  - [ ] 도구 실행 오케스트레이션 (Tool Manager의 도구들 사용)
  - [ ] 병렬/순차 실행 제어 로직
  - [ ] 도구 결과 수집 및 포맷팅
- [ ] Execution Service (agents/services/)
  - [ ] 전체 실행 파이프라인 워크플로우
  - [ ] 플러그인 생명주기 호출 로직
  - [ ] 에러 전파 및 복구 로직

### Phase 6: 플러그인 시스템 (6단계) - 에이전트 생명주기 후킹
- [ ] 플러그인 구현 (plugins/)
  - [ ] `ConversationHistoryPlugin` - 대화 내역 저장 (메모리/파일/DB)
  - [ ] `AgentTemplatePlugin` - 에이전트 설정 템플릿 저장/로드 (파일/DB/원격)
  - [ ] `UsagePlugin` - 사용량 통계 수집 (호출 횟수, 토큰 사용량, 비용 등)
  - [ ] `LoggingPlugin` - 동작 로그 기록 (Console/File/Remote, 디버깅/감사용)
  - [ ] `PerformancePlugin` - 성능 메트릭 수집 (응답시간, 메모리, CPU 사용량)
  - [ ] `ErrorHandlingPlugin` - 에러 발생 시 로깅/복구/재시도 처리
  - [ ] `LimitsPlugin` - 토큰/요청 한도 제한 (Rate Limiting, 비용 제어)
  - [ ] `EventEmitterPlugin` - Tool 이벤트 감지/전파 (실행 전후, 성공/실패)
  - [ ] `WebhookPlugin` - 웹훅 알림 전송 (외부 시스템 알림)

### Phase 7: 에이전트 구현체 (7단계) - 최종 조립
- [ ] Robota 구현 (agents/)
  - [ ] `Robota` 클래스 (BaseAgent 상속)
  - [ ] 모든 매니저와 서비스 통합
  - [ ] 기본 실행 파이프라인
  - [ ] 스트리밍 지원
  - [ ] 도구 호출 로직
  - [ ] 병렬 도구 실행
  - [ ] 플러그인 시스템 통합

### Phase 8: 호환성 테스트 (8단계)
- [ ] 기존 패키지 호환성 테스트
  - [ ] sessions 패키지 호환성
  - [ ] team 패키지 호환성
  - [ ] provider 패키지들 호환성

### Phase 9: 테스트 및 문서화 (9단계)
- [ ] 단위 테스트 작성
  - [ ] 각 클래스별 테스트
  - [ ] 통합 테스트
- [ ] 타입 정의 완성
  - [ ] TypeScript 타입 안전성 확보
  - [ ] JSDoc 문서화
- [ ] 사용 예제 작성
  - [ ] 기본 사용법
  - [ ] 고급 설정

### Phase 10: 빌드 및 배포 준비 (10단계)
- [ ] 빌드 설정 완료
  - [ ] tsup 설정
  - [ ] 타입 선언 파일 생성
- [ ] 패키지 메타데이터
  - [ ] package.json 완성
  - [ ] README 작성
  - [ ] CHANGELOG 준비

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

## 📝 다음 단계

이 계획서를 검토하신 후 승인해주시면:

1. **Phase 1**부터 순차적으로 개발 시작
2. **각 Phase 완료시 중간 검토** 진행
3. **호환성 테스트**를 각 단계마다 수행
4. **문제 발생시 즉시 계획 수정**

---

**✅ 승인 대기 중**: 이 계획으로 진행하시겠습니까? 