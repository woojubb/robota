---
title: 'SITE-004: 도메인 리다이렉션 최종 전환 — robota.io → www.robota.io'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: Vercel DNS / 도메인 설정
depends_on: [SITE-001, SITE-002, SITE-003]
---

## Background

SITE-001~003 완료 후 두 사이트가 모두 안정적으로 운영되면, 마지막 단계로 도메인 리다이렉션을 최종 전환한다.

## 전체 도메인 전환 타임라인

### Phase 1 — SITE-003 완료 시점 (임시 상태)

| 도메인           | 행선지              | 비고                                 |
| ---------------- | ------------------- | ------------------------------------ |
| `robota.io`      | → `docs.robota.io`  | 301 임시 redirect (기존 북마크 보호) |
| `docs.robota.io` | VitePress docs 서빙 | 신규                                 |
| `www.robota.io`  | Next.js www 서빙    | 신규                                 |
| `play.robota.io` | Playground          | 변동 없음                            |
| `blog.robota.io` | Astro 블로그        | 변동 없음 (미래)                     |

### Phase 2 — 최종 전환 (이 백로그 항목)

| 도메인           | 행선지              | 비고              |
| ---------------- | ------------------- | ----------------- |
| `robota.io`      | → `www.robota.io`   | 301 영구 redirect |
| `www.robota.io`  | Next.js www 서빙    | 메인 사이트       |
| `docs.robota.io` | VitePress docs 서빙 | 라이브러리 문서   |
| `play.robota.io` | Playground          | 변동 없음         |

## 최종 전환 체크리스트

Phase 2 전환 전 반드시 확인:

- [ ] www.robota.io 모든 페이지 정상 서빙 (2주 이상 안정 운영 확인)
- [ ] docs.robota.io SEO 인덱싱 완료 (Google Search Console 확인)
- [ ] www.robota.io → docs.robota.io 링크 헤더/푸터에 잘 노출
- [ ] OG 태그, sitemap.xml 양쪽 모두 정상
- [ ] 기존 robota.io 인바운드 링크 주요 경로 모두 redirect 처리 확인

## 작업 항목

### ✅ 코드 작업 완료 (SITE-001~003)

- `apps/www` 헤더/푸터의 `Docs` 링크 → `https://docs.robota.io` ✅
- `apps/docs/public/CNAME` → `docs.robota.io` ✅
- `apps/docs/vercel.json` 마이그레이션 경로 301 redirect ✅

### ⏳ 수동 인프라 작업 (Vercel Dashboard + DNS)

1. **DNS**: `docs` CNAME → `cname.vercel-dns.com` 추가
2. **Vercel**: docs 프로젝트에 `docs.robota.io` 커스텀 도메인 추가
3. **Vercel**: `robota.io` 프로젝트에 Phase 1 redirect 설정 (`robota.io` → `docs.robota.io`)
4. **2주 안정 운영 확인 후** Phase 2: `robota.io` → `www.robota.io` 로 redirect 변경
5. **Google Search Console**: sitemap 재제출

## 주의 사항

- `robota.io` 직접 접속자가 많으므로 Phase 1(임시 → docs) 기간을 **최소 2주 이상** 유지
- Phase 2 전환 후 `robota.io → docs.robota.io` redirect는 제거하고 `robota.io → www.robota.io`로 단순화
- CNAME 파일: docs VitePress 빌드 아티팩트의 CNAME은 `docs.robota.io` 유지

## Test Plan

- `robota.io` 접속 시 최종적으로 `www.robota.io` 로 301 redirect 확인
- `www.robota.io/docs` 또는 헤더 Docs 링크 클릭 시 `docs.robota.io` 로 정상 이동
- Google Search Console 크롤 오류 없음 확인

## User Execution Test Scenarios

Not applicable — infrastructure/DNS.
