# 임베디드 Playground 컴포넌트 (장기 구상)

## 목표
- 코드 에디터 + 실행 버튼을 제공하는 최소 UI 컴포넌트를 제공한다.
- 실행 요청은 RemoteExecutor/Playground 실행 경로를 재사용하여 보안/일관성을 유지한다.
- “Playground에서 열기” 동작으로 심화 기능은 전체 Playground로 위임한다.

## 설계 원칙
- Minimal/Extended 모드를 제공한다(기본은 최소 UI, 확장은 선택).
- 실행은 sandbox(예: Worker) 기반을 전제로 한다.
- 상위에서 상태를 제어할 수 있도록 props/callback 중심 API를 제공한다.


