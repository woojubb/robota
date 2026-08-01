---
title: 'ARCH-BL-002: Consolidate agent-transport-* into single agent-transport package'
status: backlog
created: 2026-05-16
priority: high
urgency: soon
area: packages/agent-transport-*, packages/agent-transport (new)
depends_on: []
---

## Problem

현재 transport가 5개의 독립 npm 패키지로 분산되어 있다.

```
@robota-sdk/agent-transport-tui
@robota-sdk/agent-transport-headless
@robota-sdk/agent-transport-http
@robota-sdk/agent-transport-ws
@robota-sdk/agent-transport-mcp
```

각 transport는 별개의 릴리즈 사이클과 버전 관리를 갖는다. CLI나 서버를 구성할 때 여러 패키지를 별도로 설치해야 한다.

## Goal

모든 공식 transport를 단일 `@robota-sdk/agent-transport` 패키지로 통합한다.

- `agent-interface-transport`가 정의하는 `ITransportAdapter` 인터페이스는 **그대로 유지** (확장 지점)
- 사용자는 `ITransportAdapter`를 구현하는 자체 transport 패키지를 만들어 붙일 수 있다
- 각 transport는 독립적인 외부 의존성을 가지므로 sub-path export로 격리

## Design

### Package structure

```
packages/
├── agent-transport/             # NEW: 통합 패키지
│   ├── src/
│   │   ├── index.ts             # 공통 타입 + 전체 re-export
│   │   ├── tui/                 # 기존 agent-transport-tui 코드 이동
│   │   ├── headless/            # 기존 agent-transport-headless 코드 이동
│   │   ├── http/                # 기존 agent-transport-http 코드 이동
│   │   ├── ws/                  # 기존 agent-transport-ws 코드 이동
│   │   └── mcp/                 # 기존 agent-transport-mcp 코드 이동
│   └── package.json
└── agent-transport-* (기존)     # 삭제 대상 (마이그레이션 완료 후)
```

### Export surface

```ts
// 통합 패키지에서 원하는 transport만 import
import { createTuiTransport } from '@robota-sdk/agent-transport/tui';
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import { createHttpTransport } from '@robota-sdk/agent-transport/http';

// 커스텀 transport는 agent-interface-transport로 확장
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
class MyTransport implements ITransportAdapter { ... }
```

### Sub-path exports

각 transport의 외부 의존성(ink, express, ws, @modelcontextprotocol/sdk 등)이 다르므로 sub-path 필수:

```json
{
  "exports": {
    "./tui": "./dist/node/tui/index.js",
    "./headless": "./dist/node/headless/index.js",
    "./http": "./dist/node/http/index.js",
    "./ws": "./dist/node/ws/index.js",
    "./mcp": "./dist/node/mcp/index.js",
    ".": "./dist/node/index.js"
  }
}
```

각 transport의 외부 SDK는 `optionalDependencies` 또는 `peerDependencies`로 선언.

### Dependency rule

```
agent-transport → agent-interface-transport
agent-transport → agent-framework (InteractiveSession 등)
```

기존 각 transport 패키지의 의존 관계와 동일하게 유지.

## Circular Dependency Prevention

### 금지 의존 방향

```
agent-framework  ──→  agent-interface-transport  ←──  agent-transport   ✅ 다이아몬드 구조 (허용)
agent-framework  ──→  agent-transport             ❌ 절대 금지
agent-transport  ──→  agent-cli                   ❌ 절대 금지
transport 서브모듈  ──→  다른 transport 서브모듈   ❌ 금지 (예: tui → http)
```

`agent-interface-transport`가 별도 패키지로 남아있는 이유가 바로 이 다이아몬드 구조를 유지하기 위해서다.
**`agent-interface-transport`는 통합 대상이 아니며 이 작업 이후에도 독립 패키지로 유지한다.**

### agent-interface-transport 역할 보존

```
                    agent-core
                        ↑
           ┌────────────┴────────────┐
    agent-framework         agent-transport
           ↑                        ↑
    agent-interface-transport ──────┘
          (계약만 정의, 구현 없음)
```

`agent-framework`와 `agent-transport` 양쪽이 `agent-interface-transport`의 타입을 import하고,
서로는 직접 참조하지 않는다. 이 구조가 깨지면 즉시 순환이 발생한다.

### 서브 모듈 간 직접 import 금지

```ts
// ❌ 금지: tui 서브모듈이 headless를 직접 참조
// src/tui/runner.ts
import { HeadlessRunner } from '../headless/runner.js';

// ✅ 허용: 공통 유틸은 shared/ 로만
import { formatOutput } from '../shared/format.js';
```

### 탐지 및 차단 수단

1. **ESLint `import-x/no-cycle`**: 빌드 전 소스 레벨 순환 감지
2. **`madge --circular`**: CI에서 `src/` 전체 스캔
   ```bash
   pnpm madge --circular --ts-config tsconfig.json src/
   ```
3. **`pnpm harness:scan`**: cycle-check step 추가 예정
4. **`agent-interface-transport` 존재 확인**: harness에서 이 패키지가 삭제/병합되지 않았는지 검사

## Migration Steps

1. `packages/agent-transport` 신규 패키지 생성
2. 기존 5개 패키지 소스를 서브 디렉토리로 이동
3. `package.json` — 각 외부 SDK를 optional peer로 정리
4. `tsdown.config.ts` — sub-path entry 포함 빌드 설정
5. `agent-cli`, `agent-web-ui`, `apps/*` 등 downstream consumer import 경로 일괄 변경
6. 기존 5개 패키지에 deprecation notice 추가 후 삭제

## Test Plan

- [ ] `pnpm typecheck` 전체 통과
- [ ] `pnpm build` — `agent-transport` 패키지 빌드 성공
- [ ] sub-path export 타입 해석 정상 (tui, headless, http, ws, mcp)
- [ ] 각 transport 단위/통합 테스트 이전 완료 및 통과
- [ ] `pnpm harness:scan:build-contracts` 통과
- [ ] CLI E2E: TUI transport 정상 동작 확인

## User Execution Test Scenarios

### Scenario 1: Sub-path import으로 transport 선택

**Prerequisites**: `@robota-sdk/agent-transport` + 해당 peer 설치

**Steps**:

```ts
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
const transport = createHeadlessTransport({ outputFormat: 'text' });
```

**Expected**: 타입 정상, 런타임 정상. tui/ink 등 다른 transport 의존성은 번들 미포함.

**Evidence**: _(migration 완료 후 채움)_

### Scenario 2: 커스텀 transport 확장

**Steps**:

```ts
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
class MyTransport implements ITransportAdapter { ... }
```

**Expected**: `@robota-sdk/agent-transport` 미설치 상태에서도 구현 가능. 계층 구조 정상.

**Evidence**: _(migration 완료 후 채움)_
