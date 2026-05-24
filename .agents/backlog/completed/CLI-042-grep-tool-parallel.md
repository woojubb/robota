---
title: 'CLI-042: grep-tool 파일 읽기 병렬화'
status: todo
created: 2026-05-24
priority: low
category: performance
---

## 문제

`packages/agent-tools/src/builtins/grep-tool.ts`:

```typescript
for (const filePath of files) {
  const buffer = await readFile(filePath);
  // ...
}
```

파일을 하나씩 순차적으로 읽는다. 수천 개 파일이 있는 대규모 코드베이스에서 성능 병목이 된다.

## 해결 방법

`p-limit`를 사용해 동시 실행 수를 제한하면서 병렬 처리:

```typescript
import pLimit from 'p-limit';
const limit = pLimit(50); // 동시 50개 파일
const results = await Promise.all(files.map((filePath) => limit(() => processFile(filePath))));
```

## 수용 기준

- [ ] 대규모 코드베이스(1000개+ 파일)에서 성능 향상 확인
- [ ] 기존 grep 테스트 통과
- [ ] 메모리 사용량이 비례 증가하지 않음

## 관련 파일

- `packages/agent-tools/src/builtins/grep-tool.ts`
