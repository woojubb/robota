# Robota SaaS Website - 개발 로드맵

## 🎯 현재 상태 (2025-01-30)

### ✅ 완료된 주요 작업
- [x] **Enhanced EventService 시스템** - Team/Agent/Tool 계층적 이벤트 추적 완료 (750% 성능 향상)
- [x] **Tool Hook 중복 호출 문제 해결** - 정확한 이벤트 발생 보장
- [x] **Playground 계층 구조 시각화** - 34개 이벤트로 완전한 Tree 표시 완료
- [x] **RemoteExecutor 호환성** - HTTP 스트리밍 및 Tool 호출 지원 완료
- [x] **Zero Breaking Change** - 기존 코드 100% 호환성 유지
- [x] **Duck Typing 패턴** - ActionTrackingEventService 완전 구현

### 📋 남은 최적화 작업
현재 핵심 기능은 모두 완료되었으며, 추가 최적화 작업은 [REMAINING-TASKS.md](./REMAINING-TASKS.md)에서 관리됩니다.

## 📋 우선순위별 향후 계획

### 🔧 Phase 2: 사용자 인증 및 프로필 시스템 (우선순위: 높음)
**목표**: Firebase Authentication 기반 사용자 관리

- [ ] **Firebase 인증 설정**
  - Google, GitHub, 이메일 로그인 지원
  - 사용자 프로필 페이지 구현
  - 인증 상태 관리 (Context API)

- [ ] **사용자 데이터 관리**
  - Firestore 사용자 프로필 저장
  - 사용자별 설정 및 기본값 관리
  - 프로필 수정 및 삭제 기능

**예상 기간**: 5-7일  
**참고 문서**: [04-authentication-system.md](./04-authentication-system.md)

### 📊 Phase 3: API 사용량 관리 시스템 (우선순위: 높음)  
**목표**: 사용자별 크레딧 기반 사용량 제한

- [ ] **크레딧 시스템 구현**
  - 사용자별 크레딧 잔액 관리
  - AI 모델별 비용 계산 로직
  - 실시간 사용량 추적

- [ ] **Billing 통합**
  - Stripe 결제 시스템 연동
  - 구독 플랜 및 일회성 결제
  - 결제 내역 및 영수증 관리

**예상 기간**: 7-10일  
**참고 문서**: [05-api-usage-management.md](./05-api-usage-management.md)

### 🎨 Phase 4: UI/UX 개선 및 고급 기능 (우선순위: 중간)
**목표**: 사용자 경험 최적화

- [ ] **Playground 고급 기능**
  - 대화 저장 및 불러오기
  - 템플릿 시스템 (사용자 정의 Agent 설정)
  - 실행 기록 및 분석

- [ ] **반응형 디자인 완성**
  - 모바일 최적화
  - 다크 모드 지원
  - 접근성 개선

**예상 기간**: 5-7일  
**참고 문서**: [03-ui-ux-design.md](./03-ui-ux-design.md), [06-playground-design.md](./06-playground-design.md)

### 🚀 Phase 5: 배포 및 운영 인프라 (우선순위: 중간)
**목표**: 프로덕션 환경 구축

- [ ] **CI/CD 파이프라인**
  - GitHub Actions 워크플로우
  - 자동 테스트 및 배포
  - 환경별 배포 전략

- [ ] **모니터링 및 로깅**
  - Sentry 에러 추적
  - Firebase Analytics
  - 성능 모니터링

**예상 기간**: 3-5일

## 🎯 마일스톤

### 🏁 M1: EventService 완성 (2025-02-07 목표)
- EventService 아키텍처 완전 구현
- Team/Agent/Tool 통합 이벤트 시스템 동작
- Playground UI에서 완전한 계층 구조 표시

### 🏁 M2: 사용자 시스템 완성 (2025-02-14 목표)  
- Firebase 인증 시스템 완성
- 사용자 프로필 및 설정 관리
- 기본적인 사용량 추적

### 🏁 M3: 크레딧 시스템 완성 (2025-02-21 목표)
- 크레딧 기반 사용량 제한
- Stripe 결제 시스템 연동
- 구독 플랜 관리

### 🏁 M4: MVP 완성 (2025-02-28 목표)
- 모든 핵심 기능 동작
- UI/UX 최적화 완료
- 배포 인프라 구축

## ⚠️ 리스크 및 대응 방안

### 🚨 기술적 위험
- **EventService 복잡도**: 단계적 구현으로 위험 최소화
- **Firebase 제한사항**: 사용량 모니터링 및 백업 방안 준비
- **Stripe 연동**: 샌드박스 환경에서 충분한 테스트

### 📈 우선순위 변경 가능성
- EventService 구현이 예상보다 복잡할 경우 Phase 2 일정 조정
- 사용자 피드백에 따른 UI/UX 우선순위 변경
- 기술적 제약으로 인한 기능 범위 조정

## 🎯 성공 지표

### 기술적 지표
- [ ] EventService로 Team 실행 100% 추적 가능
- [ ] 사용자 인증 성공률 99% 이상
- [ ] 크레딧 계산 정확도 100%
- [ ] API 응답 시간 < 500ms

### 사용자 지표  
- [ ] Playground 사용률 증가
- [ ] 사용자 체류 시간 증가
- [ ] 오류 신고 건수 감소
- [ ] 사용자 만족도 점수 향상

---

**다음 업데이트**: EventService Phase 1 완료 후  
**책임자**: Development Team  
**검토 주기**: 주 단위 