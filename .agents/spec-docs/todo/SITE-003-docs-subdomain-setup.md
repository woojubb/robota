---
status: approved
type: INFRA
tags: [site, docs, subdomain, vercel, deploy]
---

# SITE-003: docs.robota.io 서브도메인 설정 + VitePress 라이브러리 전용 정리

## Problem

SITE-002 완료 후에도 VitePress docs가 `robota.io`에서 직접 서빙 중이다. 마케팅 사이트(www)와 라이브러리 문서(docs)가 같은 도메인에 있어 SEO 분리와 사이트 역할 구분이 불가능하다.

재현 조건: `apps/docs/public/CNAME` 내용이 `robota.io` — `docs.robota.io`로 변경되지 않음. `apps/docs/vercel.json`에 이전된 마케팅 경로 redirect 없음.

## Architecture Review

### Affected Scope

- `apps/docs/public/CNAME` — `docs.robota.io`로 변경
- `apps/docs/vercel.json` — 이전된 마케팅 경로 → www.robota.io redirect 추가
- `apps/docs/.vitepress/config/en.js` — nav 항목 외부 링크로 교체, `← robota.io` 링크 추가

### Alternatives Considered

- **Alt A (채택): CNAME + vercel.json redirect + nav 정리 코드 작업 후 Vercel 대시보드에서 도메인 추가** — Pro: 코드로 추적 가능한 모든 변경이 PR에 포함됨. Con: Vercel 대시보드 도메인 추가는 수동 단계 필요.
- **Alt B: vercel.json의 `alias` 필드로 도메인 설정** — Pro: 코드로만 관리. Con: `alias`는 deprecated, 현재 Vercel은 대시보드 도메인 연결 권장.

### Decision

Alt A 채택. 코드 변경(CNAME, vercel.json redirect, nav 정리)은 PR로 반영. Vercel 대시보드에서 `docs.robota.io` 도메인 연결은 배포 후 수동 1회 작업.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — apps/docs/public/CNAME, vercel.json, .vitepress/config/en.js 현재 상태 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`apps/docs/public/CNAME`을 `docs.robota.io`로 변경. `apps/docs/vercel.json`에 `/compare/`, `/showcase/`, `/roadmap`, `/enterprise/`, `/tools/` 경로를 `www.robota.io` 로 301 redirect. VitePress nav에서 이전된 마케팅 항목을 www 외부 링크로 교체하고 `← robota.io` 링크 추가.

## Affected Files

- `apps/docs/public/CNAME`
- `apps/docs/vercel.json`
- `apps/docs/.vitepress/config/en.js`

## Completion Criteria

- [ ] TC-01: `apps/docs/public/CNAME` 파일 내용이 `docs.robota.io`임
- [ ] TC-02: `apps/docs/vercel.json`에 `/compare/(.*)`를 `https://www.robota.io/compare/$1`로 리다이렉트하는 규칙이 포함됨
- [ ] TC-03: `pnpm --filter robota-docs build` 명령이 exit code 0을 반환하고 빌드 산출물이 생성됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                                    | Notes                                                   |
| ----- | --------- | -------------------------------------------------- | ------------------------------------------------------- |
| TC-01 | unit      | grep/cat — CNAME file content assertion            | Automated file content check                            |
| TC-02 | unit      | grep — vercel.json contains www.robota.io redirect | Automated JSON content check for redirect rule presence |
| TC-03 | unit      | pnpm --filter robota-docs build                    | Build exit code 0 — automated CI check                  |

## Tasks

- [ ] `.agents/tasks/SITE-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-05-25

**Status remains:** draft
**Failed criteria:**

- Completion Criteria TC-03 vague language: TC-03 reads "명령이 오류 없이 완료됨" which is equivalent to the banned "no errors" / "completes without errors" form. Required: rewrite as an observable outcome, e.g. "pnpm --filter robota-docs build exits with code 0 and produces dist/ output" or specify an artifact that must be present.
  **Required action:** Rewrite TC-03 in Command form or Observable behavior form that does not use "오류 없이" (no errors) or equivalent vague phrasing. Then re-run GATE-WRITE.

**Sections checked:**

- Frontmatter: status=draft ✅, type=INFRA (valid) ✅, tags present ✅
- Problem: concrete symptom (CNAME content mismatch + missing redirect) ✅, reproduction condition stated ✅, no TBD/TODO ✅
- Architecture Review Checklist: all 4 items [x] ✅; sibling scan [x] with named files ✅; 2 alternatives with pro/con ✅; decision references trade-off (manual Vercel dashboard step vs deprecated alias) ✅
- Completion Criteria: TC-01 ✅, TC-02 ✅, TC-03 ❌ (vague: "오류 없이 완료됨")
- Test Plan: section present ✅; 3 rows matching TC-01/TC-02/TC-03 ✅; no TBD ✅; no manual rows requiring Notes justification ✅
- Structure: Tasks section present ✅; Evidence Log was empty before this run ✅; no ## Status or ## Classification sections in body ✅
- TC-N count: Completion Criteria = 3, Test Plan rows = 3 — counts match ✅

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present ✅; `status: draft` ✅; `type: INFRA` (valid 11-prefix value) ✅; `tags:` field present ✅
- Problem: concrete symptom (CNAME content is `robota.io` not `docs.robota.io`, no redirect rules in vercel.json) ✅; reproduction condition stated ("재현 조건" block) ✅; no TBD/TODO/vague single-sentence ✅
- Architecture Review Checklist: all 4 items [x] ✅; sibling scan [x] with named files (CNAME, vercel.json, en.js) ✅; 2 alternatives with explicit pro/con (Alt A, Alt B) ✅; decision references trade-off (manual dashboard step vs deprecated `alias` field) ✅
- Completion Criteria: TC-01 ✅ (file content assertion — observable); TC-02 ✅ (specific redirect rule presence — observable); TC-03 ✅ (now reads "exit code 0을 반환하고 빌드 산출물이 생성됨" — Command/Observable form, no banned vague language); all 3 items have TC-N prefix ✅
- Test Plan: section present ✅; 3 rows for TC-01/TC-02/TC-03 matching Completion Criteria count of 3 ✅; no TBD in Test Type or Tool/Approach ✅; no manual rows requiring Notes justification ✅
- Structure: Tasks section present ✅; Evidence Log section present ✅; no `## Status` or `## Classification` sections in body ✅
- TC-N count match: Completion Criteria = 3, Test Plan rows = 3 ✅

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: SITE group (SITE-001~007) + FRONTEND group (FRONTEND-001)
