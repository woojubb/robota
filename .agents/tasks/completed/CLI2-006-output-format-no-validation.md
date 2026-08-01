---
title: 'CLI2-006: --output-format 인수 유효성 검사 없이 as 캐스팅 — 잘못된 값이 stream-json으로 무음 폴백'
status: done
created: 2026-05-10
priority: critical
urgency: now
area: cli
source: qa-prelaunch-report-2026-05-10-v2 (QA-C-001)
---

## Problem

`packages/agent-cli/src/cli.ts:378`에서 `--output-format` 인수를 유효성 검사 없이 `as` 캐스팅으로 처리한다.

```typescript
outputFormat: (args.outputFormat as 'text' | 'json' | 'stream-json') ?? 'text',
```

사용자가 `--output-format xml` 같은 잘못된 값을 전달해도 오류가 발생하지 않는다.
`packages/agent-transport-headless/src/headless-runner.ts:50-57`에서 알 수 없는 포맷은
경고 없이 `stream-json` 모드로 폴백된다.

```typescript
if (outputFormat === 'text') { return runTextFormat(...); }
if (outputFormat === 'json') { return runJsonFormat(...); }
return runStreamJsonFormat(session, prompt);  // 잘못된 값이면 여기로 폴백
```

결과: `robota -p "hello" --output-format xml` → stream-json 형식으로 출력됨. 사용자 인지 불가.

## Required Change

`packages/agent-cli/src/cli-args.ts`의 `parseCliArgs()`에 `parseOutputFormat()` 함수 추가.
기존 `parsePermissionMode()` 패턴과 동일하게 구현:

```typescript
const VALID_OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
export function parseOutputFormat(
  raw: string | undefined,
): 'text' | 'json' | 'stream-json' | undefined {
  if (raw === undefined) return undefined;
  if (!(VALID_OUTPUT_FORMATS as readonly string[]).includes(raw)) {
    process.stderr.write(`Invalid --output-format "${raw}". Valid: text | json | stream-json\n`);
    process.exit(1);
  }
  return raw as 'text' | 'json' | 'stream-json';
}
```

`cli.ts:378`의 `as` 캐스팅 제거 후 `parseOutputFormat(args.outputFormat)` 호출로 교체.

## Scope

- `packages/agent-cli/src/cli-args.ts` — `parseOutputFormat()` 함수 추가
- `packages/agent-cli/src/cli.ts:378` — `as` 캐스팅 → `parseOutputFormat()` 호출로 교체

## Test Plan

- `parseOutputFormat('xml')` 호출 시 stderr 출력 + exit(1) 확인 (단위 테스트)
- `parseOutputFormat('text' | 'json' | 'stream-json')` 호출 시 정상 반환 확인
- `parsePermissionMode()` 기존 테스트 패턴 참고

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-cli), Node.js 22+

**Scenario — 잘못된 포맷 값으로 실행:**

```bash
robota -p "hello" --output-format xml
```

**Expected observable result:**

```
Invalid --output-format "xml". Valid: text | json | stream-json
```

Exit code: 1

**Scenario — 올바른 포맷 값으로 실행:**

```bash
robota -p "hello" --output-format json
```

**Expected observable result:** JSON 형식으로 응답 출력 (오류 없음)

**Cleanup:** 없음

**Evidence:** (구현 후 기록)
