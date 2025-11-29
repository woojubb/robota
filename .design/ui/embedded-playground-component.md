# Embedded Playground Component (요약)

> 세부 구현 단계는 나중에 `CURRENT-TASKS.md` Priority 3/Playground 항목으로 이동합니다. 본 문서는 재사용 가능한 임베디드 플레이그라운드 컴포넌트의 목표만 정리합니다.

## 목표
- 코드 에디터 + 실행 버튼을 제공하는 최소 UI 컴포넌트 제공 (Monaco 기반)
- 필요 시 확장 모드(복사, 리셋, 템플릿, "Playground에서 열기" 버튼 등)로 확장
- 실행 요청은 RemoteExecutor/Playground API 경로를 재사용하여 보안 유지
- 홈페이지/문서/블로그 등 다양한 크기에 대응하는 반응형 설계

## 설계 원칙
1. **Minimal vs Extended 모드**: 기본은 코드+실행만, 선택적으로 추가 버튼/헤더 제공
2. **Sandbox 실행**: Web Worker 등을 이용해 안전하게 코드 실행, RemoteExecutor와 동일 파이프라인 공유
3. **연동성**: "Playground에서 열기" 버튼을 통해 현재 코드를 Playground 페이지로 보내 심화 기능 제공
4. **공통 상태 관리**: 코드/결과/로딩 상태를 상위에서 제어 가능 (`onCodeChange`, `onExecute`, `onError` 등)

## API 개요
```ts
interface EmbeddedPlaygroundProps {
  initialCode?: string;
  language?: 'ts' | 'js';
  mode?: 'minimal' | 'extended';
  playgroundUrl?: string;
  onExecute?: (code: string, result: unknown) => void;
  // ...기타 스타일/이벤트 설정
}
```

## 로드맵 개요
1. 컴포넌트 골격/레이아웃 + Tailwind 스타일 (Minimal/Extended)
2. Monaco Editor 래퍼와 실행 sandbox 통합
3. 결과 출력/콘솔 로그/에러 표시
4. 템플릿/공유/Playground 연동 기능 추가
5. 홈페이지/문서 통합, 접근성/크로스 브라우저 테스트

---

추가 작업이 필요하면 CURRENT-TASKS의 Playground 섹션에 세부 항목을 추가해 주세요.
