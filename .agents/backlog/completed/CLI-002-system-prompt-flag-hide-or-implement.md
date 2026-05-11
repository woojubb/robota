---
title: 'CLI-002: --system-prompt 플래그 미연결 처리 (숨기기 또는 구현)'
status: done
created: 2026-05-10
priority: low
urgency: later
area: cli
source: qa-prelaunch-report-2026-05-10
---

## Problem

`packages/agent-cli/src/cli.ts:340`에 다음 TODO가 있다:

```typescript
// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
```

`--system-prompt` CLI 인수가 파싱되어 있으나 `InteractiveSession` 생성자에 전달되지 않는다.
사용자가 `robota --system-prompt "You are..."` 를 실행해도 아무런 효과가 없다.
`--help` 출력에 이 플래그가 표시된다면 사용자 혼란을 유발한다.

## Required Change

### 옵션 A — 기능 구현 전까지 플래그를 help에서 숨기기 (단기)

`--system-prompt` 옵션을 CLI 파서에서 hidden으로 표시하거나 제거.

```typescript
// 사용자에게 표시하지 않음
// commander.js 예시:
program.option('--system-prompt <prompt>', '...').hideHelp();
```

### 옵션 B — `IInteractiveSessionStandardOptions`에 `systemPrompt` 필드 추가 및 연결 (정식 구현)

SDK `IInteractiveSessionStandardOptions` 타입에 `systemPrompt?: string` 추가 후
`InteractiveSession` 생성자에 전달. 이 경우 agent-sdk SPEC.md도 업데이트 필요.

**설계 결정이 필요하므로 구현 전 사용자 컨펌 필요.**

## Scope

옵션 A:

- `packages/agent-cli/src/cli.ts` — `--system-prompt` 옵션 숨김 처리

옵션 B:

- `packages/agent-sdk/src/` — `IInteractiveSessionStandardOptions`에 `systemPrompt` 추가
- `packages/agent-cli/src/cli.ts` — `InteractiveSession` 생성 시 `systemPrompt` 전달
- `packages/agent-sdk/docs/SPEC.md` — 업데이트

## Test Plan

- `robota --help` 출력에 `--system-prompt`가 표시되지 않거나 동작한다고 명시
- 옵션 B 구현 시: `--system-prompt "..."` 전달 후 AI 응답이 해당 시스템 프롬프트를 따르는지 확인

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-cli)

**Scenario — --help 출력 확인 (옵션 A):**

```bash
robota --help
```

**Expected observable result:**
`--system-prompt` 옵션이 help 출력에 없거나, 있더라도 "(미지원)" 등 명확한 표시가 있음.

**Scenario — 시스템 프롬프트 적용 확인 (옵션 B):**

```bash
robota --system-prompt "Always respond in uppercase"
# 프롬프트 입력: hello
```

**Expected observable result:** AI가 대문자로 응답함.

**Cleanup:** 세션 종료 (`/exit`)

**Evidence:** PR #356 (fix/agent-cli-prelaunch) — `packages/agent-cli/src/cli.ts`에 `--system-prompt` 미구현 경고 추가. 플래그 사용 시 "(미지원)" 경고 메시지 출력하여 사용자 혼란 방지.
