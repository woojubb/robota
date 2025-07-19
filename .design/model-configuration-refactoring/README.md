# 모델 설정 리팩토링 프로젝트 체크리스트

## 🎯 **프로젝트 목표**
Provider에서 모델 관련 설정을 제거하고, Robota의 defaultModel을 유일한 모델 설정 소스로 만들어 중복 제거 및 런타임 모델 전환 최적화

## 📋 **Phase 1: 인터페이스 및 타입 정리**

### **1.1 Provider Options 인터페이스 수정**
- [ ] `packages/openai/src/types.ts` - OpenAIProviderOptions 수정
  - [ ] `model` 필드 제거
  - [ ] `temperature` 필드 제거
  - [ ] `maxTokens` 필드 제거
  - [ ] `topP` 필드 제거
  - [ ] Provider 고유 설정만 유지 (organization, baseURL, timeout 등)
  - [ ] `executor?: ExecutorInterface` 추가 (향후 원격 실행용)

- [ ] `packages/anthropic/src/types.ts` - AnthropicProviderOptions 수정
  - [ ] 동일한 모델 관련 필드 제거
  - [ ] Provider 고유 설정만 유지

- [ ] `packages/google/src/types.ts` - GoogleProviderOptions 수정
  - [ ] 동일한 모델 관련 필드 제거
  - [ ] Provider 고유 설정만 유지

### **1.2 AgentConfig 인터페이스 검증**
- [ ] `packages/agents/src/interfaces/agent.ts` 확인
  - [ ] `defaultModel`이 Required인지 확인
  - [ ] 중복 모델 설정 필드 제거 (model?, provider?, temperature? 등)
  - [ ] `defaultModel` 구조 최적화

## 📋 **Phase 2: Provider 구현체 수정**

### **2.1 OpenAI Provider 수정**
- [ ] `packages/openai/src/provider.ts` 수정
  - [ ] Constructor에서 모델 관련 옵션 제거
  - [ ] `chat()` 메서드에서 ChatOptions 우선 사용 확인
  - [ ] 기본값 설정 로직 제거 (ChatOptions에서만 처리)
  - [ ] Provider 고유 설정만 저장

### **2.2 Anthropic Provider 수정**
- [ ] `packages/anthropic/src/provider.ts` 수정
  - [ ] 동일한 수정 사항 적용

### **2.3 Google Provider 수정**
- [ ] `packages/google/src/provider.ts` 수정
  - [ ] 동일한 수정 사항 적용

### **2.4 BaseAIProvider 확인**
- [ ] `packages/agents/src/abstracts/base-ai-provider.ts` 검토
  - [ ] 모델 관련 추상화가 ChatOptions 기반인지 확인
  - [ ] Provider별 모델 설정 의존성 제거

## 📋 **Phase 3: Core Logic 검증**

### **3.1 ExecutionService 확인**
- [ ] `packages/agents/src/services/execution-service.ts` 검증
  - [ ] `config.defaultModel`을 ChatOptions로 전달하는지 확인
  - [ ] Provider별 모델 설정을 사용하지 않는지 확인

### **3.2 AIProviders Manager 확인**
- [ ] `packages/agents/src/managers/ai-provider-manager.ts` 검증
  - [ ] `setCurrentProvider()` 메서드가 올바르게 작동하는지 확인
  - [ ] 모델 검증 로직이 적절한지 확인

### **3.3 Robota 클래스 확인**
- [ ] `packages/agents/src/agents/robota.ts` 검증
  - [ ] `setModel()` 메서드가 올바르게 작동하는지 확인
  - [ ] `getModel()` 메서드가 올바르게 작동하는지 확인
  - [ ] 초기화 로직에서 defaultModel 사용 확인

## 📋 **Phase 4: 테스트 수정**

### **4.1 Unit Tests 수정**
- [ ] `packages/openai/src/provider.test.ts` (있다면)
  - [ ] 모델 관련 테스트 제거 또는 수정
  - [ ] ChatOptions 기반 테스트 추가

- [ ] `packages/anthropic/src/provider.test.ts` (있다면)
  - [ ] 동일한 수정 사항 적용

- [ ] `packages/google/src/provider.test.ts` (있다면)
  - [ ] 동일한 수정 사항 적용

### **4.2 Integration Tests 수정**
- [ ] `packages/agents/src/agents/robota.test.ts` 수정
  - [ ] Provider 생성 테스트에서 모델 관련 옵션 제거
  - [ ] `setModel()` 테스트 검증
  - [ ] `getModel()` 테스트 검증
  - [ ] 런타임 모델 전환 테스트 검증

- [ ] `packages/agents/src/services/execution-service.test.ts` 수정
  - [ ] Provider 모델 설정을 사용하지 않는 테스트로 수정

## 📋 **Phase 5: 예제 및 문서 업데이트**

### **5.1 예제 코드 검색 및 수정**
- [ ] `apps/examples/` 폴더 전체 검색
  - [ ] `01-basic-conversation.ts` 수정
  - [ ] `02-tool-calling.ts` 수정
  - [ ] `03-multi-providers.ts` 수정
  - [ ] 기타 모든 예제 파일 검색 및 수정

- [ ] `packages/*/examples/` 폴더들 검색
  - [ ] 각 패키지의 예제 파일들 수정

### **5.2 README 파일 업데이트**
- [ ] `packages/openai/README.md` 수정
  - [ ] Provider 생성 예제에서 모델 관련 옵션 제거
  - [ ] 새로운 사용법 예제 추가

- [ ] `packages/anthropic/README.md` 수정
  - [ ] 동일한 수정 사항 적용

- [ ] `packages/google/README.md` 수정
  - [ ] 동일한 수정 사항 적용

- [ ] `packages/agents/README.md` 수정
  - [ ] 새로운 모델 설정 방식 설명
  - [ ] 런타임 모델 전환 예제 업데이트

- [ ] 루트 `README.md` 수정
  - [ ] 메인 예제 코드 업데이트

### **5.3 API 문서 업데이트**
- [ ] `docs/api-reference/` 폴더 검색
  - [ ] Provider 관련 문서 업데이트
  - [ ] AgentConfig 문서 업데이트
  - [ ] 마이그레이션 가이드 추가

### **5.4 가이드 문서 업데이트**
- [ ] `docs/examples/` 폴더 검색
  - [ ] 모든 예제 문서에서 Provider 생성 방식 수정

- [ ] `docs/guide/` 폴더 검색
  - [ ] 모델 설정 관련 가이드 업데이트

## 📋 **Phase 6: 전체 코드베이스 검색**

### **6.1 키워드 기반 검색**
- [ ] "model:" 키워드로 전체 검색
  - [ ] Provider 옵션에서 model 설정하는 코드 찾아 수정

- [ ] "temperature:" 키워드로 전체 검색
  - [ ] Provider 옵션에서 temperature 설정하는 코드 찾아 수정

- [ ] "maxTokens:" 키워드로 전체 검색
  - [ ] Provider 옵션에서 maxTokens 설정하는 코드 찾아 수정

- [ ] "new OpenAIProvider" 키워드로 전체 검색
  - [ ] 모든 OpenAIProvider 생성 코드 수정

- [ ] "new AnthropicProvider" 키워드로 전체 검색
  - [ ] 모든 AnthropicProvider 생성 코드 수정

- [ ] "new GoogleProvider" 키워드로 전체 검색
  - [ ] 모든 GoogleProvider 생성 코드 수정

### **6.2 패턴 기반 검색**
- [ ] Provider constructor 패턴 검색
  - [ ] `{ model: '`, `{ temperature:`, `{ maxTokens:` 패턴 검색
  - [ ] 모든 해당 코드 수정

## 📋 **Phase 7: 테스트 및 검증**

### **7.1 컴파일 검증**
- [ ] 전체 프로젝트 TypeScript 컴파일 확인
- [ ] 타입 에러 모두 해결
- [ ] 빌드 에러 모두 해결

### **7.2 단위 테스트 실행**
- [ ] 각 패키지별 테스트 실행
- [ ] 모든 테스트 통과 확인
- [ ] 새로운 테스트 케이스 추가 (필요시)

### **7.3 통합 테스트 실행**
- [ ] 전체 시스템 테스트 실행
- [ ] 런타임 모델 전환 기능 테스트
- [ ] 다중 Provider 전환 테스트

### **7.4 예제 실행 테스트**
- [ ] 모든 예제 파일 실행 테스트
- [ ] 문서의 예제 코드 실행 테스트

## 📋 **Phase 8: 문서화 및 마무리**

### **8.1 마이그레이션 가이드 작성**
- [ ] Breaking Changes 목록 작성
- [ ] Before/After 코드 예제 제공
- [ ] 마이그레이션 단계별 가이드 작성

### **8.2 CHANGELOG 업데이트**
- [ ] 각 패키지의 CHANGELOG.md 업데이트
- [ ] Breaking Change 명시
- [ ] 새로운 기능 설명

### **8.3 최종 문서 검토**
- [ ] 모든 문서의 일관성 확인
- [ ] 예제 코드의 정확성 확인
- [ ] 링크 및 참조 확인

## 🎯 **우선순위 및 순서**

### **High Priority (즉시 실행)**
1. Phase 1: 인터페이스 수정
2. Phase 2: Provider 구현체 수정
3. Phase 7.1: 컴파일 검증

### **Medium Priority (Phase 1-2 완료 후)**
4. Phase 4: 테스트 수정
5. Phase 7.2-7.3: 테스트 실행

### **Low Priority (핵심 작업 완료 후)**
6. Phase 5: 예제 및 문서 업데이트
7. Phase 6: 전체 코드베이스 검색
8. Phase 8: 문서화 및 마무리

## ⚠️ **주의사항**

### **Breaking Changes 관리**
- 모든 변경사항을 문서화
- 기존 사용자를 위한 마이그레이션 가이드 필수
- 버전 업그레이드 시 Major 버전 증가 고려

### **후진 호환성**
- 가능한 한 기존 API 유지
- Deprecated 표시 후 점진적 제거 고려
- 사용자 피드백 수집 후 최종 결정

### **테스트 커버리지**
- 모든 변경사항에 대한 테스트 추가
- 엣지 케이스 테스트 포함
- 런타임 모델 전환 시나리오 철저히 테스트 