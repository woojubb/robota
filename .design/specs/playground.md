# Playground 스펙 (최신)

## 범위
- `packages/playground`는 Playground UI/로직을 제공하는 라이브러리 패키지다.
- workflow graph는 SDK가 소유하고, Playground는 이를 **표시**한다.

## 데이터 소유권(SSOT)
- workflow graph 타입: `@robota-sdk/workflow`
- 이벤트/컨텍스트 타입: `@robota-sdk/agents`
- Playground는 owner 타입을 소비하고, 같은 의미의 타입을 로컬에서 재정의하지 않는다.

## Tools DnD
- 사이드바 도구 카드를 캔버스의 agent 노드로 드롭할 수 있다.
- drop 결과는 UI 오버레이 상태로 표시하며, SDK 그래프 구조를 변경하지 않는다.
- drag payload: `application/robota-tool` JSON
- agent 식별: `node.data.sourceId` 우선, 없으면 `node.id` 사용(추론/파싱 금지)

## 시각화/레이아웃(요약)
- Progressive reveal(표시 단계화)와 auto layout은 **UI 레이어 관심사**이며, workflow graph 규칙과 분리된다.
- 레이아웃은 노드의 실제 크기 측정 후 적용하는 것을 기준으로 한다.


