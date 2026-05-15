---
title: 'REFACTOR-003: agent-sdk concrete I/O adapter 분리 (execSync/child_process)'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-sdk, packages/agent-cli
---

## Problem

Assembly 레이어인 `agent-sdk`가 세 파일에서 `child_process.execSync`를 직접 사용한다:

- `packages/agent-sdk/src/plugins/marketplace-client.ts:9` — git clone/pull 명령 실행
- `packages/agent-sdk/src/plugins/bundle-plugin-installer.ts:8` — npm install/uninstall 실행
- `packages/agent-sdk/src/utils/skill-prompt.ts:1` — `` !`cmd` `` 패턴 shell 실행

`ExecFn` 주입 패턴이 `MarketplaceClient`에 일부 적용되어 있으나(`options.exec ?? this.defaultExec`) 기본 구현이 여전히 SDK 내부에 있다.

Rule violation: Orchestrator/adapter split — Concrete I/O는 injected adapters 또는 shell packages에만. Side concerns are injectable.

Source: COMBINED-003 (SA-003)

## Scope

1. `ExecFn` 타입을 port interface로 확정하고 이름을 `TExecFn`으로 rename.
2. `MarketplaceClient`, `BundlePluginInstaller`, `preprocessShellCommands` 모두 `TExecFn`을 constructor/파라미터로 주입받도록 변경. 기본 구현은 제거.
3. `agent-cli` composition root에서 `execSync` 기반 기본 어댑터를 제공해 주입.
4. 또는 별도 `agent-plugin-installer-adapter` 패키지로 분리(선택).
5. agent-sdk의 `execSync` import 라인을 모두 제거.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `pnpm --filter @robota-sdk/agent-cli test` — 통과
- `grep -r "execSync" packages/agent-sdk/src --include="*.ts"` — 결과 없음
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

### 시나리오: 플러그인 설치 커맨드 동작 확인

**전제조건**: Robota CLI가 빌드되어 있고 로컬에서 실행 가능.

**단계**:

1. `robota` 실행 후 TUI 진입
2. `/plugin install <marketplace-package>` 커맨드 실행
3. 설치 성공 메시지 및 플러그인 활성화 확인

**기대 결과**: 기존과 동일하게 플러그인 설치가 정상 완료됨. 어댑터 분리 후에도 동작 변화 없음.

**Evidence**: `[실행 후 기록]`
