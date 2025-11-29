# 플레이그라운드 Tools 관리 및 드래그앤드롭(DnD) 설계 개요

> 세부 실행 계획과 체크리스트는 `CURRENT-TASKS.md`의 **Priority 3 · Playground Tools DnD** 섹션에서 유지합니다. 이 문서는 배경∙설계 원칙∙참고 구조만 제공합니다.

## 0. 목표와 범위
- 우측 사이드바 Tools 목록을 관리하고, Tool 카드를 React Flow 상의 `agent` 노드로 드롭하여 해당 Agent에 도구를 추가하는 경험을 완성
- 1차 범위: Tools 목록 UI, DnD 상호작용, UI 오버레이 상태
- 2차 범위: Agent Config 실제 반영, 영속화, 팀/툴 혼재 플로우 검증

## 1. 핵심 원칙
- Path-Only: 워크플로우 그래프 생성/연결 로직은 SDK가 담당, UI는 오버레이 상태만 관리
- No Fallback: 실패 시 명확한 오류를 노출; 침묵 처리나 임시 대체 금지
- Event Ownership: UI 레이어는 execution/agent/tool 이벤트를 직접 emit 하지 않음
- Source-of-truth: SDK에서 받은 `workflow`는 읽기 전용, UI 오버레이(`addedToolsByAgent`)로만 확장

## 2. 아키텍처 개요
- **Tools 사이드바**: `ToolItem { id, name, description, parameters? }` 배열 및 추가/삭제 UI
- **DnD 데이터 포맷**: `dataTransfer.setData('application/robota-tool', JSON.stringify(tool))`
- **AgentNode 이벤트**: `dragenter/over/leave/drop`로 하이라이트 및 `onToolDrop(agentId, tool)` 콜백 호출
- **UI 오버레이 병합**: 렌더 시 `sdkTools ∪ addedToolsByAgent[agentId]` (이름 기준 중복 제거, SDK 우선)
- **브릿지 경로**: `apps/web/src/lib/playground/robota-executor.ts`에서 agent registry를 관리하고 `updateAgentTools`, `getAgentConfiguration` 등을 노출

## 3. 단계별 진행 흐름 (세부 작업은 CURRENT-TASKS 참조)
1. **P1 (agents/workflow)**: AGENT_EVENTS.CONFIG_UPDATED, Robota config API, AgentEventHandler 업데이트 (완료)
2. **P2 (웹 브릿지)**: executor registry, `updateAgentTools/getAgentConfiguration`, 표준 에러 변환
3. **P3 (UI)**: Tools 목록 관리, DnD 이벤트, UI 오버레이 상태, 혼재 플로우 검증
4. **후속**: Agent Config 실제 반영, 레지스트리 확장, 제거 UI, 통합 테스트

## 4. 세부 참고
- **DnD 인터랙션**: AgentNode 하이라이트, 중복 드롭 방지, 빠른 연속 드롭 대응
- **타입/상태 정의**:
  ```ts
  interface ToolItem { id: string; name: string; description?: string; parameters?: Record<string, unknown>; }
  type AddedToolsByAgent = Record<AgentId, string[]>;
  interface WorkflowVisualizationProps {
    workflow?: UniversalWorkflowStructure;
    onToolDrop?: (agentId: string, tool: ToolItem) => void;
    addedToolsByAgent?: AddedToolsByAgent;
  }
  ```
- **검증 포인트**: 예제 26/27에서 툴 드롭 후 UI 오버레이 표시, Path-Only 규칙 위반 없음
- **에러 처리**: 브릿지 계층에서 SDK 오류를 UI 표준 에러 객체로 변환하여 토스트/모달로 전달

## 5. 제외 범위
- Agent Config 영속화·동기화, Tool 실행 로직, WorkflowState 변경 등은 별도 설계/PR에서 다룹니다.

---

세부 일정이 필요하면 `CURRENT-TASKS.md` Priority 3 섹션을 참고하거나 새 세부 계획을 거기에 추가하세요.
