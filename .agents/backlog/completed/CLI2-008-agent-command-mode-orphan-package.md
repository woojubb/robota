---
title: 'CLI2-008: agent-command-mode 패키지가 CLI에 등록되지 않은 orphan 상태'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: cli
source: pm-prelaunch-report-2026-05-10-v2 (PM-I-002)
---

## Problem

`@robota-sdk/agent-command-mode` 패키지가 구현되어 있으나 `createDefaultCliCommandModules()`에
등록되지 않아 `/mode` 커맨드를 사용자가 접근할 수 없다.

`packages/agent-cli/src/cli.ts`의 `createDefaultCliCommandModules()`에
`createPermissionsCommandModule`은 포함되어 있으나 `createModeCommandModule`은 없다.

해당 패키지는 v3.0.0-beta.61로 배포되어 있으나 CLI에서 접근 불가 — 실질적으로 orphan 상태.

## Required Change

다음 중 하나를 선택하여 처리:

**Option A (등록):** 실제로 필요한 기능이라면 `createDefaultCliCommandModules()`에 추가.

**Option B (제거):** 사용하지 않는 패키지라면:

- `packages/agent-command-mode/` 디렉토리 삭제
- `pnpm-workspace.yaml` 및 관련 패키지의 `package.json` 의존성 제거
- npm에서 deprecated 처리 또는 unpublish (배포된 버전이 있는 경우)

선택 전 `/permissions` 커맨드(`createPermissionsCommandModule`)와 기능 중복 여부 확인 필요.

## Scope

- `packages/agent-cli/src/cli.ts` — Option A 선택 시 등록 추가
- `packages/agent-command-mode/` — Option B 선택 시 전체 삭제
- 관련 `package.json` 의존성 정리

## Test Plan

- Option A: `/mode` 커맨드가 TUI에서 동작하는지 확인
- Option B: 빌드 및 typecheck 통과 확인, `pnpm harness:verify` 통과 확인

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-cli), Node.js 22+

**Scenario — Option A (등록 후):**

```bash
robota
# TUI 진입 후
/mode
```

**Expected observable result:** `/mode` 커맨드 응답 (도움말 또는 기능 실행)

**Scenario — Option B (제거 후):**

```bash
pnpm typecheck && pnpm build
```

**Expected observable result:** 빌드 오류 없음

**Cleanup:** 없음

**Evidence:** (구현 후 기록)
