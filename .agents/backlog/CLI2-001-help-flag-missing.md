---
title: 'CLI2-001: --help 플래그 미구현 — 첫 탐색 경험 차단'
status: todo
created: 2026-05-10
priority: critical
urgency: now
area: cli
source: pm-prelaunch-report-2026-05-10-v2
---

## Problem

`robota --help`를 실행하면 CLI 사용법 안내 대신 Node.js `parseArgs()`의 기본 오류 메시지가 노출된다.

```
Unknown option '--help'. To specify a positional argument starting with a '-',
place it at the end of the command after '--', as in '-- "--help"'
```

개발자가 CLI를 설치한 후 가장 먼저 시도하는 `robota --help`가 동작하지 않아 첫 탐색 경험이 차단된다. Claude Code(`claude --help`)는 전체 플래그 목록과 예시를 출력한다.

## Required Change

`packages/agent-cli/src/cli-args.ts`에 `--help` / `-h` 옵션을 추가하고, 전체 플래그 목록과 사용 예시를 출력하는 `printHelp()` 함수를 구현한다. `--version`처럼 출력 후 즉시 `process.exit(0)`로 종료한다.

```typescript
// cli-args.ts에 추가
if (args.help) {
  printHelp();
  process.exit(0);
}

function printHelp(): void {
  process.stdout.write(`
Usage: robota [options] [-p <prompt>]

Options:
  -p, --print <prompt>       Run in headless/print mode with the given prompt
  --output-format <format>   Output format: text | json | stream-json (default: text)
  --system-prompt <text>     System prompt override (not yet implemented)
  --language <lang>          Language preference (e.g. ko, en)
  --no-session-persistence   Disable session persistence for this run
  --model <model>            Override model for this session
  --permission-mode <mode>   Permission mode: default | acceptEdits | bypassPermissions
  -h, --help                 Show this help message
  --version                  Show version number

Examples:
  robota                     Start interactive TUI session
  robota -p "Hello"          Print mode: send prompt and exit
  robota -p "Hello" --output-format json
`);
}
```

## Scope

- `packages/agent-cli/src/cli-args.ts` — `--help`/`-h` 옵션 추가 및 `printHelp()` 구현
- `packages/agent-cli/src/cli.ts` — help 처리 분기 추가

## Test Plan

1. `pnpm --filter @robota-sdk/agent-cli build` 후 `node dist/cli.js --help` 실행 — 플래그 목록 출력 및 exit 0 확인
2. `node dist/cli.js -h` 실행 — 동일 출력 확인
3. `node dist/cli.js --help --print "test"` 실행 — help 우선 처리 확인
4. 기존 `-p` / `--version` 동작 회귀 없음 확인

## User Execution Test Scenarios

### 시나리오 1: --help 플래그 출력 확인

**전제조건**: `robota` 바이너리가 설치되어 있거나 `pnpm build` 후 `bin/robota.cjs` 접근 가능

**실행 단계**:

```bash
robota --help
```

**기대 결과**: 플래그 목록(최소 `-p`, `--output-format`, `--help`, `--version` 포함)과 사용 예시가 출력되고 exit code 0으로 종료된다.

**증거 필드** (구현 후 기입):

- 명령 출력: \_
- exit code: \_

### 시나리오 2: -h 단축 플래그 동작 확인

**실행 단계**:

```bash
robota -h
```

**기대 결과**: `--help`와 동일한 출력.

**증거 필드** (구현 후 기입):

- 명령 출력: \_
