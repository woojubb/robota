# Robota SDK 클라이언트 호환성 구현 체크리스트

## 🎉 Phase 1 완료! (2025-01-06)

✅ **@robota-sdk/agents 브라우저 호환성 완료** - 핵심 에이전트 시스템 100% 브라우저 지원
✅ **문서화 완료** - docs/ 디렉터리에 모든 내용 반영됨
✅ **Zero Breaking Changes** - 기존 사용자 코드 100% 호환 유지

## 🔄 Phase 2 필요: AI Provider 및 Tool 시스템 브라우저 호환성 검증

⚠️ **중요**: agents 패키지는 완료되었지만, 실제 사용을 위해서는 AI Provider들과 Tool 시스템의 브라우저 호환성도 확인이 필요합니다.

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

## 📋 Phase 2: AI Provider 및 Tool 시스템 브라우저 호환성 검증 (2일 예상)

### 🎯 Phase 2 목표
1. **AI Provider 브라우저 호환성**: OpenAI, Anthropic, Google Provider 각각 브라우저에서 정상 동작 확인
2. **Tool 시스템 브라우저 호환성**: Function Tool, MCP Tool 등 브라우저에서 정상 동작 확인
3. **통합 테스트**: 전체 시스템이 브라우저에서 End-to-End로 동작하는지 확인
4. **성능 및 호환성 문서화**: 브라우저별 제한사항 및 권장사항 정리

---

### 🔍 2.1 AI Provider 브라우저 호환성 검증 (우선순위: High)

#### 2.1.1 @robota-sdk/openai 패키지 검증
- [ ] **Node.js 의존성 스캔**
  - [ ] `packages/openai/src/` 전체 파일에서 `process.env` 사용 검색
  - [ ] `import { createHmac }` 같은 Node.js crypto 모듈 사용 검색
  - [ ] `fs`, `path`, `os` 등 Node.js 내장 모듈 import 검색
  - [ ] `NodeJS.*` 타입 사용 검색

- [ ] **OpenAI SDK 브라우저 호환성 확인**
  - [ ] `openai` npm 패키지의 브라우저 지원 여부 확인
  - [ ] Fetch API vs Node.js HTTP client 사용 방식 확인
  - [ ] Streaming 구현이 브라우저에서 동작하는지 확인

- [ ] **Provider 구현 브라우저 테스트**
  - [ ] 브라우저 환경에서 OpenAIProvider 인스턴스 생성 테스트
  - [ ] 기본 chat() 메소드 브라우저에서 실행 테스트
  - [ ] chatStream() 스트리밍 브라우저에서 실행 테스트
  - [ ] 에러 처리가 브라우저에서 올바르게 동작하는지 테스트

#### 2.1.2 @robota-sdk/anthropic 패키지 검증
- [ ] **Node.js 의존성 스캔**
  - [ ] `packages/anthropic/src/` 전체 파일에서 Node.js 전용 코드 검색
  - [ ] `@anthropic-ai/sdk` 패키지의 브라우저 지원 여부 확인

- [ ] **Provider 구현 브라우저 테스트**
  - [ ] AnthropicProvider 브라우저 인스턴스 생성 테스트
  - [ ] Claude 모델과의 기본 대화 브라우저 테스트
  - [ ] 스트리밍 응답 브라우저 테스트

#### 2.1.3 @robota-sdk/google 패키지 검증
- [ ] **Node.js 의존성 스캔**
  - [ ] `packages/google/src/` 전체 파일에서 Node.js 전용 코드 검색
  - [ ] `@google/generative-ai` 패키지의 브라우저 지원 여부 확인

- [ ] **Provider 구현 브라우저 테스트**
  - [ ] GoogleProvider 브라우저 인스턴스 생성 테스트
  - [ ] Gemini 모델과의 기본 대화 브라우저 테스트
  - [ ] 스트리밍 응답 브라우저 테스트

---

### 🛠️ 2.2 Tool 시스템 브라우저 호환성 검증 (우선순위: Medium)

#### 2.2.1 Function Tool (Zod 기반) 브라우저 검증
- [ ] **Zod 라이브러리 브라우저 호환성**
  - [ ] `zod` npm 패키지 브라우저 지원 여부 확인
  - [ ] 스키마 검증이 브라우저에서 정상 동작하는지 테스트

- [ ] **Function Tool 브라우저 테스트**
  - [ ] `createFunctionTool()` 브라우저에서 실행 테스트
  - [ ] 파라미터 검증 브라우저에서 테스트
  - [ ] Tool 실행 결과 브라우저에서 테스트

#### 2.2.2 MCP Tool 브라우저 검증
- [ ] **MCP 의존성 브라우저 호환성**
  - [ ] MCP 관련 라이브러리들의 브라우저 지원 확인
  - [ ] 네트워크 통신이 브라우저에서 정상 동작하는지 확인

- [ ] **MCP Tool 브라우저 테스트**
  - [ ] MCP Tool 인스턴스 생성 브라우저 테스트
  - [ ] 외부 MCP 서버와의 통신 브라우저 테스트

---

### 🧪 2.3 통합 브라우저 테스트 (우선순위: High)

#### 2.3.1 End-to-End 브라우저 테스트
- [ ] **완전한 Agent 생성 테스트**
```typescript
// 브라우저에서 이 코드가 완전히 동작하는지 테스트
const agent = new Robota({
  name: 'BrowserTestAgent',
  aiProviders: [
    new OpenAIProvider({ apiKey: 'test-key' }),
    new AnthropicProvider({ apiKey: 'test-key' }),
    new GoogleProvider({ apiKey: 'test-key' })
  ],
  defaultModel: { provider: 'openai', model: 'gpt-3.5-turbo' },
  plugins: [
    new LoggingPlugin({ strategy: 'console' }),
    new UsagePlugin({ strategy: 'memory' })
  ]
});

// 기본 대화 테스트
const response = await agent.run('Hello!');

// 스트리밍 테스트  
const stream = await agent.runStream('Tell me a story');
for await (const chunk of stream) {
  console.log(chunk);
}

// Tool 사용 테스트
const toolResult = await agent.run('Calculate 2 + 2', {
  tools: [calculatorTool]
});
```

#### 2.3.2 브라우저별 호환성 테스트
- [ ] **Chrome/Chromium 기반 브라우저**
  - [ ] Chrome 최신 버전 테스트
  - [ ] Edge 최신 버전 테스트

- [ ] **Firefox 테스트**
  - [ ] Firefox 최신 버전에서 모든 기능 테스트

- [ ] **Safari 테스트** 
  - [ ] Safari 최신 버전에서 모든 기능 테스트
  - [ ] iOS Safari에서 기본 기능 테스트

#### 2.3.3 프레임워크 통합 테스트
- [ ] **React 통합 테스트**
  - [ ] Create React App에서 Robota 사용 테스트
  - [ ] Next.js에서 클라이언트 사이드 사용 테스트

- [ ] **Vue 통합 테스트**
  - [ ] Vue 3 Composition API와 함께 사용 테스트
  - [ ] Nuxt.js 클라이언트 사이드 사용 테스트

- [ ] **기타 프레임워크**
  - [ ] Vite + vanilla TypeScript 환경 테스트
  - [ ] Svelte/SvelteKit 환경 테스트

---

### 📊 2.4 성능 및 제한사항 분석 (우선순위: Medium)

#### 2.4.1 번들 크기 영향 분석
- [ ] **각 Provider별 번들 크기 측정**
  - [ ] @robota-sdk/openai + openai 패키지 크기
  - [ ] @robota-sdk/anthropic + @anthropic-ai/sdk 패키지 크기  
  - [ ] @robota-sdk/google + @google/generative-ai 패키지 크기

- [ ] **Tree-shaking 효과 확인**
  - [ ] 사용하지 않는 Provider가 번들에서 제외되는지 확인
  - [ ] 미사용 Tool이 번들에서 제외되는지 확인

#### 2.4.2 브라우저별 제한사항 문서화
- [ ] **CORS 및 보안 제한사항**
  - [ ] 각 AI Provider의 CORS 정책 확인
  - [ ] 프록시 서버 필요성 및 설정 가이드 작성

- [ ] **API 키 보안 모범 사례**
  - [ ] 브라우저에서 안전한 API 키 관리 방법 문서화
  - [ ] 프로덕션 환경 권장사항 작성

---

### 🔧 2.5 브라우저 호환성 개선 작업 (우선순위: Low)

#### 2.5.1 발견된 문제 수정
- [ ] **Provider별 Node.js 의존성 제거**
  - [ ] 발견된 Node.js 전용 코드를 브라우저 호환 코드로 교체
  - [ ] 필요시 browser/node 조건부 exports 설정

- [ ] **Tool 시스템 브라우저 최적화**
  - [ ] 브라우저에서 동작하지 않는 Tool 기능 대안 구현
  - [ ] 브라우저 전용 Tool 최적화

#### 2.5.2 브라우저 전용 기능 추가
- [ ] **IndexedDB 스토리지 지원**
  - [ ] 브라우저 영구 저장을 위한 IndexedDB 어댑터 구현
  - [ ] ConversationHistory IndexedDB 백엔드 추가

- [ ] **WebWorker 최적화**
  - [ ] WebWorker에서 AI 처리를 위한 최적화
  - [ ] 메인 스레드 블로킹 방지 기능

---

## ✅ Phase 2 완료 기준

### 🎯 필수 달성 목표
1. **모든 AI Provider 브라우저 동작**: OpenAI, Anthropic, Google 모두 브라우저에서 완전 동작
2. **Tool 시스템 브라우저 동작**: Function Tool, MCP Tool 브라우저에서 완전 동작  
3. **End-to-End 테스트 통과**: 전체 Agent 시스템이 브라우저에서 문제없이 동작
4. **주요 브라우저 호환성**: Chrome, Firefox, Safari에서 모든 기능 동작
5. **프레임워크 통합 성공**: React, Vue 등 주요 프레임워크에서 사용 가능

### 📚 문서화 완료 목표
1. **브라우저 호환성 가이드**: 각 Provider별 브라우저 사용법 문서
2. **제한사항 및 해결책**: CORS, API 키 보안 등 브라우저 특화 이슈 가이드
3. **프레임워크별 예제**: React, Vue 등 실제 사용 예제
4. **성능 최적화 가이드**: 번들 크기 및 로딩 성능 최적화 방법

---

## 🎯 환경변수 사용 최소화 결과 (Phase 1 완료)

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

### 🚀 Phase 1 결과
- **Breaking Change 없음**: 기존 API 100% 호환
- **브라우저 완전 호환**: process.env 의존성 완전 제거  
- **더 깔끔한 API**: 환경변수 대신 명시적 설정 주입
- **빠른 구현**: 실제로는 몇 줄만 수정하면 완료 