---
status: approved
type: AGREEMENT
tags: [marketing, docs, community]
---

# PM-027: 한국어 마케팅 콘텐츠 — GeekNews, okky, velog 타겟

## Problem

Robota는 한국 팀이 만든 AI SDK/CLI이지만 한국 개발자 커뮤니티(GeekNews, okky, velog)에 한 번도 소개된 적 없다. robota.io에 한국어 랜딩 페이지가 있지만 커뮤니티 채널에 콘텐츠가 없어 "한국산 오픈소스 Claude Code 대안"으로 포지셔닝할 기회를 놓치고 있다.

재현 조건: GeekNews에서 "robota" 검색 → 결과 없음.

## Architecture Review

### Affected Scope

- `apps/docs/content/ko/` — 한국어 콘텐츠 강화
- `packages/agent-cli/README.md` — 한국어 요약 섹션 추가

### Alternatives Considered

- **Alt A (채택): GeekNews + velog + okky 콘텐츠 제작 + README 한국어 섹션** — Pro: 즉각적인 커뮤니티 노출, GitHub star 한국발 유입. Con: 지속적 커뮤니티 참여 필요.
- **Alt B: 영어 콘텐츠만 유지** — Pro: 콘텐츠 관리 단순. Con: 한국 개발자 신뢰 낮음, 초기 사용자 확보 기회 손실.

### Decision

Alt A 채택. GeekNews 포스트, velog 기술 블로그, okky 공유, README 한국어 섹션을 동시 진행. 한국 개발자 커뮤니티 반응 측정.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — apps/www, apps/docs 한국어 콘텐츠 현황 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

GeekNews 포스트, velog 기술 블로그 포스트, okky 공유 콘텐츠 작성. README에 한국어 요약 접이식 섹션 추가. robota.io `/ko` 랜딩 페이지 마케팅 관점 개선.

## Affected Files

- `packages/agent-cli/README.md`
- `apps/docs/content/ko/getting-started.mdx`

## Completion Criteria

- [ ] TC-01: GeekNews에 Robota 소개 포스트 게시 후 댓글 5개 이상
- [ ] TC-02: velog 포스트 게시
- [ ] TC-03: README에 한국어 요약 섹션 추가
- [ ] TC-04: robota.io `/ko` 페이지에 한국 개발자 타겟 카피 적용

## Test Plan

| TC-ID | Test Type | Tool / Approach               | Notes                                                                                |
| ----- | --------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| TC-01 | manual    | GeekNews post + comment count | External community interaction required — live posting and human comment count only  |
| TC-02 | manual    | velog post publication check  | Requires live velog.io account publish action — no automated publish possible        |
| TC-03 | unit      | grep — README Korean section  | Automated: grep README.md for Korean text presence                                   |
| TC-04 | manual    | robota.io /ko page review     | Requires live deployment and marketing copy review — content quality not automatable |

## Tasks

- [ ] `.agents/tasks/PM-027.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-05-25

**Status remains:** draft
**Failed criteria:**

- Test Plan manual rows missing "why automated is not possible" explanation: All 4 rows (TC-01 through TC-04) use Test Type "manual" and have Notes entries, but Notes describe what to verify (e.g., "Post published and receives ≥5 comments") rather than explaining why an automated test cannot be written. SKILL.md requires: "Rows where Tool is 'manual' have a non-empty Notes entry explaining why automated test is not possible."

**Required action:** Update each Test Plan Notes entry to state why automation is not possible (e.g., "TC-01: requires live GeekNews post and community interaction — no automated test possible"; "TC-02: requires live velog publication — no automated test possible"; "TC-03: README content change can be verified automatically via file read, consider changing Tool to 'automated' with grep/file-check approach"; "TC-04: requires live robota.io deployment review — no automated test possible").

**Other criteria checked (all passing):**

- Frontmatter: `status: draft` ✅, `type: AGREEMENT` (valid) ✅, `tags:` present ✅
- Problem section: concrete symptom ("GeekNews 'robota' 검색 → 결과 없음") ✅, reproduction condition present ✅, no TBD/TODO ✅
- Architecture Review Checklist: all 4 items `[x]` ✅, sibling scan `[x]` with evidence ✅
- Alternatives Considered: 2 entries (Alt A, Alt B) each with Pro/Con ✅
- Decision references trade-off (community engagement) ✅
- Completion Criteria: TC-01 through TC-04 all have TC-N prefix ✅, 4 distinct features covered ✅, no banned phrases ✅
- Test Plan TC count: 4 rows match 4 TC-N in Completion Criteria ✅
- Tasks section present with placeholder ✅
- Evidence Log present and was empty before this entry ✅
- No `## Status` or `## Classification` sections in body ✅

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `status: draft` ✅, `type: AGREEMENT` (valid per 11-prefix list) ✅, `tags: [marketing, docs, community]` present ✅
- Problem section: concrete symptom ("GeekNews에서 'robota' 검색 → 결과 없음") ✅, reproduction condition present ✅, no TBD/TODO/vague text ✅
- Architecture Review Checklist: all 4 items `[x]` ✅; sibling scan `[x]` with explicit evidence ("apps/www, apps/docs 한국어 콘텐츠 현황 확인") ✅
- Alternatives Considered: 2 entries (Alt A, Alt B) each with explicit Pro/Con ✅; Decision references trade-off (community engagement vs. management overhead) ✅
- Completion Criteria: TC-01 through TC-04 all carry TC-N prefix ✅; 4 criteria for 4 distinct deliverables ✅; all use observable behavior form ✅; no banned phrases ✅
- Test Plan: 4 rows match 4 TC-N ✅; TC-01 manual — Notes: "External community interaction required — live posting and human comment count only" (explains why automation not possible) ✅; TC-02 manual — Notes: "Requires live velog.io account publish action — no automated publish possible" ✅; TC-03 type is "unit" (automated grep) — manual Notes requirement does not apply ✅; TC-04 manual — Notes: "Requires live deployment and marketing copy review — content quality not automatable" ✅
- TC-N count match: Completion Criteria 4 (TC-01–TC-04) = Test Plan 4 rows ✅
- Tasks section present with placeholder ✅; Evidence Log section present ✅; no `## Status` or `## Classification` sections in body ✅

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: PM group (PM-023~037)
