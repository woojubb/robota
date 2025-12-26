# Playground Tools DnD (최신 스펙)

## 범위
- 사이드바 도구 카드를 캔버스의 agent 노드로 드롭할 수 있다.
- 드롭 결과는 UI 오버레이 상태로 표시하며, SDK 그래프 구조를 변경하지 않는다.

## 데이터 규칙
- drag payload는 `application/robota-tool`에 JSON으로 전달한다.
- drop 시 agent 식별은 `node.data.sourceId` 우선, 없으면 `node.id`를 사용한다(추론/파싱 금지).


