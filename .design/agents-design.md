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
- **컴포지션 패턴**: 의존성 주입을 통한 느슨한 결합과 단일 책임 원칙 적용

### 🤖 에이전트 시스템
- **Robota 클래스**: BaseAgent 구현체로 AI 대화 + 도구 시스템 + Plugin System 통합
- **무상태 서비스 레이어**: ConversationService, ToolExecutionService, ExecutionService
- **매니저 레이어**: AIProviders, Tools, AgentFactory, Plugins, ConversationHistory
- **병렬 도구 실행**: 동시 다중 도구 호출 지원

### 🌊 스트리밍 응답 시스템
- **실시간 스트리밍**: 모든 AI Provider에서 스트리밍 응답 지원 완료
- **모듈화 아키텍처**: Provider별 스트리밍/파싱 로직을 별도 클래스로 분리
- **OpenAI Provider**: OpenAIStreamHandler, OpenAIResponseParser로 구조화
- **Anthropic Provider**: AnthropicStreamHandler, AnthropicResponseParser로 구조화  
- **Google Provider**: GoogleStreamHandler로 구조화
- **파일 크기 최적화**: 300-500+ 라인 파일을 150라인 내외 모듈로 분할

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

### 📦 패키지 통합 및 호환성
- **Provider 패키지**: OpenAI, Anthropic, Google 모두 agents 표준 적용 및 스트리밍 구현 완료
- **Team 패키지**: agents 표준 완전 마이그레이션 완료, 무한위임 방지 시스템 구현
- **Examples**: agents 표준 사용 및 정상 동작 확인
- **Sessions 패키지**: 기본 구조 마이그레이션 완료 (ConversationHistory 통합)
- **Tool 전달 시스템**: BaseAIProvider와 provider별 adapter 간 올바른 tool schema 전달 보장
- **빌드 검증**: 모든 Provider 패키지 빌드 성공 및 TypeScript strict 모드 호환성 확보

### 📚 문서화 및 예제
- **API 문서화**: 모든 public API에 완전한 JSDoc 문서 완성 (클래스, 인터페이스, 메서드)
- **모듈 문서화**: 패키지 수준 문서화 및 사용 가이드 제공
- **사용 예제**: 기본 사용법과 고급 스트리밍 기능을 보여주는 완전한 예제 코드
- **예제 실행 검증**: 모든 예제 파일 정상 동작 확인 (기본 대화, 멀티 프로바이더, 도구 호출, 스트리밍 등)

### 🧪 테스트 시스템
- **핵심 컴포넌트 테스트**: Robota 클래스 13개 테스트 모두 통과 (100% 성공률)
- **매니저 테스트**: AgentFactory 18개, ToolManager 22개, ConversationHistory 17개 테스트 완료
- **서비스 테스트**: ExecutionService 6개 테스트 완료 (에러 처리, 도구 호출, 스트리밍 포함)
- **Team 패키지 테스트**: TeamContainer 6개 테스트 완료 (getStats, getTeamStats, resetTeamStats, 에러 처리)
- **전체 테스트**: 82개 테스트 모두 통과하는 안정적인 테스트 스위트 (Agents 76개 + Team 6개)

### 🎛️ 개발 가이드라인 준수
- **Service 무상태화**: 모든 Service 클래스를 순수 함수 기반으로 설계
- **Manager 책임 분리**: Plugin 생명주기 관리 전담 Plugins 클래스 구현
- **인터페이스 통합**: interfaces/service.ts 통합 인터페이스 구조
- **에러 처리 표준화**: 일관된 에러 타입 및 컨텍스트 적용
- **순환 의존성 제거**: Provider re-export 방지로 깔끔한 의존성 구조
- **품질 검증**: 24개 검증 항목 중 23개 통과 (95.8% 품질 점수)

### 🔌 AI Provider Architecture Separation 리팩토링
- **Provider-agnostic 인터페이스 완성**: ModelResponse, Context, StreamingResponseChunk 레거시 타입 완전 제거
- **BaseAIProvider 완전 재설계**: UniversalMessage 기반 provider-agnostic 인터페이스 구현
- **OpenAI Provider 완전 재구현**: OpenAI SDK native 타입 내부 사용, UniversalMessage 변환 자체 구현
- **Anthropic Provider 완전 재구현**: Anthropic SDK native 타입 내부 사용, Claude 고유 기능 활용
- **Google Provider 완전 재구현**: Google SDK native 타입 내부 사용, Gemini 고유 기능 활용
- **패키지 의존성 완전 격리**: Provider → agents 단방향 의존성, 순환 의존성 완전 제거
- **Tool Calling 무한 루프 해결**: OpenAI Provider에서 content: null 처리 올바르게 구현
- **독립적 빌드 검증**: 모든 Provider 패키지 개별 빌드 성공 및 기능 정상 작동 확인

### 🗂️ ConversationHistory 시스템 완전 통합
- **Core vs Agents 패키지 분석**: 기능 차이점 분석 및 통합 전략 수립
- **타입 시스템 완전 통합**: Core의 완전한 JSDoc, type guard, factory 함수들을 Agents에 통합
- **아키텍처 개선**: ConversationHistoryInterface 표준화, BaseConversationHistory 추상 클래스 구현
- **구현체 완전 이관**: SimpleConversationHistory, PersistentSystemConversationHistory, ConversationSession, ConversationHistory
- **Core/Tools 패키지 Deprecated**: 모든 코드 삭제, deprecated 경고 및 re-export 구조로 하위 호환성 보장
- **테스트 검증**: ConversationHistory 17개 테스트 통과, factory 함수 새 시그니처 적용

### 🤝 Team Collaboration 시스템 완성
- **getStats 메서드 구현**: TeamContainer에 예제 호환 getStats() 메서드 추가
- **실행 시간 추적**: execute 메서드에서 태스크 완료 수, 실행 시간, 에이전트 생성 수 추적
- **예제 정상화**: 05-team-collaboration.ts, 05-team-collaboration-ko.ts 모두 정상 실행
- **테스트 시스템**: 6개 단위 테스트 추가 및 모두 통과 (getStats, getTeamStats, resetTeamStats, 에러 처리)

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

### Phase 8: 최종 마무리 작업
- [ ] **스트리밍 예제 및 테스트**
  - [ ] 기본 스트리밍 예제 작성
  - [ ] 도구 호출과 스트리밍 조합 테스트
  - [ ] 에러 처리 및 중단 기능

- [ ] **문서화 완성**
  - [ ] README 통합 가이드 작성
  - [ ] 마이그레이션 가이드 작성
  - [ ] 모든 영어 주석 표준화

- [ ] **최종 검증**
  - [ ] No console.log 사용 금지 확인
  - [ ] Type Safety Standards 완전 검증
  - [ ] 모든 패키지 빌드 및 기능 최종 확인
