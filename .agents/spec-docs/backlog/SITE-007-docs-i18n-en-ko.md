---
status: review-ready
type: BEHAVIOR
tags: [site, docs, i18n, next-intl, localization]
---

# SITE-007: docs 사이트 i18n — en/ko 이중 언어 지원 (next-intl + content/ko/)

## Problem

`apps/docs`가 영어 마크다운 파일(272개+)만 서빙한다. 한국어 개발자 온보딩을 위한 `/ko/docs/...` 경로가 없고, 번역 없는 페이지의 영어 fallback 구조도 미구현 상태다.

재현 조건: `content/ko/` 디렉토리 존재하지 않음. `http://localhost:3020/ko/docs/getting-started` 접속 → 404 또는 라우팅 오류 발생.

## Architecture Review

### Affected Scope

- `apps/docs/src/app/` — `[locale]/[[...slug]]` 라우팅 구조 추가
- `apps/docs/src/lib/content.ts` — `getFilePath(slug, locale)` locale 파라미터 수용, `content/ko/` fallback 로직
- `content/ko/` — 한국어 번역 파일 디렉토리 (점진적 추가)
- `apps/docs/src/messages/en.json`, `ko.json` — UI 문자열 번역

### Alternatives Considered

- **Alt A (채택): content/ko/ 별도 디렉토리 + content/ 영어 fallback** — Pro: 기존 272개 파일 무수정, 점진적 번역 가능, content/ko/<slug>.md 없으면 content/<slug>.md fallback. Con: 디렉토리 구조가 geistdocs 방식(file.ko.md)과 다름.
- **Alt B: file.ko.md 접미사 방식 (geistdocs 방식)** — Pro: 단일 디렉토리에 모든 번역 파일. Con: 기존 272개 파일에 접미사 추가 필요, content.ts 전체 로직 변경.

### Decision

Alt A 채택. 기존 content/ 파일 무수정 유지. `getFilePath(slug, 'ko')`는 먼저 `content/ko/<slug>.md`를 찾고 없으면 `content/<slug>.md`로 fallback. fallback 시 페이지 상단에 안내 배너 표시.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — apps/docs/src/lib/content.ts, app/[[...slug]]/page.tsx, content/ 디렉토리 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`apps/docs/src/lib/content.ts`에 locale 파라미터 추가. `content/ko/` 우선 탐색 → `content/` fallback 로직 구현. fallback 시 "이 페이지는 아직 번역 중입니다" 배너 컴포넌트 추가. `generateStaticParams`에서 en × ko × 모든 슬러그 조합 생성. `src/messages/ko.json` 작성.

## Affected Files

- `apps/docs/src/lib/content.ts`
- `apps/docs/src/app/[locale]/[[...slug]]/page.tsx` (신규 또는 수정)
- `apps/docs/src/messages/ko.json` (신규)
- `content/ko/` (신규 디렉토리)

## Completion Criteria

- [ ] TC-01: `pnpm --filter robota-docs build` 명령이 exit code 0을 반환하고 빌드 산출물이 생성됨
- [ ] TC-02: `content.ts`의 `getFilePath` 함수가 locale 파라미터를 수용하고 `content/ko/` 우선 탐색 후 `content/` fallback 로직을 포함함
- [ ] TC-03: `content/ko/` 디렉토리가 존재함 (getting-started 등 P0 번역 파일 최소 1개 이상 포함)

## Test Plan

| TC-ID | Test Type | Tool / Approach                                        | Notes                                            |
| ----- | --------- | ------------------------------------------------------ | ------------------------------------------------ |
| TC-01 | unit      | pnpm --filter robota-docs build                        | Build exit code 0                                |
| TC-02 | unit      | grep — content.ts contains 'ko' locale parameter logic | Automated source code check for fallback pattern |
| TC-03 | unit      | find — content/ko/ exists + file count ≥ 1             | Automated directory existence and content check  |

## Tasks

- [ ] `.agents/tasks/SITE-007.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-05-25

**Status remains:** draft
**Failed criteria:**

- Completion Criteria TC-01 uses prohibited vague language: "오류 없이 완료됨" is equivalent to "no errors" which is explicitly banned. Required form: use an observable outcome such as "exit code 0" or "build output lists N routes with no error lines in stdout".
  **Required action:** Rewrite TC-01 in Command form or Observable behavior form without using "no errors" or equivalent. Example: `TC-01: pnpm --filter robota-docs build exits with code 0 and emits a route manifest listing /en and /ko locale prefixes`

**Checked sections:**

- Frontmatter: status=draft ✓, type=BEHAVIOR (valid) ✓, tags present ✓
- Problem: concrete symptom (404/routing error on /ko/docs/getting-started) ✓, reproduction condition (content/ko/ absent) ✓, no TBD/TODO ✓
- Architecture Review Checklist: all 4 items [x] ✓; sibling scan [x] with named files ✓; 2 alternatives with pro/con ✓; decision references trade-off (기존 파일 무수정) ✓
- Completion Criteria TC-N prefix: TC-01, TC-02, TC-03 all present ✓; TC-02 and TC-03 use observable behavior form ✓; TC-01 FAIL (see above)
- Test Plan: section present ✓; 3 rows matching 3 TC-N ✓; no TBD ✓; no manual-only rows needing Notes justification ✓
- Tasks section: present with placeholder ✓
- Evidence Log: present and empty before this entry ✓
- No ## Status or ## Classification sections in body ✓

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present ✓; `status: draft` ✓; `type: BEHAVIOR` (valid from 11-prefix list) ✓; `tags:` field present ✓
- Problem: concrete symptom (`http://localhost:3020/ko/docs/getting-started` → 404/routing error) ✓; reproduction condition (`content/ko/` directory absent) ✓; no TBD/TODO/vague single-sentence descriptions ✓
- Architecture Review Checklist: all 4 items `[x]` ✓; sibling scan `[x]` with named files (content.ts, page.tsx, content/ dir) ✓; 2 alternatives (Alt A, Alt B) with pro/con each ✓; decision references trade-off (기존 파일 무수정 유지) ✓
- Completion Criteria TC-N prefix: TC-01, TC-02, TC-03 all present ✓; at least 1 criterion per distinct feature ✓
- TC-01: "exit code 0을 반환하고 빌드 산출물이 생성됨" — Observable behavior form, no prohibited language ✓ (previously failing criterion, now fixed)
- TC-02: describes specific function signature + fallback logic — Command/Observable form ✓
- TC-03: "디렉토리가 존재함 (최소 1개 이상 포함)" — Observable behavior form ✓
- Test Plan: section present ✓; 3 rows matching 3 TC-N (count matches) ✓; all rows have non-empty Test Type and Tool/Approach ✓; no TBD ✓; no manual-only rows requiring Notes justification ✓
- Tasks section: present with placeholder ✓
- Evidence Log: section present ✓; prior FAIL entry from first run present (this is a re-run, not first run — empty-only requirement applies to first run) ✓
- No `## Status` or `## Classification` sections in body ✓
- TC-N count match: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03) ✓
