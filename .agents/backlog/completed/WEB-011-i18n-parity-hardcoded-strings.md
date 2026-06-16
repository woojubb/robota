---
title: 'apps/www — i18n parity & hardcoded-string fixes'
status: done
---

# apps/www — i18n parity & hardcoded-string fixes

## What

Fix locale parity bugs and move hardcoded UI strings into the message catalog so EN and KO
render correctly and identically in structure.

## Why

Several strings render wrong or English-only on the Korean locale, and one is an outright
broken sentence. These are mechanical correctness bugs (separate from the copy rewrites in
WEB-006/007/010).

Detailed findings: `.design/www-audit/2026-06-16/` — `03-enterprise.md`, `02-compare.md`,
`01-home.md`, `05-global-consistency.md`.

## Scope

P0 (render bug):

- `enterprise/page.tsx` contact line — KO has `contact.responseTimeSuffix`
  ("이내에 응답합니다.") but the TSX hardcodes `.` and never renders the suffix, producing the
  broken KO sentence "...에는 30 영업일." Unify the `contact.*` key structure across EN/KO and
  render the full sentence from keys. (Coordinate the response-time wording with WEB-007.)

P1:

- `home.hero.title` / `home.hero.titleHighlight` — KO duplicates "소유" between the two parts;
  restructure KO to mirror EN's title + highlight split.

P2:

- `compare/page.tsx` — hardcoded table header "Feature" and cell notes
  (`subscription`/`proprietary`/`IDE only`/`Apache 2`/`Python`) → move to message keys so the
  KO locale isn't English. Add `compare.featureColumnHeader` (EN "Feature" / KO "기능").
- `common.footer.tagline` "& commercial" casing vs copyright/features — unify (lowercase in body).
- `common.footer.links.npm` (→ agent-framework) vs hero install (`agent-cli`) — pick the
  representative package and make them consistent.
- `common.footer.links.playground` — currently unused (link commented out per WEB-005); keep
  until playground ships, just note the linkage. No action beyond a comment.
- KO spelling "디렉토리" vs "디렉터리" — unify across the site.

## Done When

- KO enterprise contact line is a complete, correct sentence; `contact.*` keys match across locales.
- No English UI strings leak into the KO locale (table headers, cell notes).
- KO hero title/highlight mirror the EN structure without duplication.
- `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Visit `/ko/enterprise` → the response-time sentence is complete and grammatical.
2. Visit `/ko/compare` → the comparison table header and cell notes are Korean, not English.

## Evidence Log

2026-06-16 — Implemented and verified against the built static export (`apps/www/out`).

- Enterprise KO render bug fixed: `contact.responseTimeSuffix` now rendered; built `ko/enterprise.html` shows the complete sentence "…영업일 기준 2일 이내 회신을 목표로 합니다." (was the broken "…30 영업일.").
- compare table header → `featureColumnHeader`; cell notes (subscription/proprietary/IDE only…) localized via `compare.notes` map — KO locale no longer leaks English.
- KO hero `title`/`titleHighlight` restructured to mirror EN (no "소유" duplication); footer casing unified; "디렉토리"→"디렉터리".
- Verify: `pnpm --filter robota-www build` + `typecheck` pass.
