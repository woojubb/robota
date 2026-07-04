---
title: 'REFACTOR-025: 300줄 초과 상위 파일 분할(828/719/597) + file-size 스캔 차단 승격'
status: todo
created: 2026-07-04
priority: medium
urgency: later
area: packages/agent-playground, packages/agent-framework, packages/agent-transport-tui, scripts/harness
depends_on: ['INFRA-026']
---

# 300줄 초과 상위 파일 분할(828/719/597) + file-size 스캔 차단 승격

Re-audit P2-16 (STRUCT-01; CLI-BL-022 승격). 300줄 anti-monolith가 "기계 강제" 선언과 달리 경고
전용, 위반 84건(agent-\* 43) 누적.

## What

1. 상위 3개 분할: PlaygroundApp.tsx(828), interactive-session.ts(719), App.tsx(597).
2. file-size 스캔 exitCode=1 승격(잔여 위반 명시 allowlist+사유, 번다운 목표).
3. 규칙 문서 문구를 실태와 일치.

## Test Plan

- 분할 후 스위트 green; 스캔 red(pre)→green(post) prove.

## User Execution Test Scenarios

- agent-executable. 분할 경로 라이브 동작 동일성 1회(TUI 기동/playground 렌더) 실측.
- Evidence: (record after execution)
