# Robota SDK 클라이언트 환경 호환성 분석

## 📋 개요

현재 Robota SDK는 주로 Node.js 서버 환경에서 실행되도록 설계되어 있습니다. 이 문서는 Robota 객체를 브라우저나 기타 클라이언트 환경에서 실행할 수 있도록 만들기 위해 필요한 작업들을 분석합니다.

## ⚠️ Breaking Change 영향 분석

### 🔍 핵심 발견사항

클라이언트 호환성 개선 작업은 **기존 사용자들에게 거의 영향을 주지 않습니다**:

#### ✅ Breaking Change 없음 - Internal 구현만 변경
모든 주요 변경사항들이 **내부 구현 세부사항**에만 국한되어 있습니다:

1. **타이머 타입 변경**: `NodeJS.Timeout` → `ReturnType<typeof setTimeout>`
   - **영향 범위**: 플러그인 내부 private 필드만 변경
   - **공개 API 노출**: 없음 (모두 private 변수)
   - **사용자 코드**: 변경 불필요

2. **환경 변수 접근 추상화**: `process.env` → `detectEnvironment().getEnvVar()`
   - **영향 범위**: 내부 로거 시스템만 변경
   - **공개 API**: 변경 없음
   - **사용자 코드**: 변경 불필요

3. **암호화 함수 추상화**: `createHmac` → `createHmacSignature`
   - **영향 범위**: WebHook 플러그인 내부만 변경
   - **공개 API**: 변경 없음
   - **사용자 코드**: 변경 불필요

#### 📁 영향받는 파일들 (모두 Internal)
```typescript
// 모든 변경 파일들이 내부 구현
packages/agents/src/utils/logger.ts                    // ✅ Internal utility
packages/agents/src/plugins/*/                         // ✅ Internal plugin logic
packages/openai/src/streaming/stream-handler.ts        // ✅ Internal streaming
```

#### 🔒 공개 API 보호됨
분석한 공개 API들에는 타이머나 환경 변수 관련 타입이 노출되지 않음:
- `AgentConfig` - 환경 관련 타입 없음
- `BasePlugin<TOptions, TStats>` - 템플릿 타입만 사용
- `AIProvider` 인터페이스 - 환경 무관한 추상화
- 모든 Manager 인터페이스들 - 환경 독립적

### 📈 호환성 개선 효과

#### 기존 Node.js 사용자
- **변경사항**: 없음
- **동작**: 기존과 100% 동일
- **성능**: 동일
- **API**: 변경 없음

#### 새로운 브라우저 사용자
- **추가 지원**: 브라우저 환경에서도 동일한 API 사용 가능
- **제한사항**: 파일 스토리지 → 메모리 스토리지 권장
- **혜택**: 클라이언트 사이드 AI 애플리케이션 개발 가능

## 🔍 현재 아키텍처 분석

### 핵심 컴포넌트
- **Robota 클래스**: 메인 AI 에이전트 클래스 (`packages/agents/src/agents/robota.ts`)
- **AI Providers**: OpenAI, Anthropic, Google 프로바이더
- **Plugin System**: 8개 내장 플러그인 (로깅, 사용량 추적, 성능 모니터링 등)
- **Manager Classes**: AI 프로바이더, 도구, 대화 히스토리 관리
- **Tool System**: 함수 호출 및 도구 실행

### 패키지 구조
```
@robota-sdk/agents (핵심 패키지)
├── @robota-sdk/openai (OpenAI 프로바이더)
├── @robota-sdk/anthropic (Anthropic 프로바이더)
├── @robota-sdk/google (Google 프로바이더)
├── @robota-sdk/sessions (세션 관리)
└── @robota-sdk/team (팀 협업)
```

## 🚧 클라이언트 호환성 장벽

### 1. 핵심 호환성 이슈 (필수 해결)

#### 1.1 Process 객체 사용 (환경 변수)
**위치**: `packages/agents/src/utils/logger.ts:47`
```typescript
const envLevel = process.env['ROBOTA_LOG_LEVEL']?.toLowerCase() as UtilLogLevel;
```

**위치**: `packages/openai/src/streaming/stream-handler.ts:13`
```typescript
if (process.env['NODE_ENV'] === 'development') {
    console.debug(`[OpenAI Stream] ${message}`, data || '');
}
```

**영향**: 환경 변수 접근을 위한 기본적인 추상화 필요

#### 1.2 타이머 타입 호환성
**위치**: 여러 파일에서 타이머 관리
```typescript
private flushTimer: NodeJS.Timeout | undefined;      // 웹훅 플러그인
private timer: NodeJS.Timeout | null = null;         // 사용량 플러그인
private aggregationTimer?: NodeJS.Timeout;           // 사용량 플러그인
private batchTimer?: NodeJS.Timeout;                 // 웹훅 플러그인
```

**해결**: 브라우저 호환 타입으로 변경 (`ReturnType<typeof setTimeout>`)

### 2. 선택적 기능 (브라우저에서 비활성화 가능)

#### 2.1 성능 모니터링 플러그인
**위치**: `packages/agents/src/plugins/performance/collectors/system-metrics-collector.ts`
```typescript
async getMemoryUsage(): Promise<PerformanceMetrics['memoryUsage']> {
    const memoryUsage = process.memoryUsage();  // Node.js 전용
    // ...
}
```

**해결**: 브라우저에서는 PerformancePlugin 사용 안 함 또는 기본 비활성화

#### 2.2 파일 스토리지
**위치**: 
- `packages/agents/src/plugins/logging/storages/file-storage.ts`
- `packages/agents/src/plugins/usage/storages/file-storage.ts`
- `packages/agents/src/plugins/conversation-history/storages/file-storage.ts`

**해결**: 브라우저에서는 메모리 스토리지만 사용, 파일 스토리지는 선택 안 함

#### 2.3 웹훅 플러그인 (수정하면 브라우저에서도 사용 가능)
**위치**: `packages/agents/src/plugins/webhook/http-client.ts:6`
```typescript
import { createHmac } from 'crypto';  // Node.js crypto → Web Crypto API로 대체 필요
```

**해결**: 
- `createHmac` → Web Crypto API 사용
- `NodeJS.Timeout` → 범용 타입으로 변경
- 그러면 브라우저에서도 WebhookPlugin 사용 가능!

### 3. HTTP 클라이언트 호환성 (이미 호환됨)

#### 3.1 Fetch API 사용
**위치**: AI 프로바이더들의 HTTP 요청
**상태**: ✅ 최신 브라우저에서 지원, polyfill 가능

#### 3.2 AbortController 사용
**위치**: `packages/agents/src/plugins/webhook/http-client.ts:105`
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), options.timeout);
```
**상태**: ✅ 현대 브라우저에서 지원

### 4. 빌드 설정

#### 4.1 Target 설정
**현재 설정**: `target: 'node18'` (모든 tsup.config.ts)
**필요한 변경**: 브라우저 호환 타겟으로 변경

#### 4.2 External 의존성
**현재**: Node.js 전용 패키지들이 external로 설정
**필요한 변경**: 브라우저 호환 대안 패키지 사용

## 🛠️ 클라이언트 호환성 구현 방안

### 핵심 접근법: 최소한의 변경으로 최대 호환성

실제로 클라이언트 호환성을 위해 필요한 작업은 생각보다 단순합니다:

1. **필수 해결 사항**: 환경 변수 접근, 타이머 타입 호환성
2. **선택적 기능**: 성능 모니터링, 파일 스토리지, 웹훅 → 브라우저에서는 비활성화
3. **이미 호환됨**: HTTP 요청 (Fetch API), 기본 AI 대화, 도구 호출

### Phase 1: 환경 추상화 레이어 (최소한의 변경)

#### 1.1 환경 감지 유틸리티 생성
```typescript
// packages/agents/src/utils/environment.ts
export interface Environment {
    isNode: boolean;
    isBrowser: boolean;
    isWebWorker: boolean;
    getEnvVar(key: string): string | undefined;
    getMemoryUsage?(): MemoryInfo;
    getCPUUsage?(): CPUInfo;
}

export function detectEnvironment(): Environment {
    const isNode = typeof process !== 'undefined' && process.versions?.node;
    const isBrowser = typeof window !== 'undefined';
    const isWebWorker = typeof importScripts === 'function';
    
    return {
        isNode: Boolean(isNode),
        isBrowser,
        isWebWorker,
        getEnvVar: (key: string) => {
            if (isNode) return process.env[key];
            if (isBrowser) return (window as any).__ROBOTA_ENV__?.[key];
            return undefined;
        },
        getMemoryUsage: isNode ? () => process.memoryUsage() : undefined,
        getCPUUsage: isNode ? () => process.cpuUsage() : undefined,
    };
}
```

#### 1.2 로거 시스템 개선
```typescript
// packages/agents/src/utils/logger.ts 수정
class LoggerConfig {
    private constructor() {
        const env = detectEnvironment();
        const envLevel = env.getEnvVar('ROBOTA_LOG_LEVEL')?.toLowerCase() as UtilLogLevel;
        this.globalLevel = envLevel && this.isValidLevel(envLevel) ? envLevel : 'warn';
    }
}
```

#### 1.3 암호화 함수 추상화
```typescript
// packages/agents/src/utils/crypto.ts
export interface CryptoAdapter {
    createHmac(algorithm: string, secret: string, data: string): string;
}

export function createCryptoAdapter(): CryptoAdapter {
    const env = detectEnvironment();
    
    if (env.isNode) {
        const { createHmac } = require('crypto');
        return {
            createHmac: (algorithm, secret, data) => 
                createHmac(algorithm, secret).update(data).digest('hex')
        };
    }
    
    // 브라우저 환경: Web Crypto API 사용
    return {
        createHmac: async (algorithm, secret, data) => {
            const encoder = new TextEncoder();
            const key = await crypto.subtle.importKey(
                'raw',
                encoder.encode(secret),
                { name: 'HMAC', hash: algorithm.toUpperCase() },
                false,
                ['sign']
            );
            const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
            return Array.from(new Uint8Array(signature))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        }
    };
}
```

#### 1.3 암호화 함수 추상화 (WebHook 서명용)
```typescript
// packages/agents/src/utils/crypto.ts
export async function createHmacSignature(
    algorithm: string, 
    secret: string, 
    data: string
): Promise<string> {
    // 환경 감지
    if (typeof window !== 'undefined') {
        // 브라우저: Web Crypto API 사용
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: algorithm.toUpperCase().replace('SHA', 'SHA-') },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } else {
        // Node.js: crypto 모듈 사용
        const { createHmac } = require('crypto');
        return createHmac(algorithm, secret).update(data).digest('hex');
    }
}
```

#### 1.4 타이머 타입 호환성
```typescript
// packages/agents/src/utils/timer.ts
export type TimerId = ReturnType<typeof setTimeout>;

// 사용 예시 - 모든 플러그인에서 통일
private flushTimer: TimerId | undefined;
private timer: TimerId | null = null;
private batchTimer?: TimerId;
```

### Phase 2: 브라우저 사용법 (플러그인 선택적 사용)

#### 2.1 브라우저에서 권장하는 설정
```typescript
// 브라우저 환경에서 Robota 사용 예시
const robota = new Robota({
    name: 'BrowserAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4'
    },
    // 브라우저에서는 메모리 전용 플러그인만 사용
    plugins: [
        new LoggingPlugin({ strategy: 'console' }),      // 콘솔 로깅만
        new UsagePlugin({ strategy: 'memory' }),         // 메모리 스토리지만
        new ConversationHistoryPlugin({ storage: 'memory' })  // 메모리만
        // PerformancePlugin, WebhookPlugin 제외
    ]
});
```

#### 2.2 브라우저에서 모든 플러그인 사용 가능!
```typescript
// 브라우저 환경에서도 모든 플러그인 사용 가능
const robota = new Robota({
    name: 'BrowserAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4'
    },
    plugins: [
        new LoggingPlugin({ strategy: 'console' }),           // ✅ 가능
        new UsagePlugin({ strategy: 'memory' }),              // ✅ 가능
        new ConversationHistoryPlugin({ storage: 'memory' }), // ✅ 가능
        new WebhookPlugin({                                   // ✅ 가능 (수정 후)
            endpoints: [{ url: '/api/webhook' }]
        }),
        new PerformancePlugin({                               // ⚠️ 제한적 (시스템 메트릭 불가)
            strategy: 'memory',
            monitorMemory: false,  // 브라우저에서는 시스템 메트릭 제한
            monitorCPU: false
        })
    ]
});
```

### Phase 3: 빌드 설정 및 패키지 분리

#### 3.1 듀얼 빌드 설정
```typescript
// packages/agents/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig([
    // Node.js 빌드
    {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        target: 'node18',
        platform: 'node',
        outDir: 'dist/node',
        define: {
            __ROBOTA_TARGET__: '"node"'
        }
    },
    // 브라우저 빌드
    {
        entry: ['src/index.ts'],
        format: ['esm'],
        target: 'es2020',
        platform: 'browser',
        outDir: 'dist/browser',
        define: {
            __ROBOTA_TARGET__: '"browser"',
            'process.env.NODE_ENV': '"production"'
        },
        external: [],
        noExternal: ['zod']
    }
]);
```

#### 3.2 패키지 exports 설정
```json
// packages/agents/package.json
{
    "exports": {
        ".": {
            "node": {
                "types": "./dist/node/index.d.ts",
                "import": "./dist/node/index.js",
                "require": "./dist/node/index.cjs"
            },
            "browser": {
                "types": "./dist/browser/index.d.ts",
                "import": "./dist/browser/index.js"
            },
            "default": {
                "types": "./dist/node/index.d.ts",
                "import": "./dist/node/index.js"
            }
        }
    }
}
```

### Phase 4: AI 프로바이더 호환성

#### 4.1 API 키 관리
```typescript
// 브라우저 환경에서는 프록시 서버 사용 권장
export interface BrowserProviderConfig {
    proxyUrl?: string;  // AI API 호출을 위한 프록시 서버
    apiKey?: string;    // 개발 환경에서만 사용
}
```

#### 4.2 CORS 및 보안 고려사항
- AI 프로바이더 API 직접 호출 시 CORS 문제
- API 키 노출 보안 문제
- 프록시 서버를 통한 API 호출 권장

## 📋 구현 우선순위 (간소화)

### High Priority (필수, 1-2주)
1. **환경 감지 유틸리티** - `process.env` 추상화
2. **타이머 타입 호환성** - `NodeJS.Timeout` → `ReturnType<typeof setTimeout>`
3. **암호화 함수 추상화** - WebHook 서명을 위한 Web Crypto API 지원
4. **빌드 설정** - 브라우저 타겟 추가

### Medium Priority (선택적, 1주)
1. **성능 모니터링 브라우저 어댑터** - 제한적이지만 기본 메모리 정보는 가능
2. **사용 가이드** - 브라우저에서 권장 설정 문서화

### Low Priority (이미 해결됨 또는 불필요)
1. ~~**파일 스토리지 브라우저 대안**~~ → 메모리 스토리지 사용하면 됨
2. **모든 플러그인 브라우저 호환** → 수정 후 모두 사용 가능!

## 🎯 예상 결과

### 구현 완료 후 사용법
```typescript
// Node.js 환경
import { Robota } from '@robota-sdk/agents/node';

// 브라우저 환경
import { Robota } from '@robota-sdk/agents/browser';

// 또는 자동 감지
import { Robota } from '@robota-sdk/agents';  // 환경 자동 감지

const robota = new Robota({
    name: 'BrowserAgent',
    aiProviders: [
        new OpenAIProvider({
            proxyUrl: '/api/openai',  // 브라우저에서는 프록시 사용
            model: 'gpt-4'
        })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4'
    },
    plugins: [
        new LoggingPlugin({ strategy: 'console' }),  // 브라우저는 파일 로깅 불가
        new UsagePlugin({ strategy: 'memory' })      // 브라우저는 메모리 스토리지 사용
    ]
});
```

## 📊 호환성 매트릭스

| 기능 | Node.js | Browser | WebWorker | 비고 |
|------|---------|---------|-----------|------|
| 기본 AI 대화 | ✅ | ✅ | ✅ | 완전 호환 |
| 도구 호출 | ✅ | ✅ | ✅ | 완전 호환 |
| 스트리밍 | ✅ | ✅ | ✅ | Fetch API 지원 |
| 메모리 스토리지 | ✅ | ✅ | ✅ | 완전 호환 |
| 파일 스토리지 | ✅ | ❌ | ❌ | 메모리 스토리지 사용 |
| 성능 모니터링 | ✅ | ⚠️ | ⚠️ | 시스템 메트릭 제한적 |
| 웹훅 | ✅ | ✅ | ✅ | Web Crypto API로 가능! |
| 로깅 | ✅ | ✅ | ✅ | 콘솔 로깅 |
| 사용량 추적 | ✅ | ✅ | ✅ | 메모리 기반 |

## 🚀 구현 계획 (간소화)

### 1단계 (1-2주): 핵심 호환성 수정
- 환경 감지 시스템 구현 (`process.env` 추상화)
- 타이머 타입 호환성 (`NodeJS.Timeout` → `ReturnType<typeof setTimeout>`)
- 암호화 함수 추상화 (Web Crypto API 지원)
- 브라우저 빌드 설정 추가

### 2단계 (1주): 사용 편의성 개선
- 성능 모니터링 브라우저 어댑터 (선택적)
- 브라우저 사용 가이드 및 예제 작성

**총 개발 기간: 2-3주** (기존 8-12주에서 대폭 단축)

**결과**: 모든 핵심 기능과 플러그인이 브라우저에서 작동! 🎉

## 💡 추가 고려사항

### 보안
- 브라우저에서 API 키 직접 노출 금지
- 프록시 서버를 통한 안전한 API 호출
- CSP(Content Security Policy) 호환성

### 성능
- 번들 크기 최적화 (트리 쉐이킹)
- 레이지 로딩을 통한 초기 로드 최적화
- 메모리 사용량 모니터링

### 개발자 경험
- TypeScript 타입 정의 유지
- 개발 도구 지원 (소스맵, 디버깅)
- 명확한 에러 메시지 및 문서

이 분석을 바탕으로 단계별 구현을 통해 Robota SDK를 클라이언트 환경에서도 안전하고 효율적으로 사용할 수 있도록 개선할 수 있습니다. 

## ✅ Breaking Change 검증 결과

### 1. 공개 API 영향 분석
```typescript
// 변경 전후 동일한 공개 API
const robota = new Robota({
    name: 'MyAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4'
    },
    plugins: [
        new LoggingPlugin({ level: 'info' }),
        new UsagePlugin({ strategy: 'memory' }),
        new WebhookPlugin({ endpoints: [...] })
    ]
});

// 사용법 완전 동일
const response = await robota.run('Hello');
```

### 2. 타입 시스템 영향 분석
```typescript
// 사용자가 접근 가능한 타입들은 모두 보존됨
interface AgentConfig { ... }           // ✅ 변경 없음
interface BasePluginOptions { ... }     // ✅ 변경 없음
interface ToolSchema { ... }            // ✅ 변경 없음
interface UniversalMessage { ... }      // ✅ 변경 없음

// 내부 타입만 변경 (사용자 노출 없음)
private batchTimer?: TimerId;           // ✅ Internal only
```

### 3. 플러그인 시스템 영향 분석
```typescript
// 플러그인 등록 및 사용법 동일
const plugin = new WebhookPlugin({
    endpoints: [{ url: '/webhook' }],
    events: ['execution.complete'],
    async: true
});

// 내부 구현만 변경, 인터페이스 동일
robota.addPlugin(plugin); // ✅ 동일한 API
```

### 4. 빌드 시스템 영향 분석
```typescript
// package.json exports 확장 (기존 경로 유지)
{
    "exports": {
        ".": {
            "node": "./dist/node/index.js",        // ✅ 기존 경로 유지
            "browser": "./dist/browser/index.js",  // ✅ 새로운 경로 추가
            "default": "./dist/node/index.js"      // ✅ 기본값 유지
        }
    }
}
```

## 📊 호환성 매트릭스 (업데이트)

| 기능 | Node.js (기존) | Node.js (변경 후) | Browser (신규) | Breaking Change |
|------|---------------|------------------|----------------|----------------|
| 기본 AI 대화 | ✅ | ✅ | ✅ | ❌ |
| 도구 호출 | ✅ | ✅ | ✅ | ❌ |
| 스트리밍 | ✅ | ✅ | ✅ | ❌ |
| 플러그인 시스템 | ✅ | ✅ | ✅ | ❌ |
| 로깅 | ✅ (파일) | ✅ (파일) | ✅ (콘솔) | ❌ |
| 사용량 추적 | ✅ (파일) | ✅ (파일) | ✅ (메모리) | ❌ |
| WebHook | ✅ | ✅ | ✅ | ❌ |
| 성능 모니터링 | ✅ (시스템) | ✅ (시스템) | ⚠️ (제한적) | ❌ |

## 🎯 마이그레이션 가이드 (사용자용)

### 기존 Node.js 사용자
```typescript
// 변경 전
import { Robota } from '@robota-sdk/agents';

// 변경 후 (동일)
import { Robota } from '@robota-sdk/agents';

// 코드 변경 불필요! 🎉
```

### 새로운 브라우저 사용자
```typescript
// 브라우저에서 동일한 API 사용
import { Robota } from '@robota-sdk/agents';

const robota = new Robota({
    name: 'BrowserAgent',
    aiProviders: [openaiProvider],
    plugins: [
        new LoggingPlugin({ strategy: 'console' }),  // 콘솔 로깅 권장
        new UsagePlugin({ strategy: 'memory' })      // 메모리 스토리지 권장
    ]
});
``` 