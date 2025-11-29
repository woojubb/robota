# 워크플로우 연결 개선 설계 v3.0 (아카이브)

> 상세 실행 계획은 `.design/open-tasks/CURRENT-TASKS.md` Priority 1·2 및 Path-Only 관련 문서에서 관리합니다. 본 문서는 v3 개선안의 핵심 요약만 남겨둔 참고용 아카이브입니다.

## 핵심 목표
1. Tool Response → Merge Results 경로를 Path-Only 규칙으로 복구
2. Agent Numbering/Integration Instance 정책 정립
3. User Input이 단일 루트로 유지되도록 Fork/Join 구조 정리

## 주요 이슈 (요약)
- Tool Response와 Merge Results 사이의 연결 단절 및 중복 노드 생성
- Agent Numbering System 비활성화로 agent metadata 누락
- Response 교차 연결과 User Input 고립 문제

## 해결 전략 스냅샷
1. **Phase 1**: rootExecutionId 기반 키 일관화, Merge Results 생성 시점 단일화
2. **Phase 2**: `agentCopyManager` 활용으로 Agent 번호 지정 및 구조 표준화
3. **Phase 3**: Integration Instance(`agent_0_copy_1`)로 Tool Response 집합 제어
4. **Phase 4**: 중복/고립 노드 제거 및 User Input → Agent 0 경로 복구

## 목표 구조(요약)
```
User Input → Agent 0 → Thinking → Tool Call ×2
                        ↓           
                   Tool Response ×2
                        ↓
                  Merge Results
                        ↓
                 Agent 0 Copy
                        ↓
                 Final Response
```

## 진행 참고
- 실제 작업 순서와 검증 체크리스트는 CURRENT-TASKS Priority 1(Agent Event Normalization)과 Priority 2(Fork/Join Path-Only)에서 추적합니다.
- Guarded 예제 26/27 실행 결과를 통해 Path-Only 위반 여부를 검증합니다.

(이 문서는 아카이브 용도로만 유지하며, 신규 계획은 CURRENT-TASKS에 작성해 주세요.)
