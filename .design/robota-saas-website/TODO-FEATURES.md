# 📋 미완료 기능 및 향후 개발 계획

## 📊 미완료 상태 개요
- **Phase 1**: ✅ 100% 완료 (SEO/성능 최적화, 사용자 프로필/설정 모두 완료)
- **Phase 3**: API 서비스 구현 (0% 완료)
- **Phase 4**: 고급 기능 및 최적화 (0% 완료)

---

## Phase 1: 남은 작업들 🚧

### 3주차: SEO 최적화 및 사용자 경험 개선 (부분 완료)

#### SEO 및 성능 최적화 ✅
- [x] Google Analytics 및 Search Console 연동
- [x] 이미지 최적화 및 lazy loading
  - **완료**: Next.js Image 컴포넌트 활용 최적화

#### 사용자 경험 개선 ✅
- [x] 접근성 (a11y) 기본 설정
  - **완료**: ARIA 라벨, 키보드 네비게이션, 스크린 리더 지원
- [x] 다국어 지원 준비 (i18n 기본 구조)
  - **완료**: next-i18next 설정, 번역 파일 구조

### 5주차: 사용자 프로필 및 설정 ✅
- [x] `/profile` - 프로필 조회/수정 페이지
  - **완료**: `apps/web/src/app/profile/page.tsx`
- [x] `/settings` - 계정 설정 페이지
  - **완료**: `apps/web/src/app/settings/page.tsx`
- [x] 프로필 이미지 업로드 기능
  - **완료**: Firebase Storage 연동
- [x] 비밀번호 변경 및 계정 관리
  - **완료**: 비밀번호 변경 폼, 계정 삭제 기능

### 6주차: 배포 준비 및 품질 보증 ✅
- [x] 배포 인프라 구축
  - [x] Vercel 프로덕션 배포 설정
  - [x] 도메인 연결 및 SSL 인증서 (설정 가이드 완료)
  - [x] 환경별 설정 (개발/스테이징/프로덕션)
  - [x] 모니터링 및 에러 추적 (Sentry) 설정
  - **완료 파일**: `vercel.json`, `DEPLOYMENT.md`, `sentry.client.config.ts`, `sentry.server.config.ts`

- [x] 테스트 및 품질 관리
  - [x] Jest 및 React Testing Library 설정
  - [x] 핵심 기능 단위 테스트 작성
  - [x] E2E 테스트 기본 설정 (Lighthouse CI)
  - [x] 코드 품질 검사 (ESLint, Prettier)
  - **완료 파일**: `jest.config.js`, `jest.setup.js`, `src/components/ui/__tests__/`

- [x] 성능 및 접근성 최적화
  - [x] Lighthouse 성능 최적화
  - [x] 웹 접근성 (WCAG) 준수
  - [x] Progressive Web App (PWA) 기본 설정 (준비 완료)
  - [x] 캐싱 전략 구현
  - **완료 파일**: `.github/workflows/deploy.yml`, `.github/lighthouse/lighthouserc.json`

---

## Phase 3: API 서비스 구현 (30% 완료) 🔄 **아키텍처 변경**

> **⚠️ 중요한 아키텍처 변경사항**
> OpenAI 호환 API 제거 → **RemoteExecutor 기반 Robota 네이티브 API**로 전환
> 더 안전하고 효율적인 Provider 의존성 주입 아키텍처 채택

### 13-14주차: **RemoteExecutor 아키텍처 구현** 🔄
- [x] **Firebase Functions API 기본 인프라** (재사용)
  - [x] Express.js 서버, 보안 미들웨어, 인증 시스템
  - [x] API 키 관리 시스템
  - **완료 파일**: `functions/src/index.ts`, `functions/src/api/api-keys/`

- [ ] **핵심 아키텍처 재설계** 🆕
  - [ ] **ExecutorInterface 정의 및 구현**
    - [ ] LocalExecutor (직접 AI API 호출)
    - [ ] RemoteExecutor (서버를 통한 프록시 호출)
    - **필요 파일**: `packages/core/src/interfaces/executor.ts`
  
  - [ ] **BaseAIProvider Executor 주입 시스템**
    - [ ] 기존 Provider들 Executor 주입 방식으로 리팩토링
    - [ ] OpenAI/Anthropic/Google Provider 업데이트
    - **필요 파일**: `packages/*/src/provider.ts` (모든 Provider)
  
  - [ ] **AI Provider Proxy API** (OpenAI 호환 API 대체)
    - [ ] `/api/v1/providers/openai/chat` - OpenAI 프록시
    - [ ] `/api/v1/providers/anthropic/chat` - Anthropic 프록시  
    - [ ] `/api/v1/providers/google/chat` - Google 프록시
    - **필요 파일**: `functions/src/api/providers/` 디렉터리

### 15-16주차: **RemoteExecutor 클라이언트 구현** 🆕
- [ ] **RemoteExecutor 클라이언트**
  - [ ] HTTP/WebSocket 통신 클라이언트
  - [ ] 스트리밍 응답 지원
  - [ ] 에러 처리 및 재시도 로직
  - **필요 파일**: `packages/remote/src/executor/remote-executor.ts`

- [ ] **Provider 통합 및 테스트**
  - [ ] 기존 Provider에 RemoteExecutor 통합
  - [ ] 로컬/원격 실행 전환 테스트
  - [ ] API Key 보안 검증
  - **필요 파일**: Provider별 테스트 파일

### 17-18주차: **플레이그라운드 RemoteExecutor 통합** 🔄
- [ ] **플레이그라운드 Executor 주입**
  - [ ] 코드 실행 시 RemoteExecutor 자동 주입
  - [ ] API Key 없는 안전한 실행 환경
  - [ ] 사용자 토큰 기반 인증
  - **필요 파일**: `apps/web/src/lib/playground/remote-injection.ts`

- [ ] **스트리밍 및 실시간 통신**
  - [ ] WebSocket 기반 실시간 응답
  - [ ] 스트리밍 UI 컴포넌트 업데이트
  - [ ] 연결 상태 관리
  - **필요 파일**: `apps/web/src/components/playground/streaming-output.tsx`

### 19-20주차: 사용량 추적 및 분석 ✅ (기존 계획 유지)
- [ ] **사용량 모니터링 시스템**
  - [ ] Provider별 사용량 추적
  - [ ] 실시간 사용량 대시보드
  - [ ] 알림 및 제한 시스템
  - **필요 파일**: `apps/web/src/app/analytics/page.tsx`

- [ ] **분석 및 리포팅**
  - [ ] 사용 패턴 분석
  - [ ] 성능 메트릭 수집
  - [ ] 비용 추적 및 최적화 제안
  - **필요 파일**: `apps/web/src/components/analytics/` 디렉터리

### 21-22주차: 결제 및 구독 시스템 ✅ (기존 계획 유지)
- [ ] **Stripe 통합**
  - [ ] 결제 처리 시스템
  - [ ] 구독 관리
  - [ ] 청구서 생성
  - **필요 파일**: `apps/web/src/lib/stripe/` 디렉터리

- [ ] **요금제 및 제한 관리**
  - [ ] 플랜별 기능 제한
  - [ ] 사용량 기반 과금
  - [ ] 오버리지 처리
  - **필요 파일**: `apps/web/src/app/billing/page.tsx`

---

## 🔄 아키텍처 변경사항 요약

### **제거될 기능** 🗑️
- ❌ OpenAI 호환 API (`/api/v1/chat/completions`)
- ❌ 기존 채팅 API 구조 (`functions/src/api/chat/index.ts`)
- ❌ 모델 목록 API (`/api/v1/chat/models`)
- ❌ OpenAI 클라이언트 라이브러리 호환성
- **제거 예정 파일**: `functions/src/api/chat/`, `functions/src/api/agents/`

### **새로 추가될 핵심 기능**
- ✅ **ExecutorInterface** - 의존성 주입 기반 실행 추상화
- ✅ **RemoteExecutor** - 서버 프록시 실행기
- ✅ **Provider Proxy API** - 각 AI Provider별 전용 엔드포인트
- ✅ **API Key 완전 격리** - 클라이언트에서 실제 API Key 제거

### **보안 및 아키텍처 이점**
- 🔒 **API Key 보안**: 서버에서만 실제 AI API Key 관리
- 🎯 **타겟팅**: Robota 생태계에 최적화된 네이티브 API
- 🔄 **투명성**: 로컬/원격 실행 완전 투명 전환
- 📊 **제어**: 사용량, 비용, 권한의 완전한 중앙 관리

### **개발 우선순위**
1. **Core Executor 시스템** (13-14주차) ⏰ **다음 단계**
2. **RemoteExecutor 클라이언트** (15-16주차)  
3. **플레이그라운드 통합** (17-18주차)
4. **분석 및 결제** (19-22주차)

### **🚀 즉시 시작할 작업들**
1. **ExecutorInterface 정의** (`packages/core/src/interfaces/executor.ts`)
2. **LocalExecutor 구현** (`packages/core/src/executors/local-executor.ts`)
3. **기존 OpenAI Provider Executor 주입 리팩토링**
4. **제거 작업**: 기존 OpenAI 호환 API 파일들 삭제
5. **Provider Proxy API 기본 구조** 구현

---

## Phase 3 추가: 공유 및 협업 기능

### 13-14주차: 공유 및 협업 기능
- [ ] **프로젝트 공유 시스템**
  - [ ] 공유 링크 생성
  - [ ] 공개/비공개 설정
  - [ ] Fork 기능 구현
  - **필요 파일**: `apps/web/src/components/playground/share-project.tsx`

- [ ] **커뮤니티 기능**
  - [ ] 공개 프로젝트 갤러리
  - [ ] 검색 및 필터링
  - [ ] 별점 및 댓글 시스템
  - **필요 파일**: `apps/web/src/app/community/page.tsx`

---

## Phase 4: 고급 기능 및 최적화 (0% 완료)

### 23-24주차: 고급 기능 구현
- [ ] **팀 협업 기능**
  - [ ] 팀 생성 및 관리
  - [ ] 권한 기반 협업
  - [ ] 팀 대시보드
  - **필요 파일**: `apps/web/src/app/teams/page.tsx`

- [ ] **고급 템플릿 시스템**
  - [ ] 커스텀 템플릿 생성
  - [ ] 템플릿 마켓플레이스
  - [ ] 버전 관리 시스템
  - **필요 파일**: `apps/web/src/components/templates/` 디렉터리

### 25-26주차: 성능 최적화 및 보안 강화
- [ ] **성능 최적화**
  - [ ] 캐싱 전략 구현
  - [ ] 데이터베이스 쿼리 최적화
  - [ ] CDN 설정

- [ ] **보안 강화**
  - [ ] 보안 감사
  - [ ] 취약점 분석 및 수정
  - [ ] 모니터링 시스템 강화

### 27-28주차: 테스트 및 배포 준비
- [ ] **종합 테스트**
  - [ ] E2E 테스트 작성
  - [ ] 부하 테스트 수행
  - [ ] 사용자 경험 테스트

- [ ] **배포 준비**
  - [ ] 프로덕션 환경 설정
  - [ ] 모니터링 시스템 구축
  - [ ] 배포 자동화

---

## 📁 생성해야 할 주요 파일 구조

### Phase 1 남은 작업
```
apps/web/src/
├── app/
│   ├── profile/
│   │   └── page.tsx ❌
│   ├── settings/
│   │   └── page.tsx ❌
│   └── analytics/
│       └── page.tsx ❌
├── components/
│   ├── analytics/
│   │   └── ... ❌
│   └── profile/
│       └── ... ❌
└── lib/
    └── analytics/
        └── ... ❌
```

### Phase 3 API 서비스
```
functions/
├── src/
│   ├── api/
│   │   ├── auth/
│   │   │   └── ... ❌
│   │   ├── chat/
│   │   │   └── completions.ts ❌
│   │   ├── agents/
│   │   │   └── ... ❌
│   │   └── billing/
│   │       └── ... ❌
│   └── middleware/
│       └── ... ❌

apps/web/src/
├── app/
│   ├── api-keys/
│   │   └── page.tsx ❌
│   ├── billing/
│   │   └── page.tsx ❌
│   └── community/
│       └── page.tsx ❌
├── lib/
│   ├── stripe/
│   │   └── ... ❌
│   └── api/
│       └── ... ❌
└── components/
    ├── billing/
    │   └── ... ❌
    └── community/
        └── ... ❌
```

### Phase 4 고급 기능
```
apps/web/src/
├── app/
│   └── teams/
│       └── page.tsx ❌
├── components/
│   ├── teams/
│   │   └── ... ❌
│   └── templates/
│       └── marketplace.tsx ❌
└── lib/
    └── teams/
        └── ... ❌
```

---

## 🎯 다음 우선순위 개발 순서

### 즉시 착수 가능 (Phase 1 완성)
1. **프로필/설정 페이지 구현**
   - `/profile` 페이지 생성
   - `/settings` 페이지 생성
   - 프로필 이미지 업로드 기능

2. **SEO 및 성능 최적화**
   - Google Analytics 연동
   - 이미지 최적화
   - 접근성 개선

### 중기 계획 (Phase 3)
3. **API 인프라 구축**
   - Firebase Functions 설정
   - API 키 관리 시스템
   - 기본 API 엔드포인트

4. **Stripe 결제 시스템**
   - 결제 처리
   - 구독 관리
   - 요금제 시스템

### 장기 계획 (Phase 4)
5. **팀 협업 기능**
6. **고급 템플릿 시스템**
7. **성능 최적화 및 보안 강화**

---

## 📝 개발 가이드라인

### 새 기능 개발 시 고려사항
1. **일관성 유지**: 기존 디자인 시스템 및 코딩 패턴 준수
2. **타입 안전성**: TypeScript 인터페이스 정의 우선
3. **접근성**: 모든 새 컴포넌트에 a11y 고려
4. **반응형**: 모바일 우선 반응형 디자인
5. **에러 처리**: 포괄적인 에러 핸들링 및 사용자 피드백
6. **테스트**: 새 기능에 대한 단위 테스트 작성
7. **문서화**: README 및 코드 주석 업데이트 