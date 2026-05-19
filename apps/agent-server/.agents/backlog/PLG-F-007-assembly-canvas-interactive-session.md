---
title: 'PLG-F-007: Assembly Canvas 재설계 — InteractiveSession 노드 + 옵션 패널'
status: todo
created: 2026-05-19
priority: medium
urgency: soon
area: packages/agent-playground
depends_on: [PLG-F-001, PLG-F-002]
---

## Background

현재 Assembly Canvas의 AgentNode는 `Robota` 인스턴스를 시각화한 것으로,
`provider`, `model`, `systemMessage`, `toolCount` 만 표시한다.

`InteractiveSession`으로 마이그레이션하면 설정 항목이 달라진다:

- `cwd`: 작업 디렉토리
- `permissionMode`: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan'
- `maxTurns`: 최대 턴 수
- `commandModules`: 등록된 커맨드 모듈 목록

AgentNode를 `InteractiveSessionNode`로 재설계하고 이 정보를 시각적으로 표현해야 한다.

## Goals

1. `AgentNode` → `InteractiveSessionNode`로 재설계:
   - 표시 항목: provider/model, permissionMode 배지, maxTurns (설정된 경우), commandModules 수
   - 기존 handle 유지: `tool-input` (오른쪽), `skill-output` 연결점 (왼쪽), `chain-output` (아래)
   - 시각 언어: 현재 파란 테두리 → 인디고/보라 그라디언트 테두리로 변경 (InteractiveSession 아이덴티티)

2. `IPlaygroundAgentConfig` 타입 확장:
   - `permissionMode: 'bypassPermissions' | 'default' | 'acceptEdits' | 'plan'` 추가 (기본: `'bypassPermissions'`)
   - `maxTurns?: number` 추가
   - `cwd?: string` 추가 (기본: `process.cwd()`)

3. "Create Agent" 모달 업데이트:
   - permissionMode 선택 드롭다운 추가
   - maxTurns 입력 필드 추가 (선택 사항)
   - Advanced 섹션 접기/펼치기

4. Assembly Canvas 상단에 "InteractiveSession" 레이블:
   - 현재 세션 ID (짧은 형태) 표시
   - 세션 상태 배지: 'idle' | 'running' | 'error'

5. 코드 생성 업데이트 (PLG-F-001 연동):
   - permissionMode, maxTurns 등 새 옵션이 생성 코드에 반영

## Non-Goals

- 캔버스에서 직접 노드 연결 그리기 (연결은 드래그앤드롭으로만)
- 여러 InteractiveSession 병렬 시각화

## Architecture

```
packages/agent-playground/src/
├── components/playground/assembly-canvas/
│   └── nodes/
│       └── agent-node.tsx    ← InteractiveSessionNode로 재설계
├── lib/playground/
│   └── robota-executor.ts    ← IPlaygroundAgentConfig 타입 확장
└── playground/components/
    └── playground-modals.tsx  ← CreateAgent 모달 업데이트
```

## Test Plan

- 단위 테스트:
  - `InteractiveSessionNode` 렌더링: permissionMode 배지 표시 확인
  - permissionMode/maxTurns 설정이 코드 생성에 반영되는지
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: permissionMode 설정 + 코드 반영

**Prerequisites**: PLG-F-001 완료

**Steps**:

1. "Create Agent" 클릭 → Advanced 섹션 펼치기
2. permissionMode = 'default' 선택 → 에이전트 생성
3. "Code Export" 탭 클릭

**Expected observable result**:

- AgentNode(InteractiveSessionNode)에 permissionMode 배지 표시
- 생성 코드에 `permissionMode: 'default'` 포함

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: 세션 상태 시각화

**Prerequisites**: PLG-F-002 완료, 에이전트 생성

**Steps**:

1. 메시지 전송 중 캔버스 확인

**Expected observable result**:

- 메시지 처리 중 InteractiveSessionNode에 'running' 배지 표시
- 처리 완료 후 'idle'로 복귀

**Evidence**: `<스크린샷 — 구현 후 기입>`
