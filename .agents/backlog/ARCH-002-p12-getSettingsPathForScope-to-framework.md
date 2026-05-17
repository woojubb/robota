---
title: 'ARCH-002-p12: getSettingsPathForScope → agent-framework'
status: done
created: 2026-05-17
priority: high
urgency: now
area: packages/agent-cli, packages/agent-framework
---

# ARCH-002-p12 — getSettingsPathForScope를 agent-framework로 이동

## Context

CLI-AUDIT-012. `getSettingsPathForScope(cwd, scope: string | undefined)` is pure path
resolution logic with no CLI-specific types. Equivalent functions already live in
agent-framework (`getUserSettingsPath`, `resolveProviderSettingsWriteTargetPath`).

## 위반 코드

```typescript
// packages/agent-cli/src/utils/provider-setup.ts
export function getSettingsPathForScope(cwd: string, scope: string | undefined): string {
  if (scope === undefined || scope === 'user') {
    return getUserSettingsPath();
  }
  if (scope === 'project-local') {
    return join(cwd, '.robota', 'settings.local.json');
  }
  throw new Error(`Invalid --settings-scope "${scope}". Valid: user | project-local`);
}
```

## 수정 방법

agent-framework에 `resolveSettingsPathForScope(cwd, scope: 'user' | 'project-local' | undefined)` 추가.
CLI에서 scope 값 검증(invalid 값 에러) 후 framework 함수 호출.

## Acceptance Criteria

- `resolveSettingsPathForScope` export된 agent-framework 빌드 통과
- `getSettingsPathForScope` agent-cli에서 삭제
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
