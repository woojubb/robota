---
title: 'SITE-002: 마케팅 콘텐츠 docs → www 이전 및 Cost Calculator React 재작성'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: apps/www, apps/docs, content/
depends_on: [SITE-001]
---

## Background

SITE-001에서 www.robota.io 사이트 골격이 완성되면, 현재 docs VitePress에 섞여 있는
마케팅 콘텐츠를 www로 이전한다.

Cost Calculator는 이 과정에서 VitePress Vue 컴포넌트에서 **Next.js React 컴포넌트**로
재작성한다 — frontend.md 규칙 준수(VitePress 외부에서 Vue 금지).

## 이전 대상 페이지

| 현재 경로 (docs)         | www 경로                 | 비고                   |
| ------------------------ | ------------------------ | ---------------------- |
| `/compare/`              | `/compare`               | Why Robota 비교 페이지 |
| `/tools/cost-calculator` | `/tools/cost-calculator` | Vue → React 재작성     |
| `/showcase/`             | `/showcase`              | Build with Robota      |
| `/roadmap`               | `/roadmap`               | 분기별 공개 로드맵     |
| `/enterprise/`           | `/enterprise`            | Enterprise 연락처      |

## Cost Calculator 재작성 (Vue → React)

현재: `apps/docs/.vitepress/theme/CostCalculator.vue`

- VitePress `<style scoped>` CSS, `ref()`, `computed()` Vue 패턴

변환 후: `apps/www/src/components/CostCalculator.tsx`

- React `useState`, `useMemo` 패턴
- Tailwind utility classes only (CSS 없음)
- 기능 동일: 슬라이더, task type/level 라디오, 비용 계산, 공유 버튼

## docs에서 제거할 nav 항목 (SITE-003에서 처리)

이전 완료 후 docs VitePress nav에서 아래 항목 제거:

- `Why Robota` → www.robota.io/compare 링크로 교체
- `Cost Calculator` → www.robota.io/tools/cost-calculator 링크로 교체
- `Showcase` → www.robota.io/showcase 링크로 교체
- `Roadmap` → www.robota.io/roadmap 링크로 교체
- `Enterprise` → www.robota.io/enterprise 링크로 교체
- `Home` (/) → www.robota.io 링크로 교체

docs nav에 남을 항목:

- Getting Started, Guide, Examples, Packages, Changelog, Development, Playground

## docs에서 삭제할 content/ 파일들 (이전 완료 후)

```
content/compare/
content/enterprise/
content/showcase/
content/roadmap.md
content/tools/
```

> v2.0.0/ 디렉토리는 영구 보존 대상 — 절대 삭제 금지.

## 작업 항목

1. www에 각 페이지 구현 (markdown → React/Next.js 페이지)
2. CostCalculator.tsx 재작성 (React + Tailwind)
3. docs VitePress에서 이전된 nav 항목 외부 링크로 교체
4. 기존 content/ 마케팅 파일 삭제 (docs cleanup)
5. `apps/docs/.vitepress/theme/CostCalculator.vue` 삭제

## Test Plan

- 모든 www 이전 페이지 build 확인
- CostCalculator 계산 결과 정합성 확인
- docs VitePress nav 항목 링크 정상 작동
- `pnpm --filter robota-www build` pass
- `pnpm --filter robota-docs build` pass

## User Execution Test Scenarios

Not applicable — web content migration.
