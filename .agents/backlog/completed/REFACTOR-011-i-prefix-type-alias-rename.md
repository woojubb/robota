---
title: 'REFACTOR-011: I-prefix type alias → T-prefix 일괄 rename (8개)'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk, packages/agent-runtime, packages/agent-core, packages/agent-cli, packages/agent-transport-http
---

## Problem

아래 8개 `type` alias가 `I*` prefix를 사용한다. 규칙상 `I*`는 `interface` 전용, `T*`는 type alias 전용.

| 현재 이름                    | 위치                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `IMarketplaceSource`         | `agent-sdk/src/plugins/marketplace-types.ts:6`              |
| `IKnownMarketplacesRegistry` | `agent-sdk/src/plugins/marketplace-types.ts:36`             |
| `IInstalledPluginsRegistry`  | `agent-sdk/src/plugins/bundle-plugin-installer.ts:24`       |
| `IInteractiveSessionOptions` | `agent-sdk/src/interactive/interactive-session-init.ts:116` |
| `IBackgroundTaskRequest`     | `agent-runtime/src/background-tasks/types.ts:116`           |
| `IHookDefinition`            | `agent-core/src/hooks/types.ts:61`                          |
| `IStatusLineSettings`        | `agent-cli/src/utils/statusline-settings.ts:10`             |
| `ISessionFactory`            | `agent-transport-http/src/routes.ts:14`                     |

Rule violation: I* prefix = interface only, T* prefix = type alias only.

Source: COMBINED-011 (SD-007)

## Scope

1. 각 파일에서 `type I*` → `type T*` rename (search-and-replace pass).
2. 모든 import 참조 업데이트 (패키지 내부 + 소비 패키지).
3. 공개 API export 변경이므로 동일 PR에서 소비자 마이그레이션 완료.

주요 rename:

- `IInteractiveSessionOptions` → `TInteractiveSessionOptions`
- `IBackgroundTaskRequest` → `TBackgroundTaskRequest`
- `IHookDefinition` → `THookDefinition`
- `ISessionFactory` → `TSessionFactory`
- `IMarketplaceSource` → `TMarketplaceSource` (REFACTOR-010과 함께 처리)

## Test Plan

- `pnpm typecheck` — 전체 통과
- `grep -rn "type I[A-Z]" packages --include="*.ts" | grep -v "interface I"` — 결과 없음 (진단용)
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 내부 타입 명명 정리이며 사용자 관찰 가능한 동작 변화 없음.
