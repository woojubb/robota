---
title: 'UX-002: macOS Terminal.app CJK 크래시 런타임 경고 추가'
status: todo
created: 2026-05-10
priority: medium
urgency: soon
area: ux
source: pm-prelaunch-report-2026-05-10
---

## Problem

macOS Terminal.app에서 CJK(한국어/중국어/일본어) 입력 시 SIGSEGV 크래시가 발생한다.
현재 이 이슈는 `packages/agent-cli/README.md`에만 언급되어 있고, 런타임에서는 아무런
경고가 없다. macOS Terminal.app 사용자가 한국어/중국어/일본어를 입력하면 예고 없이 크래시한다.

`setCursorPosition()` 미호출이 의도적 설계임에도 사용자는 버그로 인식한다.

## Required Change

### 1. 첫 실행 시 터미널 감지 후 경고 출력

```typescript
// packages/agent-cli/src/bin.ts 또는 cli.ts
const isMacosTerminal = process.env.TERM_PROGRAM === 'Apple_Terminal';

if (isMacosTerminal) {
  console.warn(
    '\n  ⚠️  macOS Terminal.app detected.\n' +
      '  CJK input (Korean/Chinese/Japanese) may cause crashes.\n' +
      '  Recommended: use iTerm2 or another terminal emulator.\n',
  );
}
```

### 2. CjkTextInput.tsx에서 감지 시 입력 모드 안내

언어 설정이 CJK 언어로 바뀔 때(또는 CJK 문자 첫 입력 시) Terminal.app 환경이면 경고 배너
표시 고려.

## Scope

- `packages/agent-cli/src/bin.ts` — 시작 시 Terminal.app 감지 및 경고
- `packages/agent-cli/src/ui/CjkTextInput.tsx` — 선택적으로 TUI 내 경고 표시

## Test Plan

- `TERM_PROGRAM=Apple_Terminal robota` 실행 시 경고 출력 확인
- 다른 터미널(`TERM_PROGRAM=iTerm.app`)에서는 경고 없음 확인

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-cli), macOS 환경

**Scenario — Terminal.app 감지 경고 확인:**

```bash
TERM_PROGRAM=Apple_Terminal robota --version
```

**Expected observable result:**

```
  ⚠️  macOS Terminal.app detected.
  CJK input (Korean/Chinese/Japanese) may cause crashes.
  Recommended: use iTerm2 or another terminal emulator.

robota/3.0.0-beta.61
```

**Scenario — 다른 터미널에서 경고 없음 확인:**

```bash
TERM_PROGRAM=iTerm.app robota --version
```

**Expected observable result:** 경고 없이 버전 정보만 출력

**Cleanup:** 없음

**Evidence:** (구현 후 채울 것)
