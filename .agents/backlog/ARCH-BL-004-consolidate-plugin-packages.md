---
title: 'ARCH-BL-004: Consolidate agent-plugin-* into single agent-plugin package'
status: backlog
created: 2026-05-16
priority: high
urgency: soon
area: packages/agent-plugin-*, packages/agent-plugin (new)
depends_on: []
---

## Problem

현재 플러그인이 8개의 독립 npm 패키지로 분산되어 있다.

```
@robota-sdk/agent-plugin-conversation-history
@robota-sdk/agent-plugin-error-handling
@robota-sdk/agent-plugin-execution-analytics
@robota-sdk/agent-plugin-limits
@robota-sdk/agent-plugin-logging
@robota-sdk/agent-plugin-performance
@robota-sdk/agent-plugin-usage
@robota-sdk/agent-plugin-webhook
```

모두 `agent-core`의 플러그인 인터페이스를 구현하는 동일한 패턴이며, 각각 독립 릴리즈 사이클을 갖는다.

## Goal

모든 공식 플러그인을 단일 `@robota-sdk/agent-plugin` 패키지로 통합한다.

- `agent-core`가 정의하는 플러그인 인터페이스(훅/이벤트 시스템)는 **그대로 유지** (확장 지점)
- 사용자는 동일한 `agent-core` 인터페이스로 자체 플러그인 패키지를 만들어 등록할 수 있다
- Tree-shaking으로 사용하지 않는 플러그인은 번들에 포함되지 않아야 함

## Design

### Package structure

```
packages/
├── agent-plugin/                    # NEW: 통합 패키지
│   ├── src/
│   │   ├── index.ts                 # 모든 플러그인 re-export
│   │   ├── conversation-history/    # 기존 agent-plugin-conversation-history 코드 이동
│   │   ├── error-handling/
│   │   ├── execution-analytics/
│   │   ├── limits/
│   │   ├── logging/
│   │   ├── performance/
│   │   ├── usage/
│   │   ├── webhook/
│   │   └── shared/                  # 플러그인 공통 유틸 (있다면)
│   └── package.json
└── agent-plugin-* (기존)            # 삭제 대상 (마이그레이션 완료 후)
```

### Export surface

```ts
// 통합 패키지에서 필요한 플러그인만 import
import { createLoggingPlugin } from '@robota-sdk/agent-plugin';
import { createUsagePlugin } from '@robota-sdk/agent-plugin';
import { createLimitsPlugin } from '@robota-sdk/agent-plugin';

// 커스텀 플러그인은 agent-core 인터페이스로 확장
import type { IPlugin } from '@robota-sdk/agent-core';
const myPlugin: IPlugin = {
  name: 'my-plugin',
  hooks: { ... },
};
```

### Sub-path exports

각 플러그인의 외부 의존성(webhook → `node-fetch` 등)이 있으므로 필요 시 sub-path 사용:

```json
{
  "exports": {
    ".": "./dist/node/index.js",
    "./webhook": "./dist/node/webhook/index.js"
  }
}
```

외부 의존성이 없는 플러그인은 루트 export로 통합.

### Dependency rule

```
agent-plugin → agent-core (only)
```

플러그인은 `agent-core`의 훅/이벤트 인터페이스만 사용한다.
`agent-framework`, `agent-session`, `agent-tools`는 의존 금지.

## Circular Dependency Prevention

### 금지 의존 방향

```
agent-core   ──→  agent-plugin       ❌ 절대 금지 (core의 zero-dependency 원칙 위반)
agent-plugin ──→  agent-framework    ❌ 절대 금지 (plugin은 core만 참조)
agent-plugin ──→  agent-session      ❌ 절대 금지
agent-plugin ──→  agent-tools        ❌ 절대 금지
plugin 서브모듈  ──→  다른 plugin 서브모듈  ❌ 금지 (예: logging/ → usage/)
```

`agent-core`는 zero-dependency 패키지다. `agent-plugin`이 `agent-core`에 의존하는 것은
허용되지만, 그 반대는 `agent-core`의 핵심 원칙을 파괴한다.

### 플러그인 등록 방향 명확화

```
agent-core
  ├── IPlugin 인터페이스 소유
  └── PluginRegistry (등록소)

agent-plugin
  ├── ConversationHistoryPlugin implements IPlugin  ← 구현체만
  ├── LoggingPlugin implements IPlugin
  └── ...

사용 시 (agent-framework 또는 사용자 코드):
  import { createLoggingPlugin } from '@robota-sdk/agent-plugin';
  robota.use(createLoggingPlugin());   ← core의 .use() 메서드로 등록
```

플러그인은 core에 **등록되는** 것이지, core가 플러그인을 **import하는** 것이 아니다.
이 방향이 뒤집히는 순간 순환이 발생한다.

### 서브 모듈 간 직접 import 금지

```ts
// ❌ 금지: logging 플러그인이 usage 플러그인을 직접 참조
// src/logging/plugin.ts
import { UsageCollector } from '../usage/collector.js';

// ✅ 허용: 공통 유틸은 shared/ 로만
import { formatTimestamp } from '../shared/format.js';

// ✅ 허용: agent-core 인터페이스는 항상 허용
import type { IHookInput } from '@robota-sdk/agent-core';
```

### 탐지 및 차단 수단

1. **ESLint `import-x/no-cycle`**: 빌드 전 소스 레벨 순환 감지
2. **`madge --circular`**: CI에서 `src/` 전체 스캔
   ```bash
   pnpm madge --circular --ts-config tsconfig.json src/
   ```
3. **`pnpm harness:scan`**: cycle-check step 추가 예정
4. **agent-core 오염 검사**: `grep -r "agent-plugin" packages/agent-core/src/` — core가 plugin을 import하면 즉시 차단
5. **의존성 방향 harness**: `agent-plugin`의 `package.json` `dependencies`에 `agent-framework`, `agent-session`, `agent-tools`가 없는지 검사

## Migration Steps

1. `packages/agent-plugin` 신규 패키지 생성
2. 기존 8개 패키지 소스를 서브 디렉토리로 이동
3. `package.json` — 8개의 의존성 합산, 중복 제거. 외부 의존성은 optional peer로
4. `tsdown.config.ts` — 단일 entry 빌드 설정 (tree-shaking 보장)
5. `agent-framework`, `agent-cli` 등 downstream consumer import 경로 일괄 변경
6. 기존 8개 패키지에 deprecation notice 추가 후 삭제

## Test Plan

- [ ] `pnpm typecheck` 전체 통과
- [ ] `pnpm build` — `agent-plugin` 패키지 빌드 성공
- [ ] `madge --circular src/` — 순환 의존성 없음 확인
- [ ] `grep -r "agent-plugin" packages/agent-core/src/` — 결과 없음 확인
- [ ] 각 플러그인 단위 테스트 이전 완료 및 통과 (8개 패키지 테스트 통합)
- [ ] `pnpm harness:scan:build-contracts` 통과
- [ ] 플러그인 등록 후 훅 동작 통합 테스트

## User Execution Test Scenarios

### Scenario 1: 통합 패키지에서 플러그인 등록

**Prerequisites**: `@robota-sdk/agent-plugin` 설치

**Steps**:

```ts
import { createLoggingPlugin, createUsagePlugin } from '@robota-sdk/agent-plugin';

robota.use(createLoggingPlugin({ level: 'info' }));
robota.use(createUsagePlugin());
```

**Expected**: 타입 정상. 훅 정상 동작. 로그 출력 및 usage 수집 확인.

**Evidence**: _(migration 완료 후 채움)_

### Scenario 2: 커스텀 플러그인 확장

**Steps**:

```ts
import type { IPlugin } from '@robota-sdk/agent-core';

const myPlugin: IPlugin = {
  name: 'my-plugin',
  hooks: {
    beforeExecution: async (input) => {
      console.log('before:', input);
    },
  },
};
robota.use(myPlugin);
```

**Expected**: `@robota-sdk/agent-plugin` 미설치 상태에서도 `agent-core`만으로 커스텀 플러그인 구현 및 등록 가능.

**Evidence**: _(migration 완료 후 채움)_
