# Playground Design (최신)

## 구성
- `packages/playground`: Playground UI/로직(재사용 가능한 라이브러리)
- `apps/web`: Playground를 렌더링하는 최소 호스트

## 상태/데이터 소유권
- workflow graph 타입은 `@robota-sdk/workflow`가 소유한다.
- 이벤트/컨텍스트 타입은 `@robota-sdk/agents`가 소유한다.
- Playground는 owner 타입을 소비하고, 같은 의미의 타입을 로컬에서 재선언하지 않는다.


