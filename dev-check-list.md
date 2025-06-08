# 코드 개선 체크리스트 - 남은 작업

## 📋 전체 개요
`packages/` 폴더 내 각 패키지의 코드 품질 개선을 위한 남은 작업들입니다.

---

## 🚀 우선순위별 개선 계획

### 🟢 낮은 우선순위
1. **i18n 시스템** - 다국어 지원
   - 에러 메시지 다국어 지원
   - 도구 설명 및 매개변수 설명 다국어 처리
   - 지역화된 로그 메시지
2. **문서화** - JSDoc 개선
   - API 문서 자동 생성 시스템 구축
   - 사용 예제 및 튜토리얼 확충

---

## 🔄 다음 단계
1. **i18n 시스템** - 다국어 지원 구현
2. **문서화** - JSDoc 개선 및 API 문서 자동 생성

---

## 📝 참고사항

- 모든 개선사항은 기존 API 호환성을 유지하면서 진행
- 테스트 코드를 함께 개선하여 리팩토링 안정성 확보
- 점진적 개선을 통해 시스템 안정성 유지

---

## ✅ 완료된 작업

### 🏗️ packages/core - 핵심 패키지 (완료)

#### 🎯 robota.ts (메인 클래스)
- **Facade 패턴 적용**
  - 핵심 메서드(run, runStream, close)만 Robota 클래스에 유지
  - 기능별 매니저를 readonly 프로퍼티로 노출 (ai, system, functions, analytics, tools, limits, conversation)
  - 복잡한 설정 메서드들을 각 매니저로 위임
  - 기존 메서드들을 deprecated로 표시하여 점진적 마이그레이션 지원
  - 파일을 최대한 나누기 위한 구조 개선

- **인터페이스 분리 원칙 적용**
  - RobotaCore 인터페이스: 핵심 실행 기능만 포함 (run, runStream, close)
  - RobotaConfigurable 인터페이스: 설정 관련 기능만 포함 (callTool, getAvailableTools, clearConversationHistory)
  - RobotaComplete 인터페이스: 전체 기능을 포함하는 통합 인터페이스
  - 클라이언트가 필요한 기능만 의존하도록 인터페이스 분리

- **클래스 단순화**
  - `SimpleConversationHistory`와 `PersistentSystemConversationHistory`의 코드 중복 해결
  - 공통 로직을 `BaseConversationHistory` 추상 클래스로 추출
  - 편의 메서드들을 기본 클래스에서 구현하여 중복 제거
  - 각 구현체는 핵심 기능만 구현하도록 단순화

### 📚 전체 프로젝트 공통 개선사항 (완료)

#### 📖 TSDoc 주석 최적화 (모든 클래스)
- **상세한 예제들을 별도 examples/ 폴더로 분리**
  - packages/core 내 모든 클래스
  - packages/tools 내 모든 클래스  
  - packages/sessions 내 모든 클래스
  - packages/openai, packages/anthropic, packages/google 내 모든 클래스
- **@see 태그 활용으로 중복 설명 제거**
  - 관련 클래스/메서드 간 상호 참조 링크 추가
  - 공통 개념에 대한 중복 설명 제거
- **핵심 정보(@param, @returns, @throws)만 유지하여 파일 크기 30-40% 감소**
  - 장황한 설명을 간결하게 정리
  - 필수 정보만 유지하고 부가 설명은 examples/로 이동

#### 공통 구조 통일
- AI Provider의 packages/openai packages/anthropic packages/google 구조 통일

### 🛠️ packages/tools - 도구 관리 (완료)

#### ⚙️ function.ts 리팩토링
- **거대한 파일 분해**
  - 413줄의 파일을 기능별로 분리
  - Zod 스키마 변환 로직을 `schema/zod-to-json.ts` 모듈로 분리
  - JSON 스키마 변환 로직을 `schema/json-to-zod.ts` 모듈로 분리
  - Function Registry를 `registry/function-registry.ts` 클래스로 분리
  - Function 생성 유틸리티를 `factories/function-factory.ts` 모듈로 분리

- **순수 함수 최적화**
  - `zodToJsonSchema()` 함수의 복잡성을 작은 함수들로 분해
  - 타입 변환 로직들을 각 타입별 순수 함수로 분해 (convertZodString, convertZodNumber 등)
  - 재귀 호출 최적화 및 가독성 향상
  - `createValidatedFunction` 추가로 향상된 검증 기능 제공

- **에러 처리 강화**
  - Zod 에러를 포맷팅하는 전용 함수 추가
  - 인자 파싱 에러 처리 개선
  - 타입 안전성 개선 및 명확한 에러 메시지 제공

#### 🔧 Tool Provider 공통 인터페이스 추상화
- **BaseToolProvider 추상 클래스**: 공통 에러 처리, 로깅, 도구 존재 검증 로직을 통합한 베이스 클래스 구현
- **구조화된 에러 시스템**: ToolProviderError, ToolNotFoundError, ToolExecutionError 등 명확한 에러 타입 정의
- **팩토리 패턴**: ToolProviderFactory를 통한 다양한 tool provider 생성 및 관리 시스템
- **기존 Provider 리팩토링**: ZodFunctionToolProvider, OpenAPIToolProvider, MCPToolProvider를 새로운 구조로 업그레이드
- **통합 API**: 다양한 tool provider들을 하나의 일관된 인터페이스로 관리할 수 있는 시스템 구축

#### 🚀 성능 최적화 시스템 구현 (2024.12.15 완료)
- **캐싱 시스템** (`cache-manager.ts`)
  - LRU + TTL 알고리즘을 지원하는 `CacheManager` 클래스 구현
  - 함수 스키마 전용 `FunctionSchemaCacheManager` 구현
  - 캐시 통계 추적 (히트율, 메모리 사용량) 기능
  - 자동 캐시 정리 스케줄링 시스템
  - ZodFunctionToolProvider에 함수 스키마 지연 로딩 + 캐싱 통합

- **지연 로딩 시스템** (`lazy-loader.ts`)
  - 온디맨드 리소스 로딩을 위한 `LazyLoader` 클래스 구현
  - 우선순위 기반 프리로딩 시스템
  - 동시 로딩 제한으로 메모리 과부하 방지
  - 도구 관리 전용 `ToolLazyLoader` 구현
  - 로딩 통계 및 성능 추적 기능

- **리소스 관리** (`resource-manager.ts`)
  - 메모리 누수 방지를 위한 `ResourceManager` 구현
  - 나이 및 메모리 사용량 기반 자동 리소스 정리
  - 주기적 메모리 모니터링 및 임계값 관리
  - 프로세스 종료 시 graceful shutdown 처리
  - Tool Provider 최적화된 `ToolProviderResourceManager` 구현

- **성능 모니터링** (`performance-monitor.ts`)
  - 실시간 성능 추적을 위한 `PerformanceMonitor` 구현
  - 도구 호출 타이밍, 성공률, 처리량(TPS) 메트릭 수집
  - 메모리 사용량 모니터링 및 힙 추적
  - 성능 리포트 생성 시스템
  - 이벤트 기반 모니터링 및 커스터마이징 가능한 알림 임계값

- **통합 및 아키텍처 업데이트**
  - `BaseToolProvider`에 성능 모니터링 자동 통합
  - 모든 도구 호출에 대한 타이밍 및 성공/실패 메트릭 추적
  - 기존 tool provider들의 새로운 베이스 클래스 사용 업데이트
  - `index.ts`에서 모든 새로운 성능 최적화 API 내보내기
  - 한글 주석 및 메시지를 모두 영어로 국제화

### 💬 packages/sessions - 세션 관리 (완료)

#### 🎮 session-impl.ts 개선
- **상태 관리 로직 개선**
  - 세션 상태 변경을 상태 머신 패턴으로 구현 (`state/session-state-machine.ts`)
  - 상태 전환 로직을 순수 함수로 분리
  - 유효한 상태 전환만 허용하는 안전한 상태 관리

- **에러 메시지 개선**
  - 하드코딩된 한국어 메시지들을 상수로 분리 (`constants/error-messages.ts`)
  - 일관된 에러 처리 패턴 적용 (SessionOperationError, StateTransitionError)
  - 구조화된 에러 코드와 컨텍스트 정보 제공

- **순수 함수 활용**
  - 세션 관련 로직을 순수 함수로 분리 (`utils/session-utils.ts`)
  - 메타데이터 업데이트, 통계 계산 등을 순수 함수로 구현
  - 설정 검증 및 병합 로직을 재사용 가능한 함수로 분리

- **캡슐화 강화**
  - private 메서드들로 내부 구현 숨김 (_setActiveChat, _deactivateAllChats 등)
  - readonly 프로퍼티로 외부 변경 방지
  - 명확한 연산 권한 검사 (_ensureOperationAllowed)
