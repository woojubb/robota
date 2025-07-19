# WorkerWrapper 개발 계획서

## 📋 개요

Robota SDK의 모든 구성 요소를 Web Worker에서 실행할 수 있도록 하는 `@robota-sdk/worker` 패키지 개발 계획입니다. 
이 패키지는 기존 코드의 순수성을 유지하면서 Worker 실행 기능을 추가하는 Wrapper 패턴을 사용합니다.

## ✅ 검증 완료 사항

### 🧪 기술적 실현 가능성 검증
- **테스트 결과**: Mock 환경에서 WorkerWrapper 동작 100% 성공
- **SDK 호환성**: Robota SDK가 이미 브라우저/Worker 친화적으로 설계됨
- **의존성 분석**: 모든 핵심 의존성이 Worker 환경에서 실행 가능
- **타입 안전성**: 완전한 TypeScript 지원 유지 가능

### 🎯 핵심 강점
1. **Cross-Platform 설계**: 순수 JavaScript 코어, Node.js 종속성 없음
2. **최소 의존성**: `zod`, `jssha` 등 Worker 호환 라이브러리만 사용
3. **직렬화 가능**: 모든 설정과 데이터가 JSON 직렬화 가능
4. **상태 없는 아키텍처**: ExecutionService 등이 순수 함수형으로 설계

## 🏗️ 아키텍처 설계

### 패키지 구조 (Zero-Config + 선택적 주입)
```
@robota-sdk/worker/
├── src/
│   ├── wrapper/
│   │   ├── worker-wrapper.ts        # 메인 Wrapper 클래스 (선택적 Factory 지원)
│   │   └── proxy-handler.ts         # Proxy 로직 분리
│   ├── interfaces/                  # 🆕 순수한 추상화
│   │   ├── worker-interface.ts      # Worker 추상 인터페이스
│   │   └── worker-factory.ts        # Worker 생성 팩토리 인터페이스
│   ├── detection/                   # 🆕 순수한 Worker 존재 확인
│   │   └── worker-support.ts        # Worker 지원 여부만 확인 (환경 감지 없음)
│   ├── factories/                   # 🆕 기본 + 커스텀 팩토리들
│   │   ├── default-factory.ts       # 기본 Factory 생성 (Zero-Config용)
│   │   ├── web-worker-factory.ts    # 브라우저용 (선택적 import)
│   │   └── node-worker-factory.ts   # Node.js용 (선택적 import)
│   ├── runtime/
│   │   ├── worker-runtime.ts        # Worker 내부 실행 환경 (순수)
│   │   ├── type-registry.ts         # 클래스 등록 관리
│   │   └── instance-manager.ts      # 인스턴스 생명주기 관리
│   ├── communication/
│   │   ├── message-protocol.ts      # Worker-Main 통신 프로토콜
│   │   ├── error-serializer.ts      # 에러 직렬화/역직렬화
│   │   └── stream-handler.ts        # 스트리밍 응답 처리
│   ├── types/
│   │   ├── worker-options.ts        # 설정 타입 정의
│   │   └── message-types.ts         # 메시지 타입 정의
│   └── index.ts                     # 공개 API (Zero-Config + 선택적 주입)
├── examples/
│   ├── zero-config/                 # Zero-Config 예제
│   ├── custom-factory/              # 커스텀 팩토리 예제
│   └── advanced/                    # 고급 사용법 예제
├── docs/
└── README.md
```

### 핵심 설계 원칙

#### 1. 완전한 순수성 유지 ✨
```typescript
// ❌ 기존 패키지들이 Worker를 알게 하지 않음
@robota-sdk/agents    ← Worker 몰라도 됨
@robota-sdk/sessions  ← Worker 몰라도 됨  
@robota-sdk/team      ← Worker 몰라도 됨

// ✅ Worker 패키지만 다른 패키지들을 사용
@robota-sdk/worker    ← 다른 것들을 감싸기만 함
```

#### 2. 동적 Proxy 패턴 🔄
```typescript
class WorkerWrapper {
  constructor(target: any) {
    return new Proxy(this, {
      get(instance, prop) {
        if (prop in instance) return Reflect.get(instance, prop);
        
        // 모든 메서드를 Worker로 동적 위임
        return (...args: any[]) => 
          instance.executeInWorker(prop as string, args);
      }
    });
  }
}
```

#### 3. 선택적 의존성 주입 + 기본 Worker 지원 💉
```typescript
// 기존 방식 (변경 없음)
const robota = new Robota(config);
await robota.run('hello');

// Worker 방식 1: 자동 기본 Worker (Zero-Config)
const workerRobota = new WorkerWrapper(new Robota(config)) as Robota;
// ↑ Worker가 지원되는 환경이면 자동으로 기본 Worker 사용
// ↑ Worker 미지원이면 명확한 에러 메시지

// Worker 방식 2: 명시적 Factory 주입 (고급 사용)
import { WebWorkerFactory } from '@robota-sdk/worker/factories/web';
import { NodeWorkerFactory } from '@robota-sdk/worker/factories/node';

const workerRobota = new WorkerWrapper(
  new Robota(config),
  new WebWorkerFactory() // 커스텀 최적화 가능
) as Robota;

// Worker 방식 3: 완전 커스텀 Factory
const workerRobota = new WorkerWrapper(
  new Robota(config),
  new MyCustomWorkerFactory()
) as Robota;
```

#### 4. Zero-Config + 완전한 환경 중립성 🌐
```typescript
// Zero-Config: Factory 없이도 기본 Worker 자동 사용
const workerRobota = new WorkerWrapper(robota); // 브라우저/Node.js 자동 감지

// 고급 사용: 커스텀 Factory 주입 (선택사항)
const workerRobota = new WorkerWrapper(robota, customFactory);

// Worker 미지원 환경: 명확한 에러 메시지
// "Worker not supported. Please provide custom WorkerFactory or use compatible environment."
```

## 🚀 구현 계획

### Phase 1: 순수한 코어 인프라 구축 (2주)

#### 1.1 패키지 초기화
- [ ] `packages/worker` 디렉토리 생성
- [ ] package.json 설정 (의존성 없는 순수 코어)
- [ ] TypeScript 설정 (tsup, vitest)
- [ ] ESLint 규칙 적용

#### 1.2 순수한 추상화 인터페이스 구현
- [ ] `WorkerInterface` 추상 인터페이스 정의
- [ ] `WorkerFactory` 팩토리 인터페이스 정의
- [ ] 타입 정의 (worker-options.ts, message-types.ts)
- [ ] 통신 프로토콜 정의

#### 1.3 순수한 Worker 존재 확인 시스템
- [ ] `hasNativeWorker()` 함수 (단순 존재 확인만)
- [ ] `getWorkerEnvironment()` 함수 (web/node/unknown만)
- [ ] 복잡한 환경 감지 로직 없이 최소한의 확인만
- [ ] 명확한 에러 메시지 정의

#### 1.4 Zero-Config WorkerWrapper 구현
- [ ] `WorkerWrapper` 클래스 (선택적 Factory 지원)
- [ ] Proxy 기반 동적 메서드 인터셉션
- [ ] 기본 Factory 자동 생성 로직
- [ ] 명시적 Factory 주입 지원
- [ ] 타입 안전성 보장 (Generic 지원)

#### 1.5 순수한 Worker Runtime 구현
- [ ] `worker-runtime.ts` 환경 중립적 구조
- [ ] 동적 클래스 등록 시스템
- [ ] 인스턴스 생성/관리 로직
- [ ] 메시지 수신/처리 로직 (플랫폼 무관)

### Phase 2: 기본 Factory 구현 및 테스트 (2주)

#### 2.1 기본 Factory 시스템 구현
- [ ] `createDefaultWorkerFactory()` 함수 (Zero-Config용)
- [ ] `WebWorkerFactory` 구현 (브라우저용)
- [ ] `NodeWorkerFactory` 구현 (Node.js용)
- [ ] Factory들을 선택적 import로 분리
- [ ] 각 Factory별 환경별 최적화

#### 2.2 통신 시스템 완성
- [ ] 메시지 프로토콜 구현 완성
- [ ] 에러 직렬화/역직렬화 시스템
- [ ] Promise 기반 응답 처리
- [ ] 타임아웃 및 에러 핸들링

#### 2.3 타입 안전성 강화
- [ ] TypeScript 타입 정의 완성
- [ ] Generic 타입 지원 검증
- [ ] 인터페이스 기반 타입 안전성 확보
- [ ] IDE 자동완성 지원 확인

#### 2.4 기본 테스트 작성
- [ ] Zero-Config 동작 테스트 (자동 Factory 선택)
- [ ] Mock Factory를 이용한 Unit 테스트
- [ ] 브라우저/Node.js Factory Integration 테스트
- [ ] Worker 미지원 환경 에러 처리 테스트
- [ ] 타입 테스트 (TypeScript 컴파일)
- [ ] 선택적 주입 패턴 검증 테스트

### Phase 3: 고급 기능 및 확장성 구현 (2주)

#### 3.1 스트리밍 지원
- [ ] 스트리밍 응답 처리 로직 (플랫폼 무관)
- [ ] 청크 단위 메시지 전송
- [ ] AsyncIterable 지원
- [ ] 스트림 에러 처리

#### 3.2 최적화 기능
- [ ] 인스턴스 재사용 로직
- [ ] 메모리 관리 최적화
- [ ] 배치 메시지 처리
- [ ] 성능 모니터링 기능

#### 3.3 확장성 지원
- [ ] 커스텀 Factory 가이드라인 문서화
- [ ] Factory 인터페이스 확장 지원
- [ ] 플러그인 방식 Factory 등록
- [ ] 다양한 Worker 타입 지원 (Shared, Service Worker 등)

#### 3.4 고급 설정 옵션
- [ ] Worker 옵션 설정 (Factory별 최적화)
- [ ] 커스텀 통신 프로토콜 지원
- [ ] 디버깅 모드 및 로깅
- [ ] 개발자 도구 통합

### Phase 4: 안정화 및 문서화 (1주)

#### 4.1 포괄적 테스트
- [ ] 모든 Robota 클래스 테스트 (Robota, SessionManager, TeamContainer)
- [ ] 커스텀 Factory 구현 테스트
- [ ] 에지 케이스 테스트 (에러, 타임아웃, 대용량 데이터)
- [ ] 브라우저/Node.js 크로스 플랫폼 테스트
- [ ] 성능 테스트 (메모리, CPU, 응답 시간)

#### 4.2 문서화
- [ ] README.md 작성 (설치, Factory 사용법, 예제)
- [ ] API 문서 생성 (TypeDoc)
- [ ] 커스텀 Factory 구현 가이드
- [ ] 플랫폼별 예제 코드 작성
- [ ] 트러블슈팅 가이드

#### 4.3 배포 준비
- [ ] CI/CD 설정 (순수 코어 + 선택적 Factory)
- [ ] npm 패키지 설정 (모듈화된 export)
- [ ] 버전 관리 전략
- [ ] 릴리스 노트 작성

## 💡 주요 기술적 도전과 해결책

### 1. 플랫폼별 Worker 차이점
**문제**: 각 플랫폼마다 Worker API가 미묘하게 다름
**해결책**: 
- WorkerInterface로 통일된 추상화 제공
- Factory 패턴으로 플랫폼별 차이점 캡슐화
- 사용자가 각 환경에 최적화된 Factory 선택

### 2. 스트리밍 응답 처리
**문제**: Worker-Main 스레드 간 실시간 데이터 전송
**해결책**:
- 청크 기반 메시지 프로토콜 (플랫폼 무관)
- AsyncIterable wrapper 구현
- 백프레셔(backpressure) 처리

### 3. 에러 직렬화
**문제**: Error 객체의 Worker 경계 간 전송
**해결책**:
```typescript
interface SerializableError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  context?: Record<string, any>;
}
```

### 4. Factory 구현 복잡성
**문제**: 사용자가 직접 Factory를 구현해야 함
**해결책**:
- 명확한 WorkerInterface 정의
- 기본 Factory들 (Web, Node) 제공
- 상세한 구현 가이드 문서 제공
- 예제 코드와 템플릿 제공

### 5. 번들 크기 최적화
**문제**: 모든 Factory를 번들에 포함하면 크기 증가
**해결책**:
- 선택적 import로 필요한 Factory만 로드
- Tree-shaking 최적화
- 동적 import 사용

## 📊 성능 목표

### 응답 시간
- Worker 초기화: < 100ms
- 메서드 호출 오버헤드: < 5ms
- 스트리밍 지연: < 10ms

### 메모리 효율성
- Worker 기본 메모리: < 50MB
- 인스턴스 당 추가 메모리: < 10MB
- 메모리 누수 방지: 완전한 cleanup

### 호환성
- **브라우저**: Chrome 90+, Firefox 90+, Safari 14+ (Web Workers)
- **Node.js**: 10.5+ (Worker Threads), 18.0+ 권장
- **Bun**: 1.0+ (Bun Workers)
- **Deno**: 1.0+ (Web Worker API)
- **TypeScript**: 4.5+

## 🔄 사용 예시

### 기본 사용법 (Zero-Config + 선택적 주입)
```typescript
import { Robota } from '@robota-sdk/agents';
import { WorkerWrapper } from '@robota-sdk/worker';

// 기존 방식 (변경 없음)
const robota = new Robota({
  name: 'MyAgent',
  aiProviders: [openaiProvider],
  defaultModel: { provider: 'openai', model: 'gpt-4' }
});

// ✨ 가장 간단한 Worker 사용 (Zero-Config)
const workerRobota = new WorkerWrapper(robota) as Robota;
// ↑ 브라우저면 Web Worker, Node.js면 Worker Threads 자동 사용
// ↑ Worker 미지원 환경이면 명확한 에러 메시지

// 🔧 고급 사용: 명시적 Factory 주입 (선택사항)
import { WebWorkerFactory } from '@robota-sdk/worker/factories/web';
const customWorkerRobota = new WorkerWrapper(
  robota,
  new WebWorkerFactory({ /* 커스텀 옵션 */ })
) as Robota;

// 모든 메서드가 Worker에서 실행됨
const response = await workerRobota.run('Hello World');
const stream = workerRobota.runStream('Tell me a story');

// 정리
await workerRobota.destroy();
```

### 고급 사용법 (커스텀 Factory + 설정)
```typescript
// 🔧 명시적 Factory 주입 (고급 최적화)
import { WebWorkerFactory, NodeWorkerFactory } from '@robota-sdk/worker/factories';

const workerRobota = new WorkerWrapper(
  robota,
  new WebWorkerFactory({
    name: 'robota-worker',
    credentials: 'same-origin'
  }),
  {
    timeout: 30000,
    debug: true
  }
) as Robota;

// 🎨 완전 커스텀 Factory 구현
class ServiceWorkerFactory implements WorkerFactory {
  createWorker(scriptPath: string): WorkerInterface {
    // Service Worker 구현...
    const registration = navigator.serviceWorker.register(scriptPath);
    // Worker 인터페이스 반환
  }
}

const customWorkerRobota = new WorkerWrapper(
  robota,
  new ServiceWorkerFactory()
) as Robota;

// 📦 동일한 Factory로 여러 인스턴스
const factory = new NodeWorkerFactory();
const workerSessions = new WorkerWrapper(new SessionManager(), factory) as SessionManager;
const workerTeam = new WorkerWrapper(new TeamContainer(config), factory) as TeamContainer;

// ❌ Worker 미지원 환경에서 시도
try {
  const workerRobota = new WorkerWrapper(robota);
} catch (error) {
  console.error(error.message);
  // "Worker not supported in this environment. 
  //  Please provide a custom WorkerFactory or run in a Worker-compatible environment."
}
```

## 🎯 성공 지표

### 기능적 목표
- [ ] 모든 Robota SDK 클래스가 Worker에서 정상 동작
- [ ] 기존 코드 100% 호환성 유지
- [ ] 완전한 타입 안전성 보장
- [ ] 에러 없는 안정적인 동작

### 성능 목표
- [ ] Worker 오버헤드 < 10%
- [ ] 메모리 사용량 합리적 범위
- [ ] 스트리밍 지연 최소화
- [ ] 리소스 누수 방지

### 개발자 경험
- [ ] 직관적인 API 설계
- [ ] 포괄적인 문서 제공
- [ ] 명확한 에러 메시지
- [ ] 쉬운 디버깅 지원

## 📅 타임라인

| 주차 | 목표 | 산출물 |
|------|------|--------|
| 1-2주 | Phase 1 완료 | 순수한 코어, 인터페이스, WorkerWrapper |
| 3-4주 | Phase 2 완료 | 기본 Factory들, 통신 시스템, 의존성 주입 테스트 |
| 5-6주 | Phase 3 완료 | 고급 기능, 확장성, 커스텀 Factory 지원 |
| 7주 | Phase 4 완료 | 크로스 플랫폼 테스트, 문서화, 배포 준비 |

## 🎉 기대 효과

### 기술적 이점
- **메인 스레드 차단 방지**: AI 연산이 UI를 블록하지 않음
- **병렬 처리**: 여러 에이전트 동시 실행 가능
- **안정성 향상**: Worker 크래시가 메인 앱에 영향 없음
- **확장성**: 무제한 에이전트 인스턴스 생성 가능

### 사용자 경험 개선
- **부드러운 UI**: 무거운 AI 작업 중에도 반응성 유지
- **빠른 응답**: 병렬 처리로 전체 처리 시간 단축
- **안정적인 앱**: 개별 에이전트 오류가 전체 앱에 영향 없음

### 개발자 이점
- **명확한 제어**: 사용자가 Worker 환경을 명시적으로 선택
- **타입 안전성**: 완전한 TypeScript 지원 유지
- **순수성**: 기존 패키지들의 깔끔함 유지
- **무제한 확장성**: 새로운 환경 지원을 위한 커스텀 Factory 구현 가능
- **플랫폼 최적화**: 각 환경에 특화된 최적화 가능

## 🎯 **최종 설계 원칙 정리**

### ✅ **핵심 원칙 (최종 확정)**
1. **Zero-Config 우선**: Factory 없이도 기본 Worker 자동 사용
2. **순수한 환경 확인**: 복잡한 감지 없이 Worker 존재만 확인
3. **선택적 의존성 주입**: 고급 사용자는 커스텀 Factory 주입 가능
4. **인터페이스 기반**: WorkerInterface로 모든 플랫폼 추상화
5. **명확한 에러 처리**: Worker 미지원시 정확한 가이드 제공
6. **무제한 확장**: 새로운 환경을 위한 커스텀 Factory 자유로운 구현

### 🚀 **Zero-Config + 선택적 주입의 장점**
- **최고의 사용성**: 대부분 한 줄로 해결 `new WorkerWrapper(robota)`
- **순수한 확인**: 복잡한 환경 감지 없이 Worker 존재만 확인
- **명확한 에러**: Worker 미지원시 정확한 해결 방법 제시
- **유연한 확장**: 필요시 완전한 커스터마이징 가능
- **테스트 용이**: Mock Factory로 쉬운 테스트
- **유지보수성**: 각 Factory가 독립적으로 관리됨

## 🔧 **핵심 구현 세부사항**

### **1. 순수한 Worker 존재 확인**
```typescript
// packages/worker/src/detection/worker-support.ts
export function hasNativeWorker(): boolean {
  // 브라우저 Web Worker 확인
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    return true;
  }
  
  // Node.js Worker Threads 확인 (순수한 확인만)
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      eval('require.resolve("worker_threads")');
      return true;
    } catch {
      return false;
    }
  }
  
  return false;
}

export function getWorkerEnvironment(): 'web' | 'node' | 'unknown' {
  if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
    return 'web';
  }
  
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node';
  }
  
  return 'unknown';
}
```

### **2. Zero-Config 기본 Factory 생성**
```typescript
// packages/worker/src/factories/default-factory.ts
export function createDefaultWorkerFactory(): WorkerFactory {
  if (!hasNativeWorker()) {
    throw new Error(
      'Worker not supported in this environment. ' +
      'Please provide a custom WorkerFactory or run in a Worker-compatible environment.'
    );
  }
  
  const env = getWorkerEnvironment();
  
  switch (env) {
    case 'web':
      return createWebWorkerFactory();
    case 'node':
      return createNodeWorkerFactory();
    default:
      throw new Error(
        `Unsupported environment: ${env}. ` +
        'Please provide a custom WorkerFactory for this environment.'
      );
  }
}
```

### **3. 선택적 Factory 지원 WorkerWrapper**
```typescript
// packages/worker/src/wrapper/worker-wrapper.ts
export class WorkerWrapper {
  constructor(
    target: any,
    workerFactory?: WorkerFactory,  // 👈 선택사항!
    options: WorkerOptions = {}
  ) {
    // Factory가 제공되지 않으면 기본 Factory 사용
    const factory = workerFactory || createDefaultWorkerFactory();
    
    // 나머지 구현...
  }
}
```

### **4. 사용 패턴 매트릭스**

| 사용 방식 | 코드 | 설명 |
|-----------|------|------|
| **Zero-Config** | `new WorkerWrapper(robota)` | 가장 간단, 자동 환경 감지 |
| **명시적 Factory** | `new WorkerWrapper(robota, factory)` | 고급 최적화 가능 |
| **커스텀 Factory** | `new WorkerWrapper(robota, custom)` | 완전한 제어권 |
| **Worker 미지원** | `try/catch` | 명확한 에러 메시지 |

### **5. 에러 처리 전략**
```typescript
// Worker 지원 확인
if (!hasNativeWorker()) {
  throw new Error([
    'Worker not supported in this environment.',
    'Solutions:',
    '1. Run in a Worker-compatible environment (browser/Node.js 10.5+)',
    '2. Provide a custom WorkerFactory',
    '3. Use Robota without Worker (original object)'
  ].join('\n'));
}
```

이 계획을 통해 **Zero-Config와 무제한 확장성을 모두 갖춘** Robota SDK Worker 지원을 구현하여, 
최고의 사용자 경험과 개발자 경험을 제공할 수 있을 것입니다! 🚀 