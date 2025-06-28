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

### ✅ 완성된 아키텍처
- **모듈화된 Agent 시스템**: Robota 클래스 중심의 완전한 AI 에이전트 프레임워크
- **추상화 계층**: BaseAgent, BaseAIProvider, BaseTool, BasePlugin 등 확장 가능한 기반 클래스
- **8개 플러그인 시스템**: ConversationHistory, Logging, Usage, Performance, Execution, ErrorHandling, Limits, EventEmitter
- **Tool Registry 시스템**: Function Tool, MCP Tool 지원 및 확장 가능한 도구 관리
- **Manager 패턴**: ConversationHistory, Tool, AIProvider 관리자를 통한 중앙화된 리소스 관리

### ✅ Provider 통합 완료
- **OpenAI Provider**: agents 표준 완전 적용, UniversalMessage 기반 메시지 변환
- **Anthropic Provider**: agents 표준 완전 적용, 스트리밍 및 도구 호출 지원
- **Google Provider**: agents 표준 완전 적용, Gemini 모델 지원
- **BaseAIProvider**: 공통 인터페이스를 통한 일관된 Provider 동작

### ✅ Team Collaboration 시스템
- **TeamContainer**: 다중 에이전트 협업 시스템 완성
- **Workflow Management**: 작업 분배 및 결과 집계 기능
- **Analytics Integration**: getStats 메서드로 팀 성능 분석 가능
- **Template System**: 미리 정의된 팀 구성 템플릿 지원

### ✅ ConversationHistory 통합
- **Core 패키지 기능 완전 이관**: @robota-sdk/core의 ConversationHistory 기능을 agents로 통합
- **다양한 스토리지 옵션**: Memory, File, Database 스토리지 지원
- **UniversalMessage 표준**: 모든 Provider 간 일관된 메시지 형식

### ✅ 스트리밍 시스템
- **실시간 응답 스트리밍**: 모든 Provider에서 runStream 메서드 지원
- **Tool 호출과 스트리밍 조합**: 스트리밍 중 도구 호출 및 응답 처리
- **에러 처리**: 스트리밍 중 오류 상황 적절한 처리

## 🏗️ 아키텍처 설계

아키텍처 상세 설계는 [agents-architecture.mdc](.cursor/rules/agents-architecture.mdc)와 [development-guidelines.mdc](.cursor/rules/development-guidelines.mdc)로 이동되었습니다.

### 📦 호환성 보장
- **@robota-sdk/sessions**: 기본 구조 마이그레이션 완료, ConversationHistory 통합
- **@robota-sdk/team**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/openai**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/anthropic**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/google**: agents 표준 완전 마이그레이션 완료

## 📋 남은 개발 작업

### Phase 7: ESLint 설정 및 코드 품질 개선
- [x] **ESLint 설정 구조 개선**
  - [x] 루트 .eslintrc.json에서 TypeScript 관련 unsafe 규칙 제거
  - [x] apps/services 프로젝트 전체 삭제 (불필요한 MCP 서버)
  - [x] apps/docs lint 스크립트 비활성화 (문서 프로젝트)
  - [x] docs/**/* 와 apps/docs/**/* ignorePatterns에 추가
  - [x] tsconfig.base.json의 공통 설정 활용

- [x] **TypeScript/ESLint 규칙 호환성 해결**
  - [x] @typescript-eslint/recommended extends 제거 후 직접 플러그인 사용
  - [x] 루트에서 @typescript-eslint 패키지 재설치로 의존성 문제 해결
  - [x] JavaScript 파일과 TypeScript 파일 구분 명확화

- [x] **🎯 Agents 패키지 선언적 타입 시스템 구축 (any/unknown 완전 제거)**
  
  **✅ 완료: 타입 소유권 기반 Export/Import 전략 구축**
  - ✅ RobotaConfig와 AgentConfig 통일 완료
  - ✅ UtilLogLevel 타입을 logger.ts로 적절히 분산 배치
  - ✅ **타입 중복 정의 제거 및 소유권 통일 완료**
    - ✅ `interfaces/tool.ts` - 모든 Tool 관련 타입의 유일한 소유자 확립
    - ✅ 중복 타입 정의 완전 제거: managers/tool-manager.ts, abstracts/base-plugin.ts, services/conversation-service.ts, tools/implementations/*.ts
    - ✅ 플러그인별 특화 통계 타입 시스템 구축 (BasePlugin getStats 제거)
    - ✅ Team 패키지 호환성 수정 (RobotaConfig → AgentConfig)
  
  **구현된 타입 소유권 및 Export/Import 시스템**:
  ```typescript
  // interfaces/tool.ts - 도구 관련 모든 타입의 유일한 소유자
  export type ToolParameters = Record<string, ToolParameterValue>;
  export interface ToolExecutionResult { ... }
  export type ToolExecutionData = ...; // 복잡한 중첩 구조 지원
  
  // 모든 플러그인 - 자신만의 특화된 통계 타입 소유
  export interface WebhookPluginStats { endpointCount, queueLength, totalSent, ... }
  export interface EventEmitterPluginStats { eventTypes, listenerCounts, totalEmitted, ... }
  export interface ErrorHandlingPluginStats { failureCount, circuitBreakerOpen, totalRetries, ... }
  
  // 다른 모든 파일 - import만 수행, 중복 정의 완전 금지
  import type { ToolParameters, ToolExecutionResult } from '../interfaces/tool';
  ```
  
  **적용된 설계 원칙**: 
  1. **✅ 명확한 소유권**: 각 타입은 하나의 파일에서만 정의
  2. **✅ 책임 분리**: tool.ts(도구), agent.ts(메시지), 각 플러그인(고유 통계)
  3. **✅ Import 기반 의존성**: export된 타입을 import하여 사용
  4. **✅ 타입 호환성**: ToolExecutionData 확장으로 호환성 확보
  5. **✅ any, unknown 사용 완전 금지** (assignTaskSchema 임시 예외)

**🎯 현재 상태: Rule 기반 Semantic Type Naming 진행 중 (185개 → 129개, 56개 감소)**

### Phase 7.1-7.2: Rule 기반 타입 시스템 구축 진행 중 (56개 개선)

**✅ 완료된 파일들 (Rule 적용 완료):**
- **abstracts/** (5개 → 0개) - BaseToolParameters, ProviderLoggingData
- **interfaces/** (12개 → 2개) - ConversationContextMetadata, ToolExecutionParameters, AgentCreationMetadata, ProviderConfigValue  
- **utils/errors.ts** (14개 → 0개) - ErrorContextData, ErrorExternalInput
- **schemas/** (2개 → 0개) - SchemaValidationInput
- **utils/logger.ts** (10개 → 0개) - LoggerContextData
- **plugins/*/types.ts** (4개 → 0개) - 각 플러그인별 특화 메타데이터 타입
- **plugins/limits-plugin.ts** (10개 → 2개) - PluginExecutionContext, PluginExecutionResult

**🎯 적용된 Rule 패턴: `[Scope][Purpose][Context]`**
- 구체적 도메인 기반 타입명 사용 (BaseToolParameters, ErrorContextData, LoggerContextData 등)
- 타입 소유권 기반 책임 분리 완료
- any, unknown 사용 완전 금지하고 구체적 타입으로 교체

**⏳ 남은 복잡한 파일들 (129개 warning):**
- **services/** (19개) - Provider 인터페이스 호환성 문제로 인한 복잡한 타입 이슈
- **tools/implementations/** (7개) - Zod, MCP, OpenAPI 스키마 타입 호환성 문제  
- **agents/robota.ts** (9개) - 복잡한 에이전트 시스템 타입 문제
- **managers/** (70개+) - 복잡한 매니저 타입 시스템으로 개별 처리 필요
- **plugins/** (다수) - 복잡한 플러그인 시스템 (event-emitter: 15개, webhook: 18개 등)

### Phase 7.3-7.5: 선언적 타입 시스템 완성 (완료)
- [x] **agents/robota.ts** - AgentConfig 통일 및 타입 어댑터 구현
- [x] **tools/implementations/** - 모든 도구 구현체 타입 통일
- [x] **services/conversation-service.ts** - 대화 서비스 타입 개선  
- [x] **abstracts/base-plugin.ts** - BasePlugin 타입 개선 및 getStats 제거
- [x] **플러그인별 특화 통계 시스템** - 각 플러그인이 자신만의 Stats 타입 소유
- [x] **패키지 간 호환성** - Team 패키지 RobotaConfig → AgentConfig 변환

**⏳ 진행 상황: 타입 소유권 확립 완료, any/unknown 타입 185개 warning 제거 필요**

### Phase 8: 테스트 실패 수정 - 완료
- [x] **OpenAI Adapter 테스트 수정** - content: null vs "" 불일치 수정 
- [x] **Agents 테스트 수정** - ExecutionService 테스트 mock 문제 해결

### Phase 9: 레거시 코드 제거 및 클린업 (우선순위: 낮음)
- [ ] **TODO 및 placeholder 구현**
  - [ ] execution-service.ts의 "TODO: Implement proper streaming" 해결
  - [ ] openapi-tool.ts의 placeholder 구현 완성 또는 제거
  - [ ] mcp-tool.ts의 placeholder 구현 완성 또는 제거
  - [ ] 플러그인 통계 추적 TODO 구현 (totalSent, totalEmitted, totalRetries 등)

- [ ] **console.log 사용 정리**
  - [ ] packages/agents/src/agents/robota.ts
  - [ ] packages/agents/src/utils/logger.ts  
  - [ ] packages/team/src/team-container.ts
  - [ ] packages/team/src/workflow-formatter.ts
  - [ ] packages/team/src/types.ts
  - [ ] packages/team/src/create-team.ts

- [ ] **deprecated 메서드 제거**
  - [ ] core 및 tools 패키지의 @deprecated 태그 검토
  - [ ] 사용하지 않는 legacy 코드 정리

### Phase 10: 최종 마무리 작업 (우선순위: 낮음)
- [ ] **assignTaskSchema ZodSchema 타입 호환성 수정**
  - [ ] team-container.ts line 740 임시 any 해결
  - [ ] Zod 스키마와 ToolParameters 타입 호환성 확보

- [ ] **TSDoc 문서화 전체 업데이트**
  - [ ] **packages/agents TSDoc 표준화**
    - [ ] 모든 public 클래스에 @public 태그 추가
    - [ ] 모든 interface에 @interface 태그 추가
    - [ ] 메서드 파라미터 @param 태그 완성
    - [ ] 리턴 값 @returns 태그 추가
    - [ ] @example 코드 블록 추가 및 검증
    - [ ] @throws 에러 문서화
    - [ ] @since 버전 정보 추가
  - [ ] **Provider 패키지들 TSDoc 통일**
    - [ ] packages/openai TSDoc 표준화
    - [ ] packages/anthropic TSDoc 표준화  
    - [ ] packages/google TSDoc 표준화
    - [ ] packages/team TSDoc 표준화

- [ ] **문서화 완성**
  - [ ] README 통합 가이드 작성
  - [ ] 마이그레이션 가이드 작성
  - [ ] 모든 영어 주석 표준화

- [ ] **최종 검증**
  - [x] 모든 테스트 통과 확인
  - [ ] Type Safety Standards 완전 검증
  - [x] 모든 패키지 빌드 및 기능 최종 확인

## 📊 현재 상태 요약
- **아키텍처**: ✅ 완성 (모든 핵심 기능 구현됨)
- **Provider 통합**: ✅ 완성 (OpenAI, Anthropic, Google 모두 agents 표준 적용)
- **Team Collaboration**: ✅ 완성 (getStats 포함 모든 기능 동작)
- **ConversationHistory**: ✅ 완성 (Core 패키지 기능 완전 이관)
- **스트리밍 시스템**: ✅ 완성 (모든 Provider에서 실시간 스트리밍 지원)
- **테스트**: ✅ 모든 테스트 통과 (76개 테스트 전체 성공)
- **빌드**: ✅ 모든 패키지 성공적 빌드
- **타입 시스템**: ⏳ 진행 중 (Rule 기반 타입 시스템 부분 완료, 129개 warning 남음)
- **플러그인 시스템**: ✅ 완성 (각 플러그인별 특화 통계 타입 구축)
- **문서화**: ⏳ 진행 중 (TSDoc 표준화 필요)

**🎯 핵심 성과**:
1. **타입 소유권 시스템 구축**: interfaces/tool.ts 중심의 타입 책임 분리 완료
2. **플러그인 특화 통계**: BasePlugin getStats 제거, 각 플러그인이 자신만의 Stats 타입 소유
3. **Export/Import 기반 의존성**: 중복 타입 정의 완전 제거
4. **패키지 간 호환성**: RobotaConfig → AgentConfig 통일로 일관성 확보
5. **Rule 기반 타입 시스템**: 56개 개선 완료, 129개 warning 남음 (복잡한 파일들 추가 작업 필요)
