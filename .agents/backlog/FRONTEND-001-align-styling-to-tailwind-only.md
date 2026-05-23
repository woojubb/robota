---
title: 'FRONTEND-001: 스타일링 규칙 정합 — custom CSS 제거 및 Tailwind 전환'
status: done
created: 2026-05-23
priority: high
urgency: now
area: packages/agent-web-ui, apps/agent-web
depends_on: []
---

## Background

`frontend.md` 룰 제정 후 기존 코드에서 다음 위반이 발견됐다.

## 작업 항목

### 1. `apps/agent-web/src/app/globals.css` — dead custom CSS 제거

아래 클래스들은 정의돼 있으나 소스 파일에서 단 한 곳도 사용되지 않음(dead code):

- `.studio-surface`
- `.studio-surface-raised`
- `.studio-glow-violet`, `.studio-glow-emerald`, `.studio-glow-amber`, `.studio-glow-rose`, `.studio-glow-cyan`
- `.studio-grid-bg`

→ **삭제**

허용 예외 (유지):

- CSS custom property 정의 (`--studio-bg` 등) — Tailwind `@theme`이 참조하는 토큰이므로 유지
- `.react-flow__*` 스타일 — 서드파티 라이브러리 클래스 오버라이드는 Tailwind로 불가, `globals.css`에서 허용

### 2. `packages/agent-web-ui/spa/main.tsx` — ErrorBoundary 인라인 스타일 → Tailwind

현재:

```tsx
<div style={{ minHeight: '100vh', background: '#1e1e2e', ... }}>
  <p style={{ color: '#e4e4ef', ... }}>
```

→ Tailwind 클래스로 교체 (CSS 변수 기반 색상 사용)

### 3. `frontend.md` — 허용 예외 명시

다음 항목을 명시적 예외로 추가:

- 서드파티 라이브러리 클래스 오버라이드 (`.react-flow__*` 등)는 `globals.css`에서 허용
- 루프 인덱스처럼 빌드 타임에 알 수 없는 동적 CSS 값은 `style={{}}` 인라인 최후 수단 허용

## Test Plan

- `grep -r "studio-surface\|studio-glow\|studio-grid-bg"` → 결과 없어야 함
- `grep -n "style={{" packages/agent-web-ui/spa/main.tsx` → 결과 없어야 함
- `pnpm typecheck` pass
- `pnpm --filter @robota-sdk/agent-web-ui build` pass

## User Execution Test Scenarios

Not applicable — internal styling.
