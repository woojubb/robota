# Web Architecture (최신)

## 개요
- `packages/playground`: Playground UI/로직(라이브러리)
- `apps/web`: Playground를 렌더링하는 최소 호스트(Next.js)

## 책임 분리
- SDK 계약/이벤트/워크플로우 타입은 owner 패키지가 소유한다.
- web은 상태/타입/계약을 재정의하지 않고, owner의 public export만 소비한다.

## 이벤트/워크플로우 원칙
- 관계/연결은 `context.ownerPath` 기반 규칙만 사용한다(추론/대체 경로 없음).
- 이벤트명은 상수만 사용한다(문자열 리터럴 금지).


