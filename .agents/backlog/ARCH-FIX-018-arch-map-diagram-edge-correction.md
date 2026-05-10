---
title: 'ARCH-FIX-018: 아키텍처 맵 다이어그램 과잉 엣지 수정'
status: done
created: 2026-05-10
priority: low
urgency: backlog
area: documentation
related: [V-SYS-003, V-SYS-004]
---

## Problem

`agent-system.md` Product Stack 다이어그램에 실제 의존 관계와 불일치하는 엣지가 있다:

**V-SYS-003**: `AgentCLI --> Plugins` 엣지 — CLI가 `agent-plugin-*` 패키지를 직접 의존하지 않음.  
**V-SYS-004**: `Commands --> Core` 엣지 — 19개 command 패키지 중 `agent-command-provider` 1개만 `agent-core`를 직접 의존하는데 모든 Commands → Core로 과잉 일반화됨.

다이어그램 과잉 일반화는 신규 기여자가 존재하지 않는 의존 경로를 가정하는 혼란을 유발한다.

## Solution

1. `agent-system.md`의 `AgentCLI --> Plugins` 엣지를 실제 관계로 수정한다 (예: `SDK --> Plugins`로 변경, 또는 엣지 제거).
2. `Commands --> Core` 엣지를 `agent-command-provider --> Core`로 세분화하거나, 범례에 "일부 command 패키지만 해당"임을 명시한다.
3. 수정 후 다이어그램이 실제 package.json 의존 관계와 일치하는지 검증한다.

## Test Plan

- 수정된 다이어그램의 각 엣지를 실제 package.json과 수동 대조
- 잘못된 엣지 0건 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 수정된 다이어그램 스니펫 기록)
