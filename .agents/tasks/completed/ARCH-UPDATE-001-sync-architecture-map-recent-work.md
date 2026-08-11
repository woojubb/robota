---
title: 'ARCH-UPDATE-001: Architecture Map Sync — PLG-008~019, CORE-001, TOOL-001, DAG fix 반영'
status: done
completed: 2026-05-22
created: 2026-05-20
priority: high
urgency: soon
area: .agents/specs/architecture-map/, .agents/project-structure.md, packages/*/docs/SPEC.md
depends_on: [TOOL-002]
---

## Background

아키텍처 맵은 실제 코드 상태와 동기화되어야 한다.
최근 완료된 작업들이 아키텍처 맵에 반영되지 않았다:

- PLG-009~018: Playground 전체 스택 구현 (PlaygroundExecutor, AssemblyCanvas, CodeGenerator, Skills)
- PLG-019 + TOOL-002: assignTask 완전 제거
- CORE-001: `maxSameToolInputs` 실행 제한 옵션 추가
- TOOL-001: WebFetch 오류 메시지 구체화
- DAG fix: `agent_spawned` → `tool_call_complete` 체인 수정

## 업데이트 대상

### .agents/project-structure.md

- `agent-team` 설명 수정: "Team collaboration (assignTask relay tools)" → assignTask 제거 후 실제 상태 반영

### .agents/specs/architecture-map/agent-team.md

- assignTask 기반 내용 전면 재작성 (TOOL-002 완료 후)
- 현재 agent-team은 assignTask 제거 후 내용이 없으므로, 패키지 현황 반영

### .agents/specs/architecture-map/agent-system.md

- Playground stack 섹션에 agent-playground 상세 내용 보강:
  - PlaygroundExecutor (SSE 기반)
  - AssemblyCanvas (AgentNode + ToolNode)
  - BlockTrackingPlugin + block-tracking hooks
  - Code Generator + Skills 패널
- CORE-001 maxSameToolInputs 언급 추가 (agent-core 섹션)

### packages/agent-playground/docs/SPEC.md

- 현재 SPEC.md가 최신 구현을 반영하는지 확인 및 업데이트
- PLG-019 이후 assignTask 관련 내용 완전 제거

### packages/agent-core/docs/SPEC.md

- `maxSameToolInputs` 옵션 문서 추가 (CORE-001)

## Test Plan

- `grep -r "assignTask" .agents/ packages/ --include="*.md"` → 결과 없음
- 모든 수정된 SPEC.md가 실제 코드와 일치

## User Execution Test Scenarios

### Scenario 1: 아키텍처 맵 assignTask 흔적 없음

```bash
grep -r "assignTask" .agents/ packages/*/docs/ content/api-reference/ --include="*.md"
```

Expected: 0 matches
