---
title: 'ARCH-CONF-008: agent-team, agent-tool-mcp SPEC.md 아키텍처 레이어 반영 검증'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: spec-conformance
depends_on: ARCH-AUDIT-002
---

## Problem

`repository-overview.md`에 `agent-team`, `agent-tool-mcp`가 각각 올바른 패밀리(providers/remote, CLI runtime)로 명시되었으나, 각 SPEC.md에서 아키텍처 레이어 위치가 명확히 기술되어 있는지 검증되지 않았다.

## Required Checks

### agent-team

- 역할: assignTask relay tools — 팀 협업 기능
- 확인 사항: 의존성이 agent-core만인가? agent-sdk는 composition root에서만 사용하는가?
- SPEC.md: "다른 agent-team 에이전트에 작업을 위임하는 relay tool 구현체"로 명시되어 있는가?

### agent-tool-mcp

- 역할: MCP tool implementations — MCP 프로토콜 기반 도구 구현
- 확인 사항: agent-tools의 tool interface를 구현하는가? agent-sdk, agent-cli에 역방향 의존성 없는가?
- SPEC.md: "agent-tools의 계약을 구현하는 MCP 어댑터"로 명시되어 있는가?

## Test Plan

```bash
# agent-team 의존성 확인
cat packages/agent-team/package.json | jq '.dependencies // {} | keys[]'

# agent-tool-mcp 의존성 확인
cat packages/agent-tool-mcp/package.json | jq '.dependencies // {} | keys[]'
```

각 SPEC.md의 Boundaries 섹션 확인.

## User Execution Test Scenarios

Not applicable — verification and SPEC.md update only. No runnable user-facing behavior change.
