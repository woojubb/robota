---
title: 'ARCH-BL-003: Consolidate agent-command-* into single agent-command package'
status: backlog
created: 2026-05-16
priority: high
urgency: soon
area: packages/agent-command-*, packages/agent-command (new)
depends_on: []
---

## Problem

현재 커맨드 모듈이 21개의 독립 npm 패키지로 분산되어 있다.

```
@robota-sdk/agent-command-agent
@robota-sdk/agent-command-background
@robota-sdk/agent-command-compact
@robota-sdk/agent-command-context
@robota-sdk/agent-command-exit
@robota-sdk/agent-command-help
@robota-sdk/agent-command-language
@robota-sdk/agent-command-memory
@robota-sdk/agent-command-mode
@robota-sdk/agent-command-model
@robota-sdk/agent-command-permissions
@robota-sdk/agent-command-plugin
@robota-sdk/agent-command-provider
@robota-sdk/agent-command-reset
@robota-sdk/agent-command-rewind
@robota-sdk/agent-command-session
@robota-sdk/agent-command-settings
@robota-sdk/agent-command-skills
@robota-sdk/agent-command-statusline
@robota-sdk/agent-command-user-local
```

21개의 릴리즈 사이클, 21개의 `package.json`, 21개의 `tsdown.config.ts`를 유지해야 한다.
agent-cli가 모두를 조립할 때 import 경로가 21줄이 필요하다.

## Goal

모든 공식 커맨드 모듈을 단일 `@robota-sdk/agent-command` 패키지로 통합한다.

- `ICommandModule` 인터페이스(agent-framework 소유)는 **그대로 유지** (확장 지점)
- 사용자는 `ICommandModule`을 구현하는 자체 커맨드 패키지를 만들어 CLI에 등록할 수 있다
- CLI는 필요한 커맨드만 골라서 조립하는 방식을 유지 (tree-shaking)

## Design

### Package structure

```
packages/
├── agent-command/               # NEW: 통합 패키지
│   ├── src/
│   │   ├── index.ts             # 모든 커맨드 모듈 re-export
│   │   ├── agent/               # 기존 agent-command-agent 코드 이동
│   │   ├── background/
│   │   ├── compact/
│   │   ├── context/
│   │   ├── exit/
│   │   ├── help/
│   │   ├── language/
│   │   ├── memory/
│   │   ├── mode/
│   │   ├── model/
│   │   ├── permissions/
│   │   ├── plugin/
│   │   ├── provider/
│   │   ├── reset/
│   │   ├── rewind/
│   │   ├── session/
│   │   ├── settings/
│   │   ├── skills/
│   │   ├── statusline/
│   │   └── user-local/
│   └── package.json
└── agent-command-* (기존)       # 삭제 대상 (마이그레이션 완료 후)
```

### Export surface

```ts
// 통합 패키지에서 필요한 커맨드만 import
import { createProviderCommandModule } from '@robota-sdk/agent-command';
import { createModelCommandModule } from '@robota-sdk/agent-command';
import { createHelpCommandModule } from '@robota-sdk/agent-command';

// 커스텀 커맨드는 ICommandModule 인터페이스로 확장
import type { ICommandModule } from '@robota-sdk/agent-framework';
const myCommand: ICommandModule = { name: 'my-cmd', ... };
```

### Sub-path exports (선택적)

각 커맨드가 독립적인 외부 의존성을 거의 갖지 않으므로 루트 export로 통합해도 무방하다.
단, `agent-command-provider`처럼 무거운 의존성이 있는 경우 sub-path를 고려한다.

```json
{
  "exports": {
    ".": "./dist/node/index.js",
    "./provider": "./dist/node/provider/index.js"
  }
}
```

### Dependency rule

```
agent-command → agent-framework (ICommandModule, command contracts)
agent-command → agent-core (공통 타입)
agent-command → agent-session, agent-tools (각 커맨드 구현 필요 시)
```

기존 21개 패키지들의 의존 관계를 하나로 합산.

## Circular Dependency Prevention

### 금지 의존 방향

```
agent-framework  ──→  agent-command    ❌ 절대 금지 (framework는 ICommandModule 인터페이스만 소유)
agent-command    ──→  agent-transport  ❌ 절대 금지 (명령어가 transport에 의존하면 안 됨)
agent-command    ──→  agent-cli        ❌ 절대 금지
command 서브모듈  ──→  다른 command 서브모듈  ❌ 금지 (예: provider/ → model/)
```

가장 위험한 시나리오는 `agent-framework`가 `agent-command`를 import하는 경우다.
framework는 `ICommandModule` 인터페이스만 소유하며, 구체 커맨드 구현체를 참조해서는 안 된다.

### ICommandModule 계약 위치 명확화

```
agent-framework
  ├── commands/
  │   ├── ICommandModule.ts       ← 인터페이스 소유 (framework)
  │   ├── CommandRegistry.ts      ← 레지스트리 (framework)
  │   └── CommandExecutor.ts      ← 실행 인프라 (framework)

agent-command
  ├── provider/
  │   └── index.ts                ← ICommandModule 구현체 (command)
  ├── model/
  └── ...

agent-cli                         ← 조립: 어떤 커맨드를 등록할지 결정
```

`agent-framework`는 인터페이스와 실행 인프라만 갖는다. 커맨드 목록을 하드코딩하지 않는다.

### 서브 모듈 간 공유 로직 처리

21개 커맨드 중 유사한 유틸이 있더라도 서브 디렉토리 간 직접 import는 금지:

```ts
// ❌ 금지: provider/ 커맨드가 model/ 유틸을 직접 참조
import { formatModelName } from '../model/formatter.js';

// ✅ 허용: 공통 유틸은 shared/ 로만
import { formatModelName } from '../shared/formatter.js';
```

### 탐지 및 차단 수단

1. **ESLint `import-x/no-cycle`**: 빌드 전 소스 레벨 순환 감지
2. **`madge --circular`**: CI에서 `src/` 전체 스캔
   ```bash
   pnpm madge --circular --ts-config tsconfig.json src/
   ```
3. **`pnpm harness:scan`**: cycle-check step 추가 예정
4. **agent-framework 오염 검사**: `grep -r "agent-command" packages/agent-framework/src/` — framework가 command를 import하면 즉시 차단

## Migration Steps

1. `packages/agent-command` 신규 패키지 생성
2. 기존 21개 패키지 소스를 서브 디렉토리로 이동
3. `package.json` — 21개의 의존성 합산, 중복 제거
4. `tsdown.config.ts` — 단일 entry 빌드 설정 (tree-shaking 보장)
5. `agent-cli` import 경로 21줄 → 1줄로 변경
6. 기존 21개 패키지에 deprecation notice 추가 후 삭제

## Test Plan

- [ ] `pnpm typecheck` 전체 통과
- [ ] `pnpm build` — `agent-command` 패키지 빌드 성공
- [ ] `agent-cli`에서 각 커맨드 모듈 import 정상
- [ ] 각 커맨드 단위 테스트 이전 완료 및 통과 (21개 패키지 테스트 통합)
- [ ] `pnpm harness:scan:build-contracts` 통과
- [ ] CLI E2E: `/help`, `/provider`, `/model` 등 주요 커맨드 정상 동작

## User Execution Test Scenarios

### Scenario 1: 통합 패키지에서 커맨드 import

**Prerequisites**: `@robota-sdk/agent-command` 설치

**Steps**:

```ts
import {
  createProviderCommandModule,
  createModelCommandModule,
  createHelpCommandModule,
} from '@robota-sdk/agent-command';
```

**Expected**: 타입 정상. agent-cli 빌드 성공. `/help`, `/model`, `/provider` 정상 동작.

**Evidence**: _(migration 완료 후 채움)_

### Scenario 2: 커스텀 커맨드 확장

**Steps**:

```ts
import type { ICommandModule } from '@robota-sdk/agent-framework';

const myCommand: ICommandModule = {
  name: 'my-cmd',
  description: 'My custom command',
  execute: async (args, options) => ({ message: 'hello', success: true }),
};
// CLI에 등록
session.registerCommand(myCommand);
```

**Expected**: `@robota-sdk/agent-command` 미설치 상태에서도 커스텀 커맨드 구현 및 등록 가능.

**Evidence**: _(migration 완료 후 채움)_
