---
title: 'CLI-039: init-command.ts Claude Code 설정 파일 JSON 파싱 보호'
status: todo
created: 2026-05-24
priority: medium
category: bug
---

## 문제

`packages/agent-cli/src/init/init-command.ts` L52:

```typescript
const raw = readFileSync(settingsPath, 'utf8');
return JSON.parse(raw) as Record<string, unknown>;
```

`.claude/settings.json`이 손상된 JSON이면 `SyntaxError`가 발생하고 `robota init`이 크래시한다.
Claude Code 마이그레이션 경로에서 사용자 파일을 읽을 때 예외 처리가 없다.

## 해결 방법

```typescript
function readClaudeSettings(settingsPath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null; // 손상된 파일은 마이그레이션 건너뜀
  }
}
```

null 반환 시 사용자에게 "Claude Code settings file could not be parsed — skipping migration" 안내.

## 수용 기준

- [ ] 손상된 `.claude/settings.json`으로 `robota init` 실행 시 크래시 없음
- [ ] 파싱 실패 시 사용자에게 안내 메시지 출력
- [ ] 단위 테스트 추가

## 관련 파일

- `packages/agent-cli/src/init/init-command.ts`
