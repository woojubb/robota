# Plugin / Module 분리 (장기 구상)

## 원칙
- Module/Plugin 없이도 기본 대화가 가능해야 한다(선택적 확장).
- Plugin/Module 간 결합은 이벤트 기반으로 유지한다.

## 현재 스펙과의 관계
- 현재 실행/이벤트/워크플로우 연결 규칙은 DAG 및 agents 관련 최신 스펙 문서를 기준으로 한다.
- Module 관련 장기 구상은 정식 스펙이 아니며, 구현이 시작되면 `.agents/tasks/`에 task 파일을 생성한다.


