# 🧹 코드 정리 및 제거 계획

## 📋 정리 개요

실시간 워크플로우 시각화 시스템 개발 과정에서 생성된 테스트 파일, 임시 코드, 더 이상 사용하지 않는 기능들을 체계적으로 정리하는 계획입니다.

## 🗑️ 제거 대상 파일들

### **테스트 파일 제거**
- [ ] `apps/examples/context-debug-test.ts` - 컨텍스트 디버그 테스트

### **완료된 프로젝트 문서 제거**
- (모든 항목 정리 완료)

### **더 이상 사용하지 않는 코드**
- (모든 항목 정리 완료)

## 🔧 유지해야 할 파일들

### **핵심 구현 파일들** ✅
- `packages/team/src/services/sub-agent-event-relay.ts` - SubAgent 이벤트 중계
- `packages/agents/src/services/workflow-event-subscriber.ts` - 워크플로우 이벤트 구독
- `packages/agents/src/services/real-time-workflow-builder.ts` - 워크플로우 빌더
- `packages/agents/src/services/real-time-mermaid-generator.ts` - Mermaid 생성기
- `apps/examples/24-workflow-structure-test.ts` - 최종 검증된 테스트

### **수정된 기존 파일들** ✅
- `packages/team/src/team-container.ts` - SubAgentEventRelay 통합
- `packages/agents/src/services/execution-service.ts` - tool_call 이벤트 추가
- `packages/agents/src/services/tool-execution-service.ts` - 호환성 복원
- `packages/agents/src/abstracts/base-tool.ts` - ToolHooks 제거 및 단순화

## 📝 정리 작업 체크리스트

### **1단계: 테스트 파일 정리**
- (모든 항목 정리 완료)

### **2단계: 문서 정리**
- (모든 항목 정리 완료)

### **3단계: 주석 및 디버그 코드 정리**
- [ ] `packages/team/src/services/sub-agent-event-relay.ts`에서 console.log 제거
- [ ] `packages/agents/src/services/workflow-event-subscriber.ts`에서 디버그 로그 정리
- [ ] `packages/agents/src/services/real-time-workflow-builder.ts`에서 개발용 주석 정리
- [ ] `apps/examples/24-workflow-structure-test.ts`에서 과도한 로깅 최적화

### **4단계: TypeScript 타입 정리**
- [ ] 사용하지 않는 import 제거
- [ ] 사용하지 않는 interface 및 type 정리
- [ ] export되지만 사용하지 않는 기능들 정리

### **5단계: 패키지 의존성 정리**
- [ ] `package.json`에서 사용하지 않는 devDependencies 제거
- [ ] 더 이상 필요하지 않은 test script 정리
- [ ] 버전 업데이트가 필요한 패키지들 정리

## 🧪 정리 후 검증 계획

### **빌드 검증**
- [ ] 모든 패키지 빌드 성공 확인
  ```bash
  pnpm build
  ```

- [ ] TypeScript 타입 에러 없음 확인
- [ ] ESLint 경고 최소화

### **기능 검증**
- [ ] `24-workflow-structure-test.ts` 실행하여 기능 정상 작동 확인
- [ ] 실시간 워크플로우 시각화 정상 동작 확인
- [ ] Mermaid 다이어그램 렌더링 정상 확인

### **문서 검증**
- [ ] README.md의 정확성 확인
- [ ] 예제 코드들이 실제로 동작하는지 확인
- [ ] API 문서와 실제 구현의 일치성 확인

## 📊 정리 전후 비교

### **정리 전 상태**
```
총 파일 수: ~50개 (테스트, 임시 파일 포함)
테스트 결과 파일: 6개
임시 문서: 3개
디버그 코드: 다수 포함
```

### **정리 후 현재 상태** ✅
```
핵심 파일만 유지: ~20개 (달성)
테스트 결과 파일: 0개 (모든 파일 삭제 완료)
완성된 문서만 유지: 현재 상태 반영 (달성)
불필요한 테스트 파일: 모두 제거 완료
```

## ⚠️ 주의사항

### **백업 필요 항목**
- [ ] 현재 작업 상태 Git 커밋
- [ ] 주요 테스트 결과 파일들 별도 보관 (필요시)
- [ ] 설계 문서들의 히스토리 보존

### **점진적 정리**
- 한 번에 모든 파일을 삭제하지 말고 단계별로 진행
- 각 단계 후 빌드 및 기능 테스트 실행
- 문제 발생 시 즉시 롤백 가능하도록 준비

### **팀 협업 고려**
- 삭제 전 팀원들과 협의 (혹시 필요한 파일이 있는지 확인)
- 중요한 테스트 케이스나 설계 아이디어는 문서화 후 정리
- Git 히스토리를 통해 언제든 복구 가능하도록 관리

## 🎯 정리 완료 후 다음 단계

### **즉시 진행 가능**
- 웹 플랫폼 개발 시작
- React 컴포넌트 통합
- 실시간 UI 구현

### **문서화 완료**
- 깔끔하게 정리된 설계 문서
- 명확한 API 문서  
- 사용법 가이드

### **유지보수 준비**
- 체계적인 코드 구조
- 명확한 책임 분리
- 확장 가능한 아키텍처

이 정리 계획을 통해 개발 환경을 깔끔하게 정리하고, 다음 단계 개발에 집중할 수 있는 기반을 마련합니다.