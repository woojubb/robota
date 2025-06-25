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

모든 핵심 기능들이 완성되어 [`docs/packages/agents/`](docs/packages/agents/README.md)와 [기술 가이드라인](.cursor/rules/)으로 이동되었습니다.

### 📊 현재 상태 요약
- **82개 테스트 모두 통과**: Agents 76개 + Team 6개 테스트 성공
- **모든 Provider 통합 완료**: OpenAI, Anthropic, Google 패키지 agents 표준 적용
- **Team Collaboration 완성**: getStats 메서드 구현 및 예제 정상 동작
- **ConversationHistory 통합**: Core 패키지 기능 완전 이관 및 deprecated 처리
- **스트리밍 시스템 완성**: 모든 Provider에서 실시간 스트리밍 지원

## 🏗️ 아키텍처 설계

아키텍처 상세 설계는 [agents-architecture.mdc](.cursor/rules/agents-architecture.mdc)와 [development-guidelines.mdc](.cursor/rules/development-guidelines.mdc)로 이동되었습니다.

### 📦 호환성 보장
- **@robota-sdk/sessions**: 기본 구조 마이그레이션 완료, ConversationHistory 통합
- **@robota-sdk/team**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/openai**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/anthropic**: agents 표준 완전 마이그레이션 완료
- **@robota-sdk/google**: agents 표준 완전 마이그레이션 완료

## 📋 남은 개발 작업

### Phase 8: 레거시 코드 제거 및 클린업
- [ ] **레거시 타입 제거**
  - [x] agents 패키지에서 ModelResponse, StreamingResponseChunk 미존재 확인
  - [x] OpenAI parser에서 ModelResponse 제거하고 UniversalMessage 사용
  - [x] OpenAI stream handler에서 StreamingResponseChunk 제거하고 UniversalMessage 사용
  - [x] Anthropic parser에서 ModelResponse 제거하고 UniversalMessage 사용
  - [x] sessions 패키지에서 레거시 타입 export 제거
  - [x] Context 관련 레거시 타입 검토 및 정리
  - [x] UniversalMessage 타입 통일 (불필요한 UniversalAssistantMessage 등 별칭 제거)

- [x] **레거시 export 및 호환성 코드 제거**
  - [x] agents/index.ts의 LEGACY COMPATIBILITY EXPORTS 섹션 제거
  - [x] RobotaCore alias 제거 (Robota로 통일)
  - [x] 예제의 RobotaCore import 수정 (06-payload-logging.ts)
  - [x] 사용하지 않는 team-container-working.ts 파일 삭제

- [ ] **TODO 및 placeholder 구현 완성**
  - [ ] execution-service.ts의 "TODO: Implement proper streaming" 해결
  - [ ] openapi-tool.ts의 placeholder 구현 완성 또는 제거
  - [ ] mcp-tool.ts의 placeholder 구현 완성 또는 제거
  - [ ] 각종 storage의 placeholder 구현 검토

- [ ] **deprecated 메서드 제거**
  - [ ] ai-provider-manager.ts의 getAvailableModels() deprecated 메서드 제거
  - [ ] 기타 @deprecated 태그가 있는 메서드들 검토 및 제거

- [ ] **legacy 주석 및 문서 정리**
  - [ ] "legacy", "migrated from" 등의 주석 제거
  - [ ] 코드 내 마이그레이션 관련 주석 정리
  - [ ] OpenAI provider의 "no ModelResponse" 주석 정리

- [ ] **team-container-working.ts 정리**
  - [ ] 사용하지 않는 team-container-working.ts 파일 제거
  - [ ] RobotaCore import 정리

### Phase 9: 최종 마무리 작업
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
