---
title: 'ARCH-002-p10: cli.ts 동작 로직을 전용 모듈로 분리'
status: done
created: 2026-05-17
priority: high
urgency: now
area: packages/agent-cli
---

# ARCH-002-p10 — cli.ts 내 동작 로직을 전용 모듈로 분리

## Context

`cli.ts`는 composition root여야 하지만 현재 다음 동작 로직을 직접 포함한다:

- `readVersion()` — package.json에서 버전 읽기
- `resetConfig()` — 유저 설정 삭제
- `buildAppendSystemPrompt()` + `readTaskFilePrompt()` — 시스템 프롬프트 구성
- `buildCommandSetup()` + `ICliSetup` — 명령 모듈/어댑터 조립
- `runPrintMode()` — 헤드리스(인쇄) 모드 실행
- `createTransportRegistry()` — WsTransport 등록

이것들은 각각 독립적인 관심사이므로 별도 파일로 분리해야 한다.

## 수정 방법

### 새로 생성할 파일 (agent-cli 내부)

| 새 파일                                                           | 이동할 내용                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `src/startup/version.ts`                                          | `readVersion()`                                        |
| `src/startup/reset-config.ts`                                     | `resetConfig()`                                        |
| `src/startup/append-system-prompt.ts`                             | `buildAppendSystemPrompt()`, `readTaskFilePrompt()`    |
| `src/startup/command-setup.ts`                                    | `buildCommandSetup()`, `ICliSetup`, `IStartCliOptions` |
| `src/modes/print-mode.ts`                                         | `runPrintMode()`                                       |
| `src/transports/transport-registry.ts` (이미 존재) 또는 내부 확장 | `createTransportRegistry()`                            |

### cli.ts 결과

```typescript
// cli.ts — 순수 composition root, import + 호출만
import { readVersion } from './startup/version.js';
import { resetConfig } from './startup/reset-config.js';
import { buildCommandSetup } from './startup/command-setup.js';
import { runPrintMode } from './modes/print-mode.js';
import { createTransportRegistry } from './transports/...';
import { createDefaultTuiCliAdapter } from '@robota-sdk/agent-transport/tui';

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  // 플래그 처리만, 동작 로직 없음
}
```

## Acceptance Criteria

- `cli.ts`에 함수 정의 없음 — import + 호출만
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- `pnpm --filter @robota-sdk/agent-cli test` 111/111 통과
- 각 새 모듈은 단일 관심사만 담당

## Test Plan

- [x] cli.ts 196줄 (대부분 import/export + startCli 단일 함수)
- [x] typecheck 에러 없음
- [x] test 111/111 통과

## Evidence

- `src/startup/version.ts` — readVersion()
- `src/startup/reset-config.ts` — resetConfig()
- `src/startup/append-system-prompt.ts` — buildAppendSystemPrompt(), readTaskFilePrompt()
- `src/startup/command-setup.ts` — buildCommandSetup(), IStartCliOptions, ICliSetup
- `src/modes/print-mode.ts` — runPrintMode()
- `src/transports/transport-registry.ts` — createDefaultTransportRegistry() 추가
- `cli.ts` 함수 정의 없음 — 순수 import + startCli() 단일 함수
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- `pnpm --filter @robota-sdk/agent-cli test` 111/111 통과
