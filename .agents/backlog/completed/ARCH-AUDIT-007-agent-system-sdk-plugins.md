---
title: 'ARCH-AUDIT-007: agent-system.md SDK assembly 특성 명시 및 plugin 레이어 추가'
status: done
created: 2026-05-09
priority: medium
urgency: soon
area: documentation
---

## Problem

`.agents/specs/architecture-map/agent-system.md`에 두 가지 누락이 있다.

1. **SDK assembly 특성 미명시**: agent-sdk가 단순 re-export 레이어로 오해될 수 있다. `feedback_sdk_not_reexport_all.md` 미반영.

2. **agent-plugins 레이어 누락**: agent-plugin-\* 9개 패키지와 agent-tool-mcp가 Product Stack 다이어그램에 없다.

## Solution

1. SDK 섹션에 "SDK는 조합(assembly) 레이어 — re-export 레이어가 아님" 명시
2. Plugin 레이어를 Product Stack 다이어그램에 추가

## Test Plan

- 수정 후 문서가 `code-quality.md`의 Layered Assembly Architecture와 일치하는지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.
