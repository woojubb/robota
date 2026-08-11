---
title: 'ARCH-002-p11: agent-cli plugin catch blocks에 allow-fallback 추가'
status: done
created: 2026-05-17
priority: high
urgency: now
area: packages/agent-cli
---

# ARCH-002-p11 — plugin catch 블록 미처리 수정

## Context

CLI-AUDIT-015 에서 발견. `plugin-command-source-loader.ts:26`과
`plugin-command-adapter.ts:84`에 `} catch {` 블록이 `// allow-fallback:` 주석 없이
존재한다. check-forbidden-patterns 훅이 미래 편집 시 해당 블록을 포함하는 수정을 차단한다.

## 위반 코드

```typescript
// plugin-command-source-loader.ts
} catch {
  registry.replaceSource(PLUGIN_SOURCE_NAME);
  return 0;
}

// plugin-command-adapter.ts
} catch {
  return [];
}
```

## 수정 방법

각 catch 블록에 `// allow-fallback: <reason>` 주석 추가:

- loader: `// allow-fallback: plugin load failure is non-fatal — return empty source`
- adapter: `// allow-fallback: marketplace manifest fetch failure is non-fatal — return empty list`

## Acceptance Criteria

- grep으로 두 파일의 `} catch` 라인에 `allow-fallback:` 확인
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
