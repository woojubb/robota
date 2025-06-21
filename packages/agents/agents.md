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
│   ├── managers/
│   │   ├── ai-provider-manager.ts
│   │   ├── tool-manager.ts
│   │   └── agent-factory.ts
│   ├── services/
│   │   ├── conversation-service.ts
│   │   ├── execution-service.ts
│   │   └── tool-execution-service.ts
│   ├── tools/
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
├── plugins/            # 플러그인 시스템 (확장/주입 가능한 기능들)
│   ├── analytics-plugin.ts
│   ├── limits-plugin.ts
│   ├── caching-plugin.ts
│   ├── logging-plugin.ts
│   ├── performance-plugin.ts
│   ├── error-handling-plugin.ts
│   ├── conversation-plugin.ts
│   ├── system-message-plugin.ts
│   └── agent-template-plugin.ts
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
  - [ ] `ToolRegistry` 클래스 (고정)
  - [ ] 도구 스키마 정의 (고정)
- [ ] Tool Implementations (agents/tools/implementations/)
  - [ ] Zod 스키마 기반 함수 도구 (고정)
  - [ ] OpenAPI 스키마 도구 (고정)
  - [ ] MCP 프로토콜 도구 (고정)
- [ ] Tool Manager 구현 (agents/managers/)
  - [ ] `ToolManager` 클래스
  - [ ] 도구 등록/관리 기능 (Tool Registry 사용)

### Phase 4: 에이전트 매니저들 구현 (4단계) - 관리 레이어
- [ ] AI Provider Manager 구현 (agents/managers/)
  - [ ] `AIProviderManager` 클래스  
  - [ ] Provider 등록/관리 기능 (고정)
  - [ ] 현재 Provider 선택 기능 (고정)
- [ ] Agent Factory 구현 (agents/managers/)
  - [ ] `AgentFactory` 클래스
  - [ ] 에이전트 생성 및 설정 관리

### Phase 5: 에이전트 서비스 구현 (5단계) - 비즈니스 로직 레이어
- [ ] Conversation Service (agents/services/)
  - [ ] 대화 컨텍스트 준비
  - [ ] AI 응답 생성
  - [ ] 스트리밍 처리
- [ ] Tool Execution Service (agents/services/)
  - [ ] 도구 실행 오케스트레이션 (Tool Manager 사용)
  - [ ] 병렬/순차 실행 제어
  - [ ] 도구 결과 처리
- [ ] Execution Service (agents/services/)
  - [ ] 기본 실행 파이프라인 관리
  - [ ] 플러그인 생명주기 실행 준비

### Phase 6: 플러그인 시스템 (6단계) - 확장 기능들
- [ ] Core Plugins 구현 (확장/주입 가능한 기능들)
  - [ ] `AnalyticsPlugin` - 사용량 분석 전략 주입 가능
  - [ ] `LimitsPlugin` - 토큰/요청 제한 전략 주입 가능
  - [ ] `CachingPlugin` - 캐싱 전략 주입 가능 (Memory/Redis/File)
  - [ ] `LoggingPlugin` - 로깅 전략 주입 가능 (Console/File/Remote)
  - [ ] `PerformancePlugin` - 성능 측정/리소스 관리 전략 주입 가능
  - [ ] `ErrorHandlingPlugin` - 에러 처리 전략 주입 가능
  - [ ] `ConversationPlugin` - 대화 히스토리 저장 전략 주입 가능 (Memory/File/DB)
  - [ ] `SystemMessagePlugin` - 시스템 메시지 관리 전략 주입 가능 (Static/Dynamic/Template)
  - [ ] `AgentTemplatePlugin` - 에이전트 템플릿 관리 전략 주입 가능

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

// 플러그인 시스템 사용법 - 개발자가 전략을 주입할 수 있는 기능들
import { 
  AnalyticsPlugin, 
  LimitsPlugin, 
  CachingPlugin,
  LoggingPlugin,
  PerformancePlugin,
  ErrorHandlingPlugin,
  ConversationPlugin,
  SystemMessagePlugin
} from '@robota-sdk/agents';

// 기본 + 필요한 플러그인만 주입
const basicRobota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai', 
  currentModel: 'gpt-4',
  tools: [weatherTool, calculatorTool],
  plugins: [
    new LoggingPlugin({ strategy: 'console', level: 'info' }),
    new ConversationPlugin({ storage: 'memory', maxHistory: 100 })
  ]
});

// 고급 설정 - 개발자가 다양한 전략 주입
const advancedRobota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4', 
  tools: [weatherTool, calculatorTool],
  plugins: [
    // 로깅 전략 주입
    new LoggingPlugin({ strategy: 'file', level: 'debug', filePath: './logs' }),
    
    // 대화 히스토리 저장 전략 주입
    new ConversationPlugin({ storage: 'database', connectionString: 'postgresql://...' }),
    
    // 시스템 메시지 관리 전략 주입
    new SystemMessagePlugin({ strategy: 'template', templatePath: './prompts' }),
    
    // 캐싱 전략 주입
    new CachingPlugin({ strategy: 'redis', host: 'localhost', ttl: 600 }),
    
    // 제한 전략 주입
    new LimitsPlugin({ strategy: 'sliding-window', maxTokens: 50000 }),
    
    // 성능 모니터링 전략 주입
    new PerformancePlugin({ strategy: 'prometheus', endpoint: '/metrics' }),
    
    // 에러 처리 전략 주입
    new ErrorHandlingPlugin({ strategy: 'circuit-breaker', retryAttempts: 3 })
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