# Worker wrapper 패키지 (장기 구상)

## 목표
- Robota SDK 구성 요소를 Worker 환경에서 실행할 수 있는 `@robota-sdk/worker` 패키지를 제공한다.
- 기존 패키지들은 Worker 존재를 “모르게” 유지하고, wrapper만 Worker 의존성을 담당한다.

## 설계 원칙
- 기존 패키지는 순수하게 유지한다.
- wrapper는 proxy 패턴으로 호출을 Worker 스레드로 위임한다.
- 환경(Web/Node/Custom)별 factory는 선택적으로 주입 가능해야 한다.


