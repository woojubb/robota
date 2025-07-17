# Robota SDK 클라이언트 호환성 구현 체크리스트

## 🎯 목표
Robota SDK를 브라우저에서도 완전히 작동하도록 만들기

## ✅ Breaking Change 영향 없음 보장

### 🔒 기존 사용자 100% 안전성 확인
이 클라이언트 호환성 개선 작업은 **기존 사용자에게 전혀 영향을 주지 않습니다**:

- **📦 공개 API**: 모든 공개 인터페이스와 API 변경 없음
- **🔧 타입 시스템**: 사용자 접근 가능한 타입 모두 보존
- **⚙️ 동작 방식**: Node.js 환경에서 기존과 100% 동일한 동작
- **📚 사용법**: 코드 변경 없이 기존 코드 그대로 사용 가능

### 🔍 변경 범위 (Internal Only)
- **순수한 구현**: 환경 무관한 코드로 변경
- **환경별 분리**: 특정 환경에서만 동작하는 기능은 분리
- **조건부 사용**: 환경에 따라 다른 구현체 선택

### 📈 추가 혜택
- **✨ 새로운 환경 지원**: 브라우저에서도 동일한 API 사용 가능
- **🔄 Backward Compatibility**: 기존 Node.js 코드 100% 호환
- **🚀 Forward Compatibility**: 미래 클라이언트 환경 확장 준비

## 🏗️ 새로운 접근법: 순수한 구현 + 환경별 분리

### 💡 핵심 원칙
1. **순수한 구현 우선**: 가능한 모든 환경에서 동작하는 순수한 JavaScript/TypeScript 구현
2. **환경변수 제거**: 라이브러리 내부에서 `process.env` 사용 금지, 모든 설정은 생성자 주입
3. **환경별 구현체 분리**: 특정 환경에 의존하는 기능은 별도 구현체로 분리
4. **조건부 import**: 환경에 따라 적절한 구현체를 import

### 🚫 제거할 환경변수 의존성
- **`ROBOTA_LOG_LEVEL`**: Robota 생성시 `logLevel` 옵션으로 주입
- **모든 process.env 접근**: 브라우저 호환성을 위해 완전 제거
- **환경 감지 로직**: 불필요한 복잡성 제거

### ✅ 새로운 설정 주입 방식
```typescript
new Robota({
  name: 'MyAgent',
  logLevel: 'debug',        // 환경변수 대신 직접 설정
  aiProviders: [openaiProvider],
  // 필요한 모든 설정을 생성자에서 주입
});
```

## 📋 Phase 1: 순수한 구현으로 변경 (1일) 🚀

### 💡 매우 간단한 작업들
대부분의 작업이 이미 완료되어 있고, 실제로는 **몇 줄만 수정**하면 됩니다!

### 1. 타이머 타입을 순수하게 통일
- [ ] `packages/agents/src/utils/timer.ts` 파일 생성
  - [ ] `TimerId` 타입 정의: `ReturnType<typeof setTimeout>`
  - [ ] 순수한 타이머 유틸리티 함수들 제공
- [ ] 모든 플러그인에서 순수한 타이머 타입 사용
  - [ ] `packages/agents/src/plugins/webhook/webhook-plugin.ts`
    - [ ] `batchTimer?: NodeJS.Timeout` → `batchTimer?: TimerId`
  - [ ] `packages/agents/src/plugins/usage/usage-plugin.ts`
    - [ ] `aggregationTimer?: NodeJS.Timeout` → `aggregationTimer?: TimerId`
  - [ ] `packages/agents/src/plugins/event-emitter-plugin.ts`
    - [ ] `bufferTimer?: NodeJS.Timeout` → `bufferTimer?: TimerId`
  - [ ] `packages/agents/src/plugins/conversation-history/conversation-history-plugin.ts`
    - [ ] `batchSaveTimer?: NodeJS.Timeout` → `batchSaveTimer?: TimerId`
  - [ ] `packages/agents/src/plugins/logging/storages/remote-storage.ts`
    - [ ] `flushTimer: NodeJS.Timeout | undefined` → `flushTimer: TimerId | undefined`
  - [ ] `packages/agents/src/plugins/usage/storages/remote-storage.ts`
    - [ ] `timer: NodeJS.Timeout | null` → `timer: TimerId | null`

### 2. 로거 설정을 주입 방식으로 변경 (환경변수 제거) ✅ 거의 완료
- [ ] `packages/agents/src/utils/logger.ts` 수정 **✅ 이미 거의 완료**
  - [x] **Robota가 이미 `config.logging` 설정을 제대로 처리함** ✅
  - [x] **`setGlobalLogLevel()` 함수 이미 존재하고 동작함** ✅
  - [ ] **LoggerConfig 생성자에서만 `process.env['ROBOTA_LOG_LEVEL']` 제거**
  ```typescript
  // 현재 (환경변수 의존) - 49번째 줄
  const envLevel = process.env['ROBOTA_LOG_LEVEL']?.toLowerCase() as UtilLogLevel;
  this.globalLevel = envLevel && this.isValidLevel(envLevel) ? envLevel : 'warn';
  
  // 새로운 방식 (순수한 기본값)
  this.globalLevel = 'warn'; // 단순히 기본값만 사용
  ```
- [x] **기존 API 100% 호환성 유지됨** ✅
  - [x] Robota 생성자에서 `config.logging.level` 이미 처리됨
  - [x] `setGlobalLogLevel()`, `getGlobalLogLevel()` 함수 그대로 유지
  - [x] `createLogger()` 함수 동작 방식 변경 없음
- [ ] **브라우저 호환성 검증**
  - [ ] 단 1줄만 수정: `process.env['ROBOTA_LOG_LEVEL']` 제거
  - [ ] 브라우저에서 로거 동작 테스트

### 3. 암호화 함수를 순수 JavaScript 라이브러리로 대체 ✅
- [x] `jsSHA` 라이브러리 설치 및 설정 **✅ 완료**
  - [x] `packages/agents/package.json`에 `jssha` 의존성 추가 **✅ 완료**
  - [x] TypeScript 타입 정의 포함 확인 **✅ 내장됨**
  - [x] Node.js + 브라우저 완전 호환 검증 **✅ 검증 완료**
  - [x] **HMAC-SHA256 결과 동일성 검증 완료** ✅
- [ ] WebHook HTTP 클라이언트 수정
  - [ ] `packages/agents/src/plugins/webhook/http-client.ts`
  - [ ] `import { createHmac } from 'crypto'` 제거
  - [ ] `import jsSHA from 'jssha'` 추가
  - [ ] `generateSignature()` 메소드를 jsSHA로 구현
```typescript
private generateSignature(body: string, secret: string): string {
    const shaObj = new jsSHA("SHA-256", "TEXT", {
        hmacKey: { value: secret, format: "TEXT" }
    });
    shaObj.update(body);
    return shaObj.getHash("HEX");
}
```
- [ ] 기존 Node.js crypto 모듈과 동일한 결과 검증
  - [x] 테스트 케이스로 HMAC-SHA256 결과 비교 **✅ 100% 동일**
  - [ ] GitHub, Stripe 등의 WebHook 서명과 호환성 확인

### 4. OpenAI 스트림 핸들러를 순수하게 변경
- [ ] `packages/openai/src/streaming/stream-handler.ts` 수정
  - [ ] 환경 변수 직접 접근 제거
  - [ ] 디버그 모드를 외부에서 설정 가능하도록 변경
  - [ ] 기본값으로 호환성 유지

## 📋 Phase 2: 환경별 빌드 시스템 구성 (1주)

### 5. 빌드 설정을 환경별로 분리
- [ ] `packages/agents/tsup.config.ts` 수정
  - [ ] Node.js 빌드: 파일 시스템 사용
  - [ ] 브라우저 빌드: 메모리 스토리지만 사용
  - [ ] 조건부 imports로 환경별 구현체 선택
- [ ] `packages/agents/package.json` 수정
  - [ ] exports 필드에 환경별 경로 설정
  - [ ] 조건부 exports로 자동 선택되도록 설정

### 6. 스토리지 구현체를 환경별로 분리
- [ ] 파일 스토리지 구현체들을 Node.js 전용으로 명시
  - [ ] `packages/agents/src/plugins/logging/storages/file-storage.ts`
  - [ ] `packages/agents/src/plugins/usage/storages/file-storage.ts`
  - [ ] `packages/agents/src/plugins/conversation-history/storages/file-storage.ts`
- [ ] 브라우저 빌드에서는 파일 스토리지 제외
  - [ ] 조건부 export로 자동 처리
  - [ ] 메모리/리모트 스토리지만 포함

### 7. 성능 모니터링을 환경별로 분리
- [ ] `packages/agents/src/plugins/performance/collectors/` 구조 개선
  - [ ] `node-metrics-collector.ts` - Node.js 전용 (process.memoryUsage 등)
  - [ ] `browser-metrics-collector.ts` - 브라우저 전용 (performance.memory 등)
  - [ ] `base-metrics-collector.ts` - 공통 인터페이스
- [ ] 성능 플러그인에서 환경별 컬렉터 자동 선택
  - [ ] 빌드타임에 적절한 컬렉터만 포함

## 📋 Phase 3: 조건부 Import 시스템 구축 (1주)

### 8. 조건부 Export 패턴 구현
- [ ] 각 패키지에서 환경별 entry point 제공
```typescript
// package.json
{
  "exports": {
    ".": {
      "node": "./dist/node/index.js",
      "browser": "./dist/browser/index.js",
      "default": "./dist/node/index.js"
    }
  }
}
```

### 9. 플러그인 옵션 개선
- [ ] 각 플러그인에서 환경에 맞지 않는 옵션 사용 시 명확한 에러 메시지
```typescript
// 브라우저에서 파일 스토리지 사용 시
new LoggingPlugin({ 
  strategy: 'file' // ← 브라우저에서 명확한 에러 메시지
})
```

### 10. 타입 정의 개선
- [ ] 환경별 타입 정의 분리
- [ ] 조건부 타입으로 환경에 맞지 않는 옵션 타입 에러 발생

## 📋 Phase 4: 테스트 및 검증 (1주)

### 11. 환경별 테스트 구성
- [ ] Node.js 테스트: 기존 테스트 + 파일 스토리지, 시스템 메트릭
- [ ] 브라우저 테스트: 메모리 스토리지, 브라우저 메트릭
- [ ] 조건부 import 테스트

### 12. 예제 및 문서 작성
- [ ] 환경별 사용 예제
```typescript
// Node.js
import { Robota, LoggingPlugin } from '@robota-sdk/agents';
new LoggingPlugin({ strategy: 'file' }); // ✅ 사용 가능

// Browser  
import { Robota, LoggingPlugin } from '@robota-sdk/agents';
new LoggingPlugin({ strategy: 'console' }); // ✅ 사용 가능
new LoggingPlugin({ strategy: 'file' }); // ❌ 타입 에러 또는 런타임 에러
```

## 🧪 검증 체크리스트

### 순수한 구현 검증
- [ ] ✅ 타이머 함수들이 모든 환경에서 동작
- [ ] ✅ 로거가 설정 주입 방식으로 동작
- [ ] ✅ 공통 인터페이스가 환경 무관하게 동작

### 환경별 분리 검증
- [ ] ✅ Node.js: 파일 스토리지, 시스템 메트릭, crypto 모듈 사용
- [ ] ✅ Browser: 메모리 스토리지, 브라우저 메트릭, Web Crypto API 사용
- [ ] ✅ 잘못된 환경에서 사용 시 명확한 에러 메시지

### 빌드 시스템 검증
- [ ] ✅ 조건부 exports가 올바르게 동작
- [ ] ✅ 환경별 번들에 불필요한 코드 포함되지 않음
- [ ] ✅ TypeScript 타입이 환경별로 올바르게 제한됨

## 🎯 완료 기준

1. **순수한 구현**: 핵심 로직이 환경 독립적으로 동작
2. **명확한 분리**: 환경별 구현체가 깔끔하게 분리됨
3. **자동 선택**: 빌드타임에 적절한 구현체가 자동으로 선택됨
4. **타입 안전성**: 잘못된 환경에서 사용 시 타입 에러 발생
5. **성능 최적화**: 각 환경에 불필요한 코드 포함되지 않음

## 📝 구현 우선순위 권장사항

1. **Phase 1**: 순수한 구현으로 변경 (타이머, 로거, 기본 구조)
2. **Phase 2**: 환경별 분리 (암호화, 스토리지, 성능 모니터링) 
3. **Phase 3**: 빌드 시스템 구성 (조건부 imports, exports)
4. **Phase 4**: 테스트 및 문서화 (품질 보장, 사용자 가이드)

이 접근법으로 환경 감지 로직 없이도 깔끔하고 효율적인 클라이언트 호환성을 달성할 수 있습니다! 

## 🎯 환경변수 사용 최소화 결과

### ✅ 제거된 환경변수 의존성
- **`ROBOTA_LOG_LEVEL`**: 단 1줄 수정으로 완전 제거 가능
- **모든 process.env 접근**: 라이브러리 코드에서 완전 제거

### ✅ 새로운 설정 주입 방식
```typescript
// 깔끔한 설정 주입
new Robota({
  name: 'MyAgent',
  logging: { level: 'debug' },    // 환경변수 대신 직접 설정
  aiProviders: [openaiProvider],
});
```

### ✅ 유지되는 것들 (예제/문서용)
- **`OPENAI_API_KEY`**, **`ANTHROPIC_API_KEY`** 등: 예제와 문서에서만 사용 (라이브러리 코드 아님)
- **`NEXT_PUBLIC_*`**: 웹 앱 전용 (브라우저에서 정상 동작)

### 🚀 결과
- **Breaking Change 없음**: 기존 API 100% 호환
- **브라우저 완전 호환**: process.env 의존성 완전 제거  
- **더 깔끔한 API**: 환경변수 대신 명시적 설정 주입
- **빠른 구현**: 실제로는 몇 줄만 수정하면 완료 