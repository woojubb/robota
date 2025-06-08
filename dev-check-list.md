# 코드 개선 체크리스트 - 남은 작업

## 📋 전체 개요
`packages/` 폴더 내 각 패키지의 코드 품질 개선을 위한 남은 작업들입니다.

---

## 🏗️ packages/core - 핵심 패키지

### 🎯 robota.ts (메인 클래스)
- [x] **Facade 패턴 적용**
  - [x] 핵심 메서드(run, runStream, close)만 Robota 클래스에 유지
  - [x] 기능별 매니저를 readonly 프로퍼티로 노출 (ai, system, functions, analytics, tools, limits, conversation)
  - [x] 복잡한 설정 메서드들을 각 매니저로 위임
  - [x] 기존 메서드들을 deprecated로 표시하여 점진적 마이그레이션 지원
  - [x] 위의 항목들을 수행하는 이유는 파일을 최대한 나누기 위함이다.

- [x] **인터페이스 분리 원칙 적용**
  - [x] RobotaCore 인터페이스: 핵심 실행 기능만 포함 (run, runStream, close)
  - [x] RobotaConfigurable 인터페이스: 설정 관련 기능만 포함 (callTool, getAvailableTools, clearConversationHistory)
  - [x] RobotaComplete 인터페이스: 전체 기능을 포함하는 통합 인터페이스
  - [x] 클라이언트가 필요한 기능만 의존하도록 인터페이스 분리

- [x] **클래스 단순화**
  - [x] `SimpleConversationHistory`와 `PersistentSystemConversationHistory`의 코드 중복 해결
  - [x] 공통 로직을 `BaseConversationHistory` 추상 클래스로 추출
  - [x] 편의 메서드들을 기본 클래스에서 구현하여 중복 제거
  - [x] 각 구현체는 핵심 기능만 구현하도록 단순화

---

## 📚 전체 프로젝트 공통 개선사항

### 📖 **TSDoc 주석 최적화 (모든 클래스)**
- [x] **상세한 예제들을 별도 examples/ 폴더로 분리**
  - [x] packages/core 내 모든 클래스
  - [x] packages/tools 내 모든 클래스  
  - [x] packages/sessions 내 모든 클래스
  - [x] packages/openai, packages/anthropic, packages/google 내 모든 클래스
- [x] **@see 태그 활용으로 중복 설명 제거**
  - [x] 관련 클래스/메서드 간 상호 참조 링크 추가
  - [x] 공통 개념에 대한 중복 설명 제거
- [x] **핵심 정보(@param, @returns, @throws)만 유지하여 파일 크기 30-40% 감소**
  - [x] 장황한 설명을 간결하게 정리
  - [x] 필수 정보만 유지하고 부가 설명은 examples/로 이동

---

## 공통
- [x] AI Provider의 packages/openai packages/anthropic packages/google 는 유사한 구조를 가져야 합니다.

## 🛠️ packages/tools - 도구 관리

### ⚙️ function.ts  
- [x] **거대한 파일 분해**
  - [x] 413줄의 파일을 기능별로 분리
  - [x] Zod 스키마 변환 로직을 `schema/zod-to-json.ts` 모듈로 분리
  - [x] JSON 스키마 변환 로직을 `schema/json-to-zod.ts` 모듈로 분리
  - [x] Function Registry를 `registry/function-registry.ts` 클래스로 분리
  - [x] Function 생성 유틸리티를 `factories/function-factory.ts` 모듈로 분리

- [x] **순수 함수 최적화**
  - [x] `zodToJsonSchema()` 함수의 복잡성을 작은 함수들로 분해
  - [x] 타입 변환 로직들을 각 타입별 순수 함수로 분해 (convertZodString, convertZodNumber 등)
  - [x] 재귀 호출 최적화 및 가독성 향상
  - [x] `createValidatedFunction` 추가로 향상된 검증 기능 제공

- [x] **에러 처리 강화**
  - [x] Zod 에러를 포맷팅하는 전용 함수 추가
  - [x] 인자 파싱 에러 처리 개선
  - [x] 타입 안전성 개선 및 명확한 에러 메시지 제공

### 🔧 기타 tool provider들
- [x] **공통 인터페이스 추상화**
  - [x] 각 tool provider들의 공통 로직 추출
  - [x] BaseToolProvider 추상 클래스 구현으로 공통 에러 처리, 로깅, 도구 검증 로직 통합
  - [x] ToolProviderError, ToolNotFoundError, ToolExecutionError 등 구조화된 에러 타입 추가
  - [x] 팩토리 패턴 적용으로 다양한 tool provider 생성 및 관리 시스템 구축
  - [x] ZodFunctionToolProvider, OpenAPIToolProvider, MCPToolProvider를 BaseToolProvider 기반으로 리팩토링
  - [x] ToolProviderFactory를 통한 통합 관리 및 자동 도구 라우팅 기능 구현

---

## 💬 packages/sessions - 세션 관리

### 🎮 session-impl.ts
- [x] **상태 관리 로직 개선**
  - [x] 세션 상태 변경을 상태 머신 패턴으로 구현 (`state/session-state-machine.ts`)
  - [x] 상태 전환 로직을 순수 함수로 분리
  - [x] 유효한 상태 전환만 허용하는 안전한 상태 관리

- [x] **에러 메시지 개선**
  - [x] 하드코딩된 한국어 메시지들을 상수로 분리 (`constants/error-messages.ts`)
  - [x] 일관된 에러 처리 패턴 적용 (SessionOperationError, StateTransitionError)
  - [x] 구조화된 에러 코드와 컨텍스트 정보 제공

- [x] **순수 함수 활용**
  - [x] 세션 관련 로직을 순수 함수로 분리 (`utils/session-utils.ts`)
  - [x] 메타데이터 업데이트, 통계 계산 등을 순수 함수로 구현
  - [x] 설정 검증 및 병합 로직을 재사용 가능한 함수로 분리

- [x] **캡슐화 강화**
  - [x] private 메서드들로 내부 구현 숨김 (_setActiveChat, _deactivateAllChats 등)
  - [x] readonly 프로퍼티로 외부 변경 방지
  - [x] 명확한 연산 권한 검사 (_ensureOperationAllowed)

---

## 🚀 우선순위별 개선 계획

### 🟡 중간 우선순위
1. [ ] **성능 최적화** - 메모리 사용량 개선
   - [ ] 도구 로딩 지연 최적화
   - [ ] 함수 스키마 캐싱 시스템 구현
   - [ ] 메모리 누수 방지를 위한 리소스 정리 메커니즘

### 🟢 낮은 우선순위
1. [ ] **i18n 시스템** - 다국어 지원
   - [ ] 에러 메시지 다국어 지원
   - [ ] 도구 설명 및 매개변수 설명 다국어 처리
   - [ ] 지역화된 로그 메시지
2. [ ] **문서화** - JSDoc 개선
   - [ ] API 문서 자동 생성 시스템 구축
   - [ ] 사용 예제 및 튜토리얼 확충

---

## 🔄 다음 단계
1. **성능 최적화** - 메모리 사용량 개선 및 도구 로딩 최적화
2. **i18n 시스템** - 다국어 지원 구현
3. **문서화** - JSDoc 개선 및 API 문서 자동 생성

---

## 📝 참고사항

- 모든 개선사항은 기존 API 호환성을 유지하면서 진행
- 테스트 코드를 함께 개선하여 리팩토링 안정성 확보
- 점진적 개선을 통해 시스템 안정성 유지

---

## ✅ 최근 완료 작업

### 🔧 Tool Provider 공통 인터페이스 추상화 (완료)
- **BaseToolProvider 추상 클래스**: 공통 에러 처리, 로깅, 도구 존재 검증 로직을 통합한 베이스 클래스 구현
- **구조화된 에러 시스템**: ToolProviderError, ToolNotFoundError, ToolExecutionError 등 명확한 에러 타입 정의
- **팩토리 패턴**: ToolProviderFactory를 통한 다양한 tool provider 생성 및 관리 시스템
- **기존 Provider 리팩토링**: ZodFunctionToolProvider, OpenAPIToolProvider, MCPToolProvider를 새로운 구조로 업그레이드
- **통합 API**: 다양한 tool provider들을 하나의 일관된 인터페이스로 관리할 수 있는 시스템 구축
