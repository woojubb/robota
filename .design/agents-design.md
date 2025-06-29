# @robota-sdk/agents 패키지 설계 문서

## 📋 개요

`@robota-sdk/agents` 패키지는 기존 `@robota-sdk/core`와 `@robota-sdk/tools`의 기능을 통합한 통합 AI 에이전트 패키지입니다.

### 설계 원칙

1. **완전한 독립성**: 기존 core, tools 패키지를 import 하지 않고 순수하게 새로 구현
2. **모듈화된 설계**: 각 기능을 추상화부터 구체 구현까지 여러 파일로 분산
3. **기존 패키지 호환성**: sessions, team, openai, anthropic, google 패키지와 완벽 호환
4. **확장 가능한 아키텍처**: 미래 기능 추가를 위한 유연한 구조
5. **타입 안전성**: Zero Any/Unknown Policy 준수 및 제네릭 타입 시스템

## 🎯 핵심 기능

### Agent 시스템
- **Type-safe 아키텍처**: 완전한 타입 안전성을 보장하는 BaseAgent 기반 시스템
- **플러그인 시스템**: 확장 가능한 모듈형 플러그인 아키텍처
- **설정 관리**: AgentConfig 기반 통합 설정 시스템
- **실행 서비스**: ExecutionService를 통한 안전한 명령 실행

### Provider 통합
- **멀티 Provider 지원**: OpenAI, Anthropic, Google 통합 지원
- **BaseAIProvider**: 모든 AI Provider의 공통 인터페이스
- **스트리밍 지원**: 실시간 응답 스트리밍 처리
- **타입 변환**: UniversalMessage 기반 Provider 간 호환성

### 도구 시스템 (Tools)
- **Function Tools**: Zod 스키마 기반 함수 도구 시스템
- **MCP Tools**: Model Context Protocol 도구 통합
- **도구 레지스트리**: 중앙화된 도구 관리 시스템
- **타입 안전성**: BaseTool 기반 타입 안전한 도구 구현

### Team Collaboration
- **다중 에이전트**: 여러 에이전트 간 협업 시스템
- **작업 할당**: 자동화된 작업 분배 및 관리
- **워크플로우**: 구조화된 팀 작업 흐름 관리
- **Facade 패턴**: 간단한 인터페이스로 복잡한 시스템 관리

### 플러그인 시스템
- **Conversation History**: 대화 기록 관리 및 저장
- **Error Handling**: 통합 오류 처리 및 컨텍스트 관리
- **Event Emitter**: 이벤트 기반 시스템 통신
- **Execution Analytics**: 실행 분석 및 성능 모니터링
- **Limits**: 리소스 및 사용량 제한 관리
- **Logging**: 구조화된 로깅 시스템
- **Performance**: 성능 모니터링 및 메트릭 수집
- **Usage**: 사용량 추적 및 분석
- **Webhook**: HTTP 기반 이벤트 알림

## 🏗 아키텍처 구조

### 계층 구조
```
@robota-sdk/agents
├── abstracts/          # 기본 추상 클래스들
├── agents/             # RobotaAgent 메인 구현
├── interfaces/         # 타입 정의 및 인터페이스
├── managers/           # 에이전트 팩토리 및 템플릿 관리
├── plugins/            # 확장 가능한 플러그인들
├── services/           # 핵심 서비스 로직
├── templates/          # 빌트인 에이전트 템플릿
├── tools/              # 도구 구현 및 레지스트리
└── utils/              # 유틸리티 함수들
```

### 주요 클래스
- **BaseAgent**: 모든 에이전트의 기본 클래스
- **BaseAIProvider**: AI Provider 추상화
- **BaseTool**: 도구 시스템 기본 클래스
- **BasePlugin**: 플러그인 시스템 기본 클래스
- **AgentFactory**: 에이전트 생성 및 관리
- **ExecutionService**: 명령 실행 관리

## 📦 패키지 호환성

### 통합된 패키지들
- **@robota-sdk/sessions**: 기본 구조 마이그레이션, ConversationHistory 통합
- **@robota-sdk/team**: agents 표준 마이그레이션, Facade 패턴 적용
- **@robota-sdk/openai**: agents 표준 마이그레이션, 타입 안전성 강화
- **@robota-sdk/anthropic**: agents 표준 마이그레이션, 타입 안전성 강화
- **@robota-sdk/google**: agents 표준 마이그레이션

### 타입 시스템 통합
- **Zero Any/Unknown Policy**: 모든 any/unknown 타입 제거
- **제네릭 타입 패턴**: 타입 매개변수 기반 시스템
- **UniversalMessage**: Provider 간 메시지 표준화
- **AgentConfig**: 통합 설정 시스템

## 📚 문서 구조

### 패키지 문서
- [packages/agents/docs/README.md](packages/agents/docs/README.md): 패키지 개요 및 사용법
- [packages/agents/docs/architecture.md](packages/agents/docs/architecture.md): 상세 아키텍처 설계
- [packages/agents/docs/development.md](packages/agents/docs/development.md): 개발 가이드

### 중앙 문서
- [docs/api-reference/](docs/api-reference/): API 레퍼런스 문서
- [docs/examples/](docs/examples/): 사용 예제 모음
- [docs/guide/](docs/guide/): 상세 가이드

## 🔧 개발 및 확장

### 새로운 Provider 추가
1. BaseAIProvider 상속
2. 타입 정의 (api-types.ts)
3. 메시지 변환기 구현
4. 스트리밍 핸들러 구현

### 새로운 플러그인 개발
1. BasePlugin 상속
2. 플러그인별 Stats 타입 정의
3. 이벤트 핸들러 구현
4. 설정 인터페이스 정의

### 새로운 도구 구현
1. BaseTool 상속
2. 도구 매개변수 타입 정의
3. 실행 로직 구현
4. 스키마 변환기 구현

## 📊 현재 상태

### 완성된 기능
- ✅ **아키텍처**: 모든 핵심 기능 구현
- ✅ **Provider 통합**: OpenAI, Anthropic, Google 완전 지원
- ✅ **Team Collaboration**: 다중 에이전트 협업 시스템
- ✅ **ConversationHistory**: Core 패키지 기능 완전 이관
- ✅ **스트리밍 시스템**: 실시간 응답 처리
- ✅ **타입 시스템**: Zero Any/Unknown Policy 달성
- ✅ **테스트**: 모든 테스트 통과
- ✅ **빌드**: 모든 패키지 성공적 빌드

### 기술적 성과
- **타입 안전성**: 100% any/unknown 타입 제거
- **제네릭 시스템**: 모든 기본 클래스 타입 매개변수화
- **Facade 패턴**: 4개 주요 컴포넌트 적용
- **플러그인 아키텍처**: 각 플러그인별 특화 타입 시스템
- **Provider 표준화**: BaseAIProvider 기반 일관된 인터페이스
