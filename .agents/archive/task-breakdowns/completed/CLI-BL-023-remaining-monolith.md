---
title: agent-sessions + agent-tools + agent-tool-mcp + agent-remote-client monolith decomposition
status: completed
priority: medium
urgency: soon
created: 2026-03-27
packages:
  - agent-sessions
  - agent-tools
  - agent-tool-mcp
  - agent-remote-client
---

## 요약

소규모 패키지들의 300줄 초과 파일 분해.

## 위반 파일

### agent-sessions (2 files)

- `session.ts` (575줄) — 가장 큰 파일. 실행/히스토리/컨텍스트 분리
- `permission-enforcer.ts` (331줄)

### agent-tools (2 files)

- `implementations/openapi-tool.ts` (451줄)
- `implementations/function-tool.ts` (303줄)

### agent-tool-mcp (1 file)

- `mcp-tool.ts` (343줄)

### agent-remote-client (1 file)

- `client/http-client.ts` (425줄)

## 테스트 계획

- 각 패키지 분해 전후 해당 패키지 테스트 통과 확인
- 분해 후 300줄 초과 파일 0개 확인
