# Robota SDK 클라이언트 호환성 구현 체크리스트

## 🎯 목표
Robota SDK를 브라우저에서도 완전히 작동하도록 만들기

## 📋 Phase 1: 핵심 호환성 수정 (1-2주)

### 1. 환경 감지 시스템 구현
- [ ] `packages/agents/src/utils/environment.ts` 파일 생성
  - [ ] `Environment` 인터페이스 정의
  - [ ] `detectEnvironment()` 함수 구현
  - [ ] Node.js, 브라우저, WebWorker 환경 감지
  - [ ] 환경별 `getEnvVar()` 함수 구현
- [ ] 환경 감지 유틸리티 테스트 작성
  - [ ] Node.js 환경 테스트
  - [ ] 브라우저 환경 테스트 (jsdom)

### 2. 로거 시스템 브라우저 호환성
- [ ] `packages/agents/src/utils/logger.ts` 수정
  - [ ] `LoggerConfig` 생성자에서 `process.env` 제거
  - [ ] `detectEnvironment().getEnvVar()` 사용으로 변경
  - [ ] 환경별 로그 레벨 설정 테스트
- [ ] 로거 시스템 테스트 업데이트
  - [ ] 브라우저 환경에서 로거 동작 테스트

### 3. 타이머 타입 호환성 수정
- [ ] `packages/agents/src/utils/timer.ts` 파일 생성
  - [ ] `TimerId` 타입 정의: `ReturnType<typeof setTimeout>`
- [ ] 모든 플러그인에서 타이머 타입 수정
  - [ ] `packages/agents/src/plugins/webhook/webhook-plugin.ts`
    - [ ] `batchTimer?: NodeJS.Timeout` → `batchTimer?: TimerId`
  - [ ] `packages/agents/src/plugins/usage/usage-plugin.ts`
    - [ ] `aggregationTimer?: NodeJS.Timeout` → `aggregationTimer?: TimerId`
  - [ ] `packages/agents/src/plugins/logging/storages/remote-storage.ts`
    - [ ] `flushTimer: NodeJS.Timeout | undefined` → `flushTimer: TimerId | undefined`
  - [ ] `packages/agents/src/plugins/usage/storages/remote-storage.ts`
    - [ ] `timer: NodeJS.Timeout | null` → `timer: TimerId | null`

### 4. 암호화 함수 추상화 (WebHook 서명용)
- [ ] `packages/agents/src/utils/crypto.ts` 파일 생성
  - [ ] `createHmacSignature()` 함수 구현
  - [ ] 브라우저: Web Crypto API 사용
  - [ ] Node.js: crypto 모듈 사용
  - [ ] 환경 자동 감지 및 적절한 API 선택
- [ ] WebHook HTTP 클라이언트 수정
  - [ ] `packages/agents/src/plugins/webhook/http-client.ts`
  - [ ] `import { createHmac } from 'crypto'` 제거
  - [ ] `createHmacSignature()` 함수 사용으로 변경
  - [ ] `generateSignature()` 메소드를 async로 변경
- [ ] 암호화 함수 테스트 작성
  - [ ] Node.js 환경에서 HMAC 서명 테스트
  - [ ] 브라우저 환경에서 Web Crypto API 테스트

### 5. 빌드 설정 수정
- [ ] `packages/agents/tsup.config.ts` 수정
  - [ ] 듀얼 빌드 설정 (Node.js + Browser)
  - [ ] Node.js 빌드: `target: 'node18'`, `platform: 'node'`
  - [ ] 브라우저 빌드: `target: 'es2020'`, `platform: 'browser'`
  - [ ] 환경별 define 설정
- [ ] `packages/agents/package.json` 수정
  - [ ] exports 필드에 환경별 경로 설정
  - [ ] node, browser, default 조건부 exports
- [ ] 기타 패키지 빌드 설정 검토
  - [ ] `packages/openai/tsup.config.ts`
  - [ ] `packages/anthropic/tsup.config.ts`
  - [ ] `packages/google/tsup.config.ts`

### 6. OpenAI 스트림 핸들러 수정
- [ ] `packages/openai/src/streaming/stream-handler.ts` 수정
  - [ ] `process.env['NODE_ENV']` → 환경 감지 함수 사용
  - [ ] 브라우저 호환 로깅 구현

## 📋 Phase 2: 성능 모니터링 브라우저 어댑터 (선택적, 1주)

### 7. 브라우저 시스템 메트릭 컬렉터 구현
- [ ] `packages/agents/src/plugins/performance/collectors/browser-metrics-collector.ts` 생성
  - [ ] `BrowserSystemMetricsCollector` 클래스 구현
  - [ ] `getMemoryUsage()`: `performance.memory` 사용
  - [ ] `getCPUUsage()`: 브라우저에서는 undefined 반환
  - [ ] `getNetworkStats()`: `navigator.connection` 사용
- [ ] 성능 플러그인 환경별 컬렉터 선택
  - [ ] `packages/agents/src/plugins/performance/performance-plugin.ts` 수정
  - [ ] 환경 감지하여 적절한 컬렉터 선택
  - [ ] Node.js: `NodeSystemMetricsCollector`
  - [ ] 브라우저: `BrowserSystemMetricsCollector`

### 8. 스토리지 전략 개선
- [ ] 브라우저에서 파일 스토리지 사용 시 경고 메시지
  - [ ] 각 플러그인의 파일 스토리지 생성자에서 환경 체크
  - [ ] 브라우저에서 파일 스토리지 선택 시 console.warn
  - [ ] 메모리 스토리지 사용 권장 메시지

## 📋 Phase 3: 테스트 및 검증 (1주)

### 9. 브라우저 테스트 환경 구축
- [ ] Vitest 브라우저 테스트 설정
  - [ ] `packages/agents/vitest.config.ts`에 브라우저 환경 추가
  - [ ] `@vitest/browser` 설정
- [ ] 기본 기능 브라우저 테스트
  - [ ] Robota 인스턴스 생성 테스트
  - [ ] 환경 감지 테스트
  - [ ] 타이머 함수 테스트
  - [ ] 암호화 함수 테스트

### 10. 통합 테스트
- [ ] Node.js 환경 기존 기능 회귀 테스트
  - [ ] 모든 기존 테스트 통과 확인
  - [ ] 플러그인 동작 테스트
- [ ] 브라우저 환경 기능 테스트
  - [ ] AI 대화 기능 테스트
  - [ ] 플러그인 동작 테스트 (메모리 스토리지)
  - [ ] WebHook 플러그인 테스트

### 11. 예제 및 문서 작성
- [ ] 브라우저 사용 예제 작성
  - [ ] `apps/examples/browser-usage.html` 생성
  - [ ] 기본 Robota 사용법
  - [ ] 플러그인 설정 예제
  - [ ] WebHook 사용 예제
- [ ] 브라우저 사용 가이드 문서
  - [ ] `packages/agents/docs/browser-usage.md` 생성
  - [ ] 환경별 차이점 설명
  - [ ] 권장 설정 가이드
  - [ ] 트러블슈팅 가이드

## 📋 Phase 4: 최적화 및 배포 준비 (선택적)

### 12. 번들 크기 최적화
- [ ] 트리 쉐이킹 최적화
  - [ ] 사용하지 않는 플러그인 제외
  - [ ] 환경별 코드 분리
- [ ] 번들 분석
  - [ ] `bundle-analyzer` 사용
  - [ ] 불필요한 의존성 제거

### 13. 성능 최적화
- [ ] 레이지 로딩 구현
  - [ ] 플러그인 동적 import
  - [ ] AI 프로바이더 동적 import
- [ ] 메모리 사용량 최적화
  - [ ] 메모리 리크 검사
  - [ ] 적절한 cleanup 구현

## 🧪 검증 체크리스트

### 기능 검증
- [ ] ✅ 기본 AI 대화 (Node.js)
- [ ] ✅ 기본 AI 대화 (Browser)
- [ ] ✅ 도구 호출 (Node.js)
- [ ] ✅ 도구 호출 (Browser)
- [ ] ✅ 스트리밍 (Node.js)
- [ ] ✅ 스트리밍 (Browser)
- [ ] ✅ 로깅 플러그인 (Node.js: 파일, Browser: 콘솔)
- [ ] ✅ 사용량 추적 (Node.js: 파일, Browser: 메모리)
- [ ] ✅ 대화 히스토리 (Node.js: 파일, Browser: 메모리)
- [ ] ✅ WebHook 플러그인 (Node.js, Browser 모두)
- [ ] ✅ 성능 모니터링 (Node.js: 전체, Browser: 제한적)

### 호환성 검증
- [ ] ✅ Chrome (최신)
- [ ] ✅ Firefox (최신)
- [ ] ✅ Safari (최신)
- [ ] ✅ Edge (최신)
- [ ] ✅ Node.js 18+
- [ ] ✅ WebWorker 환경

### 빌드 및 배포 검증
- [ ] ✅ ESM 빌드 성공
- [ ] ✅ CJS 빌드 성공
- [ ] ✅ TypeScript 타입 정의 생성
- [ ] ✅ 패키지 exports 올바른 해석
- [ ] ✅ npm publish 준비 완료

## 🎯 완료 기준

모든 체크리스트 항목이 완료되면:
1. **Robota SDK가 브라우저에서 완전히 작동**
2. **모든 플러그인이 환경에 맞게 동작**
3. **기존 Node.js 기능 무손실 유지**
4. **포괄적인 테스트 커버리지**
5. **명확한 사용 가이드 제공**

## 📝 작업 순서 권장사항

1. **Phase 1 (1-8번)를 순서대로 완료** - 핵심 호환성 확보
2. **Phase 3 (9-11번) 중간 검증** - 기본 동작 확인
3. **Phase 2 (7-8번) 선택적 구현** - 성능 모니터링 개선
4. **Phase 4 (12-13번) 최적화** - 프로덕션 준비

각 단계별로 테스트를 실행하여 문제를 조기에 발견하고 해결하는 것을 권장합니다. 