---
title: 'ARCH-FIX-014: agent-cli SPEC.md에서 경쟁 제품명(Claude Code) 제거'
status: done
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CLI-004]
---

## Problem

`agent-cli/docs/SPEC.md`에 경쟁사 제품명이 직접 기재되어 있다:

- 라인 5: `"corresponding to Claude Code"`
- 스킬 경로 표: `"Claude Code native"`, `"Claude Code compatible"` 레이블

`naming-style.md` 규칙: 코드와 공식 문서에 특정 벤더/제품 이름을 직접 기재하지 않는다. 제네릭한 설명을 사용해야 한다.

## Solution

1. `agent-cli/docs/SPEC.md`에서 `Claude Code` 문자열을 모두 찾는다.
2. 제품 동작을 설명하는 문맥으로 교체한다 (예: "AI coding assistant compatible", "standard hook protocol", "hook-compatible").
3. 기능 설명이 명확하게 전달되는지 검토한다.

```bash
rg 'Claude Code' packages/agent-cli/docs/
```

## Test Plan

- `rg 'Claude Code' packages/agent-cli/docs/` 결과 0건
- SPEC.md 문서 구조 및 의미 유지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 grep 결과 0건 출력 기록)
