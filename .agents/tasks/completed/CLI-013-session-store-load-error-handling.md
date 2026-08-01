---
title: 'CLI-013: SessionStore.load() JSON 파싱 예외 처리 누락 수정'
status: done
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-session
depends_on: []
---

## Background

`SessionStore.load()` (`packages/agent-session/src/session-store.ts:119`)에서 `JSON.parse(raw) as ISessionRecord`를 예외 처리 없이 호출한다. `list()` 메서드에는 `catch {}` 처리가 있지만 `load()`에는 없다.

corrupt 세션 파일(디스크 쓰기 중단, 수동 편집 오류 등)이 존재하는 경우 `--continue`나 `--resume` 실행 시 uncaught exception으로 즉시 crash가 발생한다.

## 작업 항목

- `packages/agent-session/src/session-store.ts` `load()` 메서드에 try/catch 추가
  - corrupt 파일은 `undefined` 반환 (파일 없음과 동일하게 처리)
  - corrupt 파일 존재 사실을 `console.error` 또는 caller 콜백으로 알림
- `list()` 메서드도 동일한 방어 패턴인지 재확인
- `ISessionRecord`의 `as T` 직접 캐스팅을 Zod 스키마 검증으로 교체 고려 (같은 작업 범위 내에서)

```ts
// 수정 방향
load(id: string): ISessionRecord | undefined {
  const path = this.filePath(id);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ISessionRecord;
  } catch {
    return undefined;
  }
}
```

## Test Plan

- corrupt JSON 세션 파일로 `--continue` 실행 시 crash 없이 새 세션 시작 확인
- 정상 세션 파일 복원은 기존 동작 유지 확인
- `list()` 호출 시 corrupt 파일 포함 디렉토리에서 정상 파일만 반환 확인

## User Execution Test Scenarios

### Scenario 1: corrupt 세션 파일 복원 방어

```bash
# 세션 ID 확인
robota --list-sessions

# 세션 파일 의도적으로 corrupt 처리
echo "INVALID_JSON{{{" > ~/.robota/sessions/<session-id>.json

# --continue 실행 — crash 없이 새 세션으로 시작해야 함
robota --continue
```

Expected: uncaught exception 없이 정상 실행, 경고 메시지 출력 후 새 세션 시작
