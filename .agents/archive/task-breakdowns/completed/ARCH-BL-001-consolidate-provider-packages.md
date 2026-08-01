---
title: 'ARCH-BL-001: Consolidate agent-provider-* into single agent-provider package'
status: backlog
created: 2026-05-16
priority: high
urgency: soon
area: packages/agent-provider-*, packages/agent-provider (new)
depends_on: []
---

## Problem

현재 AI provider가 8개의 독립 npm 패키지로 분산되어 있다.

```
@robota-sdk/agent-provider-anthropic
@robota-sdk/agent-provider-openai
@robota-sdk/agent-provider-openai-compatible
@robota-sdk/agent-provider-deepseek
@robota-sdk/agent-provider-gemini
@robota-sdk/agent-provider-google
@robota-sdk/agent-provider-gemma
@robota-sdk/agent-provider-bytedance
```

사용자가 여러 provider를 사용하려면 여러 패키지를 설치해야 하고, 우리는 8개의 독립 릴리즈 사이클을 관리해야 한다.

## Goal

모든 공식 provider를 단일 `@robota-sdk/agent-provider` 패키지로 통합한다.

- 내부 레이어 구조(각 provider가 `agent-core` 인터페이스를 구현하는 방식)는 **그대로 유지**
- 사용자는 `agent-provider` 미포함 커스텀 provider를 만들기 위해 `agent-core` 인터페이스를 구현하는 자체 패키지를 만들 수 있다 (확장 지점은 동일)
- Tree-shaking으로 사용하지 않는 provider는 번들에 포함되지 않아야 함

## Design

### Package structure

```
packages/
├── agent-provider/              # NEW: 통합 패키지
│   ├── src/
│   │   ├── index.ts             # 모든 provider re-export
│   │   ├── anthropic/           # 기존 agent-provider-anthropic 코드 이동
│   │   ├── openai/              # 기존 agent-provider-openai 코드 이동
│   │   ├── openai-compatible/
│   │   ├── deepseek/
│   │   ├── gemini/
│   │   ├── google/
│   │   ├── gemma/
│   │   └── bytedance/
│   └── package.json
└── agent-provider-* (기존)     # 삭제 대상 (마이그레이션 완료 후)
```

### Export surface

```ts
// 사용자는 하나의 패키지로 모든 provider 사용 가능
import { AnthropicProvider } from '@robota-sdk/agent-provider';
import { OpenAIProvider } from '@robota-sdk/agent-provider';
import { GeminiProvider } from '@robota-sdk/agent-provider';

// 커스텀 provider는 agent-core 인터페이스로 확장
import type { IAIProvider } from '@robota-sdk/agent-core';
class MyCustomProvider implements IAIProvider { ... }
```

### Sub-path exports (대용량 의존성 격리)

각 provider가 서로 다른 SDK 의존성을 가지므로, sub-path export를 사용한다.

```json
{
  "exports": {
    "./anthropic": "./dist/node/anthropic/index.js",
    "./openai": "./dist/node/openai/index.js",
    "./gemini": "./dist/node/gemini/index.js",
    ".": "./dist/node/index.js"
  }
}
```

루트 export에서 모두 re-export하되, 각 provider의 외부 SDK(`@anthropic-ai/sdk`, `openai`, `@google/generative-ai`)는 `peerDependencies` 또는 `optionalDependencies`로 선언한다.

### Dependency rule

```
agent-provider → agent-core (only)
```

레이어 규칙 변경 없음. 기존 8개 패키지가 각각 `agent-core`에만 의존했던 것과 동일하다.

## Circular Dependency Prevention

### 금지 의존 방향

```
agent-core  ←──  agent-provider      ✅ 허용 (단방향)
agent-core  ──→  agent-provider      ❌ 절대 금지
agent-framework ──→ agent-provider   ❌ 절대 금지 (framework는 IAIProvider 인터페이스만 사용)
```

provider는 레이어 최하단에 위치하므로 패키지 수준 순환 위험은 낮다.
그러나 통합 이후 서브 모듈 간 cross-import가 생기는 것이 주요 위험이다.

### 서브 모듈 간 직접 import 금지

```ts
// ❌ 금지: anthropic 서브모듈이 openai 서브모듈을 직접 참조
// src/anthropic/client.ts
import { normalizeResponse } from '../openai/normalizer.js';

// ✅ 허용: 공통 유틸은 shared/ 로만
// src/shared/normalizer.ts  ← 공통 로직 위치
import { normalizeResponse } from '../shared/normalizer.js';
```

### 탐지 및 차단 수단

1. **ESLint `import-x/no-cycle`**: 빌드 전 소스 레벨 순환 감지
2. **`madge --circular`**: CI에서 `src/` 전체 스캔
   ```bash
   pnpm madge --circular --ts-config tsconfig.json src/
   ```
3. **`pnpm harness:scan`**: cycle-check step 추가 예정 (ARCH-BL-005 또는 별도 인프라 태스크)
4. **TypeScript `paths` 제한**: 각 서브 디렉토리의 `tsconfig.json`에서 형제 서브 디렉토리를 paths에서 제외

## Migration Steps

1. `packages/agent-provider` 신규 패키지 생성
2. 기존 8개 패키지 소스를 서브 디렉토리로 이동
3. `package.json` — peerDependencies 정리 (각 provider SDK를 optional peer로)
4. `tsdown.config.ts` — sub-path entry 포함 빌드 설정
5. `agent-framework`, `agent-cli` 등 downstream consumer import 경로 일괄 변경
6. 기존 8개 패키지에 deprecation notice 추가 후 삭제

## Test Plan

- [ ] `pnpm typecheck` 전체 통과
- [ ] `pnpm build` — `agent-provider` 패키지 빌드 성공
- [ ] sub-path export (`./anthropic`, `./openai` 등) 타입 해석 정상
- [ ] Tree-shaking 검증: anthropic만 import 시 openai 번들 미포함
- [ ] `pnpm harness:scan:build-contracts` 통과
- [ ] 각 provider 단위 테스트 이전 완료 및 통과

## User Execution Test Scenarios

### Scenario 1: 단일 패키지로 provider 사용

**Prerequisites**: `@robota-sdk/agent-provider` 설치, 각 provider SDK peer 설치

**Steps**:

```ts
import { AnthropicProvider, OpenAIProvider } from '@robota-sdk/agent-provider';
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
```

**Expected**: 타입 정상, 런타임 정상

**Evidence**: _(migration 완료 후 채움)_

### Scenario 2: 커스텀 provider 확장

**Steps**:

```ts
import type { IAIProvider } from '@robota-sdk/agent-core';
class MyProvider implements IAIProvider { ... }
```

**Expected**: `@robota-sdk/agent-provider` 미설치 상태에서도 `agent-core`만으로 커스텀 provider 구현 가능

**Evidence**: _(migration 완료 후 채움)_
