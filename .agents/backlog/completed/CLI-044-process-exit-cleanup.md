---
title: 'CLI-044: cli.ts TUI 종료 후 process.exit 비동기 리소스 정리'
status: todo
created: 2026-05-24
priority: low
category: bug
---

## 문제

`packages/agent-cli/src/cli.ts` L119:

```typescript
await runTuiMode({ ... });
process.exit(0);
```

TUI 종료 후 명시적 `process.exit(0)` 호출은 이벤트 루프를 즉시 강제 종료한다.
비동기 리소스(파일 I/O, 네트워크 소켓, 로그 플러시)가 정리되지 않을 수 있다.

## 해결 방법

`process.exit(0)` 대신 `return`으로 함수를 종료하거나,
세션 shutdown이 완전히 완료된 후에 종료:

```typescript
await runTuiMode({ ... });
// process.exit 제거 — Node.js가 이벤트 루프 비워지면 자연 종료
```

또는 종료 이유가 있다면 명시적 리소스 정리 후:

```typescript
await runtime.shutdown();
// 이제 process.exit 호출
```

## 수용 기준

- [ ] TUI 종료 후 로그/파일 I/O가 플러시됨
- [ ] 기존 동작(세션 종료 후 프로세스 종료)은 유지됨

## 관련 파일

- `packages/agent-cli/src/cli.ts`
