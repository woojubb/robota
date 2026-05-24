---
title: 'CLI-043: glob-tool mtime 조회 I/O 폭발 완화'
status: todo
created: 2026-05-24
priority: low
category: performance
---

## 문제

`packages/agent-tools/src/builtins/glob-tool.ts`:

```typescript
const withMtime = await Promise.all(
  matches.map(async (p) => {
    const s = await stat(absPath);
    // ...
  }),
);
```

`Promise.all`로 병렬 처리하지만 1000개 파일에 1000개의 `stat` 시스템 콜을 동시에 발생시킨다.
파일 수가 많은 프로젝트에서 I/O 폭발을 일으킬 수 있다.

## 해결 방법

`p-limit`로 동시 stat 수를 제한:

```typescript
import pLimit from 'p-limit';
const limit = pLimit(100);
const withMtime = await Promise.all(
  matches.map((p) =>
    limit(async () => {
      const s = await stat(resolve(cwd, p));
      return { path: p, mtime: s.mtimeMs };
    }),
  ),
);
```

또는 mtime 정렬이 필요한 경우에만 stat를 수행하는 lazy 평가.

## 수용 기준

- [ ] 동시 stat 수가 100개 이하로 제한됨
- [ ] 기존 glob 테스트 통과

## 관련 파일

- `packages/agent-tools/src/builtins/glob-tool.ts`
