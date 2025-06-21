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

### Phase 1: 기본 구조 및 추상화 (1단계) ✅ 완료
- [x] 프로젝트 기본 구조 생성 (package.json, tsconfig.json 등)
- [x] 기본 인터페이스 정의 (interfaces/ 폴더)
  - [x] `AgentInterface` 정의
  - [x] `AIProvider` 인터페이스 정의
  - [x] `ToolProvider` 인터페이스 정의
  - [x] `Manager` 인터페이스들 정의
- [x] 추상 클래스들 구현 (abstracts/ 폴더)
  - [x] `BaseAgent` 추상 클래스
  - [x] `BaseManager` 추상 클래스
  - [x] `BaseProvider` 추상 클래스
  - [x] `BaseAIProvider` 추상 클래스
  - [x] `BaseTool` 추상 클래스
  - [x] `BasePlugin` 추상 클래스

### Phase 2: 유틸리티 및 기반 구조 (2단계) ✅ 완료 - 필수 지원 기능
- [x] 메시지 변환기 구현 (utils/)
  - [x] Universal Message 포맷 (고정)
  - [x] Provider별 메시지 어댑터 (고정)
- [x] 유틸리티 추가 구현 (utils/)
  - [x] Logger 시스템
  - [x] Validation 유틸리티
  - [x] Error 클래스들
- [x] Schemas & Templates (agents/)
  - [x] Agent Template 스키마 정의
  - [x] 내장 에이전트 템플릿들

### Phase 3: 도구 시스템 구현 (3단계) ✅ 완료 - 하위 레벨부터
- [x] Tool Registry 구현 (tools/registry/)
  - [x] `ToolRegistry` 클래스 (도구 스키마 저장소)
  - [x] 도구 스키마 정의 및 검증
- [x] Tool Implementations (tools/implementations/)
  - [x] Zod 스키마 기반 함수 도구
  - [x] OpenAPI 스키마 도구 (기본 구조)
  - [x] MCP 프로토콜 도구 (기본 구조)

### Phase 4: 매니저들 구현 (4단계) ✅ 완료 - 상태/리소스 관리 레이어
- [x] AI Provider Manager 구현 (agents/managers/)
  - [x] `AIProviderManager` 클래스  
  - [x] Provider 등록/해제/조회 기능
  - [x] 현재 Provider 선택/변경 관리
  - [x] Provider 상태 관리
- [x] Tool Manager 구현 (agents/managers/)
  - [x] `ToolManager` 클래스
  - [x] 도구 등록/해제/조회 기능 (Tool Registry 사용)
  - [x] 도구 상태 관리
- [x] Agent Factory 구현 (agents/managers/)
  - [x] `AgentFactory` 클래스
  - [x] 에이전트 생성/구성 관리
  - [x] 설정 검증 및 기본값 적용

### Phase 5: 서비스 구현 (5단계) ✅ 완료 - 무상태 비즈니스 로직 레이어
- [x] Conversation Service (agents/services/)
  - [x] 대화 컨텍스트 준비 로직
  - [x] AI Provider 호출 및 응답 처리
  - [x] 스트리밍 응답 처리 워크플로우
- [x] Tool Execution Service (agents/services/)
  - [x] 도구 실행 오케스트레이션 (Tool Manager의 도구들 사용)
  - [x] 병렬/순차 실행 제어 로직
  - [x] 도구 결과 수집 및 포맷팅
- [x] Execution Service (agents/services/)
  - [x] 전체 실행 파이프라인 워크플로우
  - [x] 플러그인 생명주기 호출 로직
  - [x] 에러 전파 및 복구 로직

### Phase 6: 플러그인 시스템 (6단계) ✅ 완료 - 에이전트 생명주기 후킹
- [x] 플러그인 구현 (plugins/)
  - [x] `ConversationHistoryPlugin` - 대화 내역 저장 (메모리/파일/DB)
  - [ ] `AgentTemplatePlugin` - 에이전트 설정 템플릿 저장/로드 (파일/DB/원격)
  - [x] `UsagePlugin` - 사용량 통계 수집 (호출 횟수, 토큰 사용량, 비용 등)
  - [x] `LoggingPlugin` - 동작 로그 기록 (Console/File/Remote, 디버깅/감사용)
  - [x] `PerformancePlugin` - 성능 메트릭 수집 (응답시간, 메모리, CPU 사용량)
  - [x] `ErrorHandlingPlugin` - 에러 발생 시 로깅/복구/재시도 처리
  - [x] `LimitsPlugin` - 토큰/요청 한도 제한 (Rate Limiting, 비용 제어)
  - [x] `EventEmitterPlugin` - Tool 이벤트 감지/전파 (실행 전후, 성공/실패)
  - [x] `WebhookPlugin` - 웹훅 알림 전송 (외부 시스템 알림)

### Phase 7: 에이전트 구현체 (7단계) ✅ 완료 - 최종 조립
- [x] Robota 구현 (agents/)
  - [x] `Robota` 클래스 (BaseAgent 상속)
  - [x] 모든 매니저와 서비스 통합
  - [x] 기본 실행 파이프라인
  - [x] 스트리밍 지원
  - [x] 도구 호출 로직
  - [x] 병렬 도구 실행
  - [x] 플러그인 시스템 통합

### Phase 8: 전체 마이그레이션 (8단계) - 기존 호환성 제거
- [x] Provider 패키지들 완전 마이그레이션 (core/tools → agents)
  - [x] @robota-sdk/openai: BaseAIProvider, Context, ModelResponse, StreamingResponseChunk, ToolSchema 사용 ✅ 빌드 성공
  - [x] @robota-sdk/anthropic: agents 표준으로 완전 마이그레이션 ✅ 빌드 성공
  - [x] @robota-sdk/google: agents 표준으로 완전 마이그레이션 ✅ 빌드 성공
- [ ] 의존 패키지들 마이그레이션 (core/tools → agents)
  - [ ] @robota-sdk/team: agents 표준으로 완전 재작성 (우선 진행 - AgentFactory, AgentTemplate 패턴 확립)
  - [ ] @robota-sdk/sessions: agents 표준으로 완전 재작성 (team의 AgentFactory/Template 패턴 참조하여 개발)
- [ ] Example 앱들 마이그레이션
  - [ ] apps/examples: core/tools 제거하고 agents만 사용하도록 완전 재작성 (대기)
- [ ] Core/Tools 패키지 완전 제거
  - [ ] packages/core 폴더 삭제 (대기)
  - [ ] packages/tools 폴더 삭제 (대기)
  - [ ] workspace에서 core/tools 의존성 완전 제거 (대기)

**현재 상태**: 모든 Provider 패키지들(OpenAI, Anthropic, Google) 마이그레이션 성공! 

**다음 단계**: Team 패키지를 우선 마이그레이션하여 AgentFactory/AgentTemplate 패턴을 확립한 후, 이를 참조하여 Sessions 패키지를 재작성하는 순서로 진행

**마이그레이션 전략**:
- Team 패키지는 최신 코드로 AgentFactory와 AgentTemplate을 잘 활용하고 있음
- Team의 구조와 패턴을 agents 표준으로 마이그레이션하여 모범 사례 확립
- Sessions 패키지는 Team의 AgentFactory/Template 활용 방식을 참조하여 agents 표준으로 재작성

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

## 📝 다음 단계

이 계획서를 검토하신 후 승인해주시면:

1. **Phase 1**부터 순차적으로 개발 시작
2. **각 Phase 완료시 중간 검토** 진행
3. **호환성 테스트**를 각 단계마다 수행
4. **문제 발생시 즉시 계획 수정**

---

**✅ 승인 대기 중**: 이 계획으로 진행하시겠습니까? 