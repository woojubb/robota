# CAMEL Planner (요약)

> 세부 구현은 FUTURE-PROJECTS 및 향후 CURRENT-TASKS에서 다룹니다. 본 문서는 CAMEL Planner 콘셉트를 간단히 설명합니다.

## 목표
- 역할 기반 협업(Role A / Role B) 플로우를 자동 구성
- AgentFactory를 통해 두 개 이상의 Agent 인스턴스를 생성하고, 역할/규칙을 Planner가 주입

## 핵심 요소
- RoleManager: 역할 스크립트/시스템 프롬프트 관리
- CollaborationEngine: 두 Agent 사이의 turn-based 대화를 orchestration
- WorkflowIntegration: CAMEL 결과를 WorkflowStructure에 반영(각 메시지를 Path-Only 규칙으로 노드화)

---

실제 구현 단계는 CURRENT-TASKS에 항목이 생성되면 진행하세요.
