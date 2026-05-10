---
title: 'ARCH-FIX-012: SPEC.md에서 금지된 sub-agent 명칭 제거'
status: done
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-SYS-001, V-SYS-002]
---

## Problem

`naming-style.md`에서 `sub-agent`, `main agent`, `parent-agent`, `child-agent` 등의 계층적 에이전트 명칭을 금지한다. 그러나 이 명칭이 다음 위치에서 발견됐다:

- `agent-core/docs/SPEC.md` 2곳
- `agent-sdk/docs/SPEC.md` 1곳

금지된 명칭이 패키지 공식 계약 문서에 포함되면 새로운 기여자와 에이전트가 이 패턴을 정상으로 인식해 전파된다.

## Solution

1. `agent-core/docs/SPEC.md`와 `agent-sdk/docs/SPEC.md`에서 `sub-agent` 사용처를 모두 찾는다.
2. 각 사용처의 의미를 파악하고 적절한 대체 표현으로 교체한다 (예: "nested execution", "delegated agent run", "agent invocation").
3. 변경 후 문맥이 자연스럽게 읽히는지 확인한다.

```bash
rg 'sub-agent|main agent|parent-agent|child-agent' packages/agent-core/docs packages/agent-sdk/docs
```

## Test Plan

- `rg 'sub-agent|main agent|parent-agent|child-agent' packages/agent-core packages/agent-sdk` 결과 0건
- 변경 후 문서 구조 유지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 grep 결과 0건 스크린샷 또는 출력 기록)
