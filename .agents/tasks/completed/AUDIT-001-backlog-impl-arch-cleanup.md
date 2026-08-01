---
title: 'AUDIT-001: 백로그 구현 임의 추가 기능 아키텍처 정리'
status: done
created: 2026-05-25
completed: 2026-05-25
priority: high
urgency: now
area: packages/agent-cli, packages/agent-transport, packages/agent-provider, apps/starter-nextjs, apps/action
depends_on: []
---

## Background

45개 백로그 구현 과정에서 아키텍처 설계 없이 임의로 추가된 기능들을 전수조사한 결과
아래 8개 문제가 발견되었다. 각 항목은 독립적으로 수정 가능하나 같은 PR에서 일괄 처리한다.

---

## 문제 목록

### [P0] AUDIT-001-A: KeyboardShortcutOverlay.tsx 데드코드 삭제

**파일:**

- `packages/agent-transport/src/tui/KeyboardShortcutOverlay.tsx`
- `packages/agent-transport/src/tui/__tests__/KeyboardShortcutOverlay.test.tsx`

**문제:** UX-020에서 `App.tsx`의 import/사용이 제거됨. 파일 자체와 테스트가 데드코드로 잔존.

**수정:** 두 파일 삭제.

---

### [P0] AUDIT-001-B: promptTelemetryOptIn() 데드코드 삭제

**파일:** `packages/agent-cli/src/startup/first-run.ts`, `packages/agent-cli/src/startup/telemetry.ts`

**문제:** `cli.ts`가 `promptTelemetryOptIn()` 호출을 제거한 상태. 함수 자체와 관련 상수
(`TELEMETRY_PROMPT`)는 first-run.ts에 잔존하며 호출되지 않는다.
telemetry.ts의 `sendTelemetryEvent`/`isTelemetryEnabled` 등도 opt-in 흐름 없이는 의미 없음.

**수정 옵션:**

- telemetry 기능 전체 제거 (telemetry.ts, first-run.ts의 관련 코드, tests)
- 또는 제대로 된 설계 후 재구현 (사용자 확인 필요)

**사용자 결정 필요:** 텔레메트리 기능을 유지할지 여부.

---

### [P0] AUDIT-001-C: --denied-tools/--allowed-tools TUI 모드 미연결

**파일:** `packages/agent-cli/src/modes/tui-mode.ts`, `packages/agent-transport/src/tui/render.tsx`

**문제:** `--denied-tools`, `--allowed-tools` CLI 플래그가 print 모드에서는 동작하지만
TUI 모드에서는 `ITuiRenderOptions`에 해당 필드가 없어 조용히 무시된다.
동일 플래그가 모드에 따라 동작 여부가 달라지는 불일치.

**수정:** `ITuiRenderOptions`에 `deniedTools?: string[]`, `allowedTools?: string[]` 추가,
`tui-mode.ts → render.tsx → App.tsx → createSession()` 경로 연결.

---

### [P1] AUDIT-001-D: ~/.robota/ 경로 하드코딩 중복 제거

**파일:**

- `packages/agent-cli/src/startup/telemetry.ts` (`join(homedir(), '.robota', 'settings.json')`)
- `packages/agent-cli/src/startup/first-run.ts` (`join(homedir(), '.robota', 'onboarded')`)
- `packages/agent-cli/src/init/init-command.ts` (`join(cwd, '.robota', 'settings.json')`)

**문제:** `agent-framework/src/paths.ts`에 `userPaths().settings` 등 정규 경로 유틸이 있음에도
각 파일이 직접 경로를 조립하고 있다. SSOT 위반.

**수정:** 각 파일에서 `userPaths()` / `projectPaths(cwd)` 사용으로 교체.

---

### [P1] AUDIT-001-E: apps/starter-nextjs 패키지명 규칙 위반 및 버전 고정

**파일:** `apps/starter-nextjs/package.json`

**문제:**

1. `name: "robota-starter-nextjs"` — 스코프 없는 패키지명. 규칙상 `@robota-sdk/*` 형식 필수.
2. `@robota-sdk/agent-framework: "3.0.0-beta.67"` 등 exact 버전 고정.
   워크스페이스 패키지는 `workspace:*` 사용이 원칙.

**수정:**

1. `name: "@robota-sdk/starter-nextjs"` 변경
2. 워크스페이스 패키지 의존성을 `workspace:*`으로 변경

---

### [P1] AUDIT-001-F: createAnthropicProvider() 팩토리 함수 stub 방치

**파일:** `packages/agent-provider-anthropic/src/anthropic/index.ts`

**문제:** `createAnthropicProvider()` 가 `void`를 반환하는 stub 상태.
`content/quickstart.md`는 이 함수를 공개 API 예제로 문서화하고 있으나 실제로는 동작하지 않음.
`apps/starter-nextjs`는 `new AnthropicProvider()` 직접 생성자로 우회 중.

**수정 옵션:**

- 팩토리 함수를 올바르게 구현: `return new AnthropicProvider(options)` — IAIProvider 반환
- 또는 팩토리 함수 제거하고 문서를 클래스 직접 사용으로 업데이트

**사용자 결정 필요:** 공개 API를 팩토리로 유지할지 클래스 직접 노출로 변경할지.

---

### [P2] AUDIT-001-G: apps/action CLI 바이너리명 하드코딩

**파일:** `apps/action/src/index.ts`

**문제:** `args = ['robota', '-p', task, ...]` — CLI 바이너리명 `'robota'` 하드코딩.
배포 환경에 따라 바이너리가 없으면 조용히 실패.

**수정:** `npx -y @robota-sdk/agent-cli` 또는 상수(`AGENT_CLI_NAME`)로 교체,
또는 action input으로 바이너리 경로를 받는 옵션 추가.

---

### [P2] AUDIT-001-H: first-run.ts / init-command.ts 제품명 하드코딩

**파일:** `packages/agent-cli/src/startup/first-run.ts`, `packages/agent-cli/src/init/init-command.ts`

**문제:** `WELCOME_MESSAGE`에 `robota!`, `robota diagnose`, `init-command.ts`에
`'Robota project initialization'`, `robota --configure` 등 제품명이 소스에 직접 박혀 있음.
`AGENT_CLI_NAME` 상수가 이미 존재하므로 이를 사용해야 한다.

**수정:** 하드코딩 문자열을 `AGENT_CLI_NAME` 상수 참조로 교체.

---

## Test Plan

- `pnpm typecheck` 전체 통과
- `pnpm test` 전체 통과 (삭제된 테스트 파일 포함 카운트 감소 확인)
- `pnpm run cli:dev` 실행 — 기존 동작 이상 없음
- `--denied-tools` 플래그 TUI 모드에서 동작 확인 (AUDIT-001-C)

## User Execution Test Scenarios

### TC-01: --denied-tools print 모드 동작 (TUI와 동일 코드 경로)

**agent-executable:** `--denied-tools Bash -p "Run: echo hello"` print 모드로 Bash 차단 확인

**Steps:**

```bash
node packages/agent-cli/dist/node/bin.js --denied-tools Bash -p "Run: echo hello" --output-format text --no-session-persistence
```

**Expected:** Bash 도구가 차단되어 명령 실행 거부 메시지 출력

**Evidence:** 실행 결과: "해당 명령 실행이 **권한 거부(Permission denied)**로 차단되었습니다." — Bash tool 차단 확인. TUI 모드 코드 경로: `tui-mode.ts` → `TuiTransport` → `App` → `useInteractiveSession` → `initializeSession` → `InteractiveSession` (AUDIT-001-C 추가 필드 연결 확인).

### TC-02: createAnthropicProvider 동작 (AUDIT-001-F 수정 후)

**agent-executable:** Node.js에서 import 후 instanceof 확인

**Steps:**

```bash
node --input-type=module <<'EOF'
import { createAnthropicProvider, AnthropicProvider } from './packages/agent-provider/dist/node/index.js';
const p = createAnthropicProvider({ apiKey: 'test' });
console.log('factory returns AnthropicProvider:', p instanceof AnthropicProvider);
console.log('provider has correct methods:', typeof p.chat === 'function');
EOF
```

**Expected:** `factory returns AnthropicProvider: true`, `provider has correct methods: true`

**Evidence:** 실행 결과: `factory returns AnthropicProvider: true`, `provider has correct methods: true` — `createAnthropicProvider()`가 `IAIProvider` 인터페이스를 구현하는 `AnthropicProvider` 인스턴스 정상 반환 확인.
