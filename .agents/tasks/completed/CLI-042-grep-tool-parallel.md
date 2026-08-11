---
title: 'CLI-042: grep-tool 파일 읽기 병렬화'
status: done
created: 2026-05-24
priority: low
category: performance
---

## Outcome (2026-07-25)

Implemented for real this time — evidence is concrete, not a checkbox:

- **Code**: `packages/agent-tools/src/builtins/grep-tool.ts` now maps `files` through
  `pLimit(50)` (`READ_CONCURRENCY_LIMIT = 50`, per this item's spec; glob-tool precedent uses the
  same `p-limit` util) and flattens per-file result arrays in file-enumeration order — the
  sequential `for (const filePath of files) { await readFile(...) }` loop is gone
  (`git grep "for (const filePath of files)" packages/agent-tools/src/builtins/grep-tool.ts`
  returns nothing).
- **수용 기준 1 — 성능 (1000+ 파일)**: 1,201-file generated corpus (8 dirs x 150 files + 1 binary),
  8-case scan suite, warm cache: pre (sequential) 603.7/610.5/631.2 ms → post (parallel)
  369.2/383.2/384.9 ms (~1.6x; gains grow on higher-latency filesystems).
- **수용 기준 2 — 기존 테스트 통과 + output parity**: all 202 agent-tools tests green; golden
  byte-parity — same corpus, pre-change vs post-change output sha256 both
  `9be9c4505d1f3f404758d0bf58657f86696fd26b04c4fb083acad6bfd9365499` (4,060,077 bytes, `cmp` clean)
  across files_with_matches/content(+context)/count/headLimit/glob/binary-skip/no-match cases.
- **수용 기준 3 — 메모리 비례 증가 없음**: in-flight reads are capped at 50 (not corpus-size);
  proven by the instrumented-fs test below, `maxInFlight <= 50` on a 120-file corpus.
- **Tests (red-first)**: `src/__tests__/grep-tool-concurrency.test.ts` TC-05 instruments
  `node:fs/promises.readFile` (in-flight counter + 5 ms hold) — FAILED pre-change with
  `maxInFlight = 1` (sequential), passes post-change (`>= 2`, `<= 50`).
  `src/__tests__/grep-tool.test.ts` TC-06 adds determinism (double-run byte-identity, 3 modes,
  80-file corpus) + enumeration-order parity (directory output == concatenation of per-file
  outputs in files_with_matches order) — green pre-change (captured the sequential contract)
  and green post-change.
- **Verification**: agent-tools build green; 202/202 package tests; consumer smoke
  `pnpm --filter @robota-sdk/agent-framework test` 1256/1256 (includes its own grep-tool.test.ts);
  `pnpm -w typecheck` green; `node scripts/harness/run-all-scans.mjs` all 60 scans passed.

## Progress (PROC-001 reconciliation, 2026-07-25)

Reopened: **not implemented.** PR #589's task file checked "p-limit(50) verified", but that PR
never touched `grep-tool.ts`, and the file still reads sequentially today
(`packages/agent-tools/src/builtins/grep-tool.ts` L210-213: `for (const filePath of files) {
await readFile(...) }`, no p-limit import). Remaining: the entire item as specified below.

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
