---
title: 'CLI-036: Bash 타임아웃 캡 실제 적용'
status: todo
created: 2026-05-24
priority: medium
category: security
---

## 문제

`packages/agent-tools/src/builtins/bash-tool.ts` L26에 스키마 설명으로 "max 600000"이 있지만,
`runBash` 함수에서 `Math.min(timeout, 600_000)` 클램핑이 없다.
LLM 또는 악의적 입력이 `timeout: 999999999`를 전달하면 그대로 통과된다.

## 해결 방법

```typescript
// bash-tool.ts의 runBash 함수에서
const effectiveTimeout = Math.min(timeout ?? DEFAULT_TIMEOUT, 600_000);
```

## 수용 기준

- [ ] `timeout > 600_000` 입력 시 실제로 600초에서 타임아웃된다
- [ ] 단위 테스트로 검증한다

## 관련 파일

- `packages/agent-tools/src/builtins/bash-tool.ts`
