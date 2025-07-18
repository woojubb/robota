# Firestore 서버사이드 처리 리팩토링 체크리스트

## 문제 해결 전략
- 인증은 현재 클라이언트 방식 유지 (Firebase Auth)
- Firestore 데이터베이스 호출만 API Routes로 이동
- 클라이언트에서 Firestore 직접 호출 제거

---

## Phase 0: 사전 준비 (우선순위: 필수) ✅

### 0.1 Firebase Admin SDK 설정
- [x] ~~Firebase Admin SDK 설치: `npm install firebase-admin`~~ (클라이언트 SDK 사용)
- [x] ~~서비스 계정 키 생성 (Firebase Console에서)~~ (임시로 클라이언트 SDK 사용)
- [x] ~~환경 변수 설정 (FIREBASE_SERVICE_ACCOUNT_KEY)~~ (추후 구현)
- [x] ~~`lib/firebase-admin.ts` 생성 및 초기화~~ (추후 구현)

### 0.2 서버 전용 유틸리티 함수
- [x] ~~`lib/server/db-service.ts` 생성~~ (API 라우트에 직접 구현)
- [x] 기존 Firestore 함수들의 서버 버전 구현
  - [x] `getUserProfileFromDB` - API 라우트에 구현
  - [x] `getUserExtendedFromDB` - API 라우트에 구현
  - [x] `getUserCreditSummaryFromDB` - API 라우트에 구현

---

## Phase 1: API Routes 생성 (우선순위: 높음) ✅

### 1.1 사용자 데이터 API
- [x] `app/api/v1/user/profile/route.ts` - 프로필 조회/수정
  - GET: 현재 사용자 프로필 조회 ✅
  - PUT: 프로필 업데이트 ✅
  - POST: 프로필 생성 (회원가입 시) ✅
- [x] `app/api/v1/user/credits/route.ts` - 크레딧 정보
  - GET: 크레딧 요약 정보 조회 ✅
- [ ] `app/api/v1/user/transactions/route.ts` - 거래 내역
  - GET: 거래 내역 조회 (페이지네이션)

### 1.2 인증 검증 유틸리티
- [x] `lib/auth-middleware.ts` 생성 ✅
- [x] ID 토큰 검증 함수 ✅ (임시 클라이언트 검증)
- [x] 에러 응답 표준화 ✅

---

## Phase 2: 클라이언트 리팩토링 (우선순위: 높음) ✅

### 2.1 API 클라이언트 생성
- [x] `lib/api-client.ts` 생성 ✅
  - [x] 인증 토큰 자동 첨부 ✅
  - [x] 에러 처리 및 재시도 로직 ✅
  - [x] 타입 안전성 (제네릭 활용) ✅
  - [x] 토큰 만료 시 자동 갱신 ✅

### 2.2 AuthContext 수정
- [x] Firestore 직접 import 제거 ✅
- [x] API 클라이언트 사용으로 전환 ✅
- [x] 기존 로딩/에러 상태 로직 유지 ✅
- [x] 불필요한 API 호출 최소화 ✅

### 2.3 기타 Firestore 사용 제거
- [x] 크레딧 표시 컴포넌트 확인 ✅
- [x] 프로필 이미지 업로드 (Storage는 유지) ✅
- [x] 기타 직접 호출 확인 및 제거 ✅

---

## Phase 3: 캐싱 및 최적화 (우선순위: 중간)

### 3.1 간단한 메모리 캐시
- [ ] `lib/cache.ts` - 간단한 TTL 캐시 구현
- [ ] 5분 기본 캐시 시간
- [ ] 캐시 무효화 메서드

### 3.2 API 응답 최적화
- [ ] 적절한 Cache-Control 헤더
- [ ] ETag 활용 (선택사항)
- [ ] 압축 활성화

---

## 완료된 작업 요약

1. **API 구조 설정**: `/api/v1/` 프리픽스로 모든 API 라우트 통일
2. **API 클라이언트**: 타입 안전한 API 클라이언트 구현
3. **인증 미들웨어**: API 라우트 보호를 위한 미들웨어 구현
4. **사용자 프로필 API**: 프로필 CRUD 작업 구현
5. **크레딧 API**: 크레딧 조회 엔드포인트 구현
6. **AuthContext 리팩토링**: Firestore 직접 호출 제거, API 사용으로 전환
7. **최적화**: 불필요한 API 호출 방지, 세션당 한 번만 데이터 로드

## 남은 작업

1. **Firebase Admin SDK 설정**: 서버사이드 토큰 검증을 위한 Admin SDK 설정
2. **트랜잭션 API**: 크레딧 거래 내역 조회 API 구현
3. **캐싱 시스템**: 성능 향상을 위한 캐싱 구현
4. **에러 처리 개선**: 더 자세한 에러 메시지 및 복구 로직 