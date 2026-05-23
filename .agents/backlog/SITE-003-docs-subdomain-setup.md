---
title: 'SITE-003: docs.robota.io 서브도메인 설정 + VitePress 라이브러리 전용 정리'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: apps/docs, Vercel/DNS
depends_on: [SITE-002]
---

## Background

현재 docs VitePress는 `robota.io`에서 직접 서빙 중이다.
마케팅 콘텐츠가 www로 이전된 후, VitePress를 `docs.robota.io`로 분리 운영한다.

SITE-002 완료 후 docs는 라이브러리 문서에만 집중한 깔끔한 사이트가 된다.

## docs.robota.io에 남을 콘텐츠

| 경로                | 내용                           |
| ------------------- | ------------------------------ |
| `/`                 | Docs 홈 (Quick Start 진입점)   |
| `/getting-started/` | 설치 및 초기 설정              |
| `/guide/`           | CLI 사용법, local LLM, plugins |
| `/examples/`        | 코드 예제                      |
| `/packages/`        | 패키지 API 레퍼런스            |
| `/api-reference/`   | 상세 API                       |
| `/plugins/`         | 플러그인 개발 가이드           |
| `/changelog/`       | 릴리스 노트                    |
| `/development/`     | 기여 가이드                    |

**제거되는 nav 항목** (SITE-002에서 이미 www로 이전된 것):

- Home (/) → www.robota.io 링크
- Why Robota → www.robota.io/compare
- Showcase → www.robota.io/showcase
- Roadmap → www.robota.io/roadmap
- Enterprise → www.robota.io/enterprise
- Cost Calculator → www.robota.io/tools/cost-calculator

**docs nav에 추가**:

- `← robota.io` 로고 클릭 시 www.robota.io로 이동

## 배포 설정 작업 (Vercel)

1. Vercel 프로젝트에서 `docs.robota.io` 도메인 추가
   - DNS: `docs` CNAME → `cname.vercel-dns.com`
2. `robota.io` 기존 프로젝트에 임시 redirect 설정
   - `robota.io` → `docs.robota.io` (301 redirect, SITE-004 완료 전까지)
   - `www.robota.io` → `robota.io` 기존 redirect 제거 (SITE-004에서 역할 변경)

## vercel.json 변경 (docs 프로젝트)

```json
{
  "redirects": [
    {
      "source": "/compare/(.*)",
      "destination": "https://www.robota.io/compare/$1",
      "permanent": false
    },
    {
      "source": "/showcase/(.*)",
      "destination": "https://www.robota.io/showcase/$1",
      "permanent": false
    },
    {
      "source": "/roadmap(.*)",
      "destination": "https://www.robota.io/roadmap$1",
      "permanent": false
    },
    {
      "source": "/enterprise/(.*)",
      "destination": "https://www.robota.io/enterprise/$1",
      "permanent": false
    },
    { "source": "/tools/(.*)", "destination": "https://www.robota.io/tools/$1", "permanent": false }
  ]
}
```

이전된 URL로 접속 시 www.robota.io로 자동 리다이렉션 — SEO 링크 보호.

## VitePress config 변경

- `apps/docs/.vitepress/config.js`: `base`, `title`, `description` docs 전용으로 업데이트
- `apps/docs/.vitepress/config/en.js`: nav 항목 정리 (마케팅 항목 제거/교체)
- `CNAME` 파일: `docs.robota.io` 로 업데이트

## Test Plan

- `pnpm --filter robota-docs build` pass
- docs.robota.io 접속 시 라이브러리 문서 정상 표시
- 이전된 URL (/compare, /showcase 등) 접속 시 www.robota.io로 301 redirect 확인
- robota.io 접속 시 docs.robota.io로 임시 redirect 확인

## User Execution Test Scenarios

Not applicable — infrastructure/deploy.
