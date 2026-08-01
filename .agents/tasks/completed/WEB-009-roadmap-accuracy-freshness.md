---
title: 'apps/www — Roadmap accuracy & freshness (version cohort, dates, overpromises)'
status: done
---

# apps/www — Roadmap accuracy & freshness

## What

Bring the roadmap page in line with reality: correct the stale version cohort, remove/soften
hard date and quarter commitments, and drop overpromised unbuilt products.

## Why

The "Now" table is built on `beta.67`/`beta.68` while the actual build is `3.0.0-beta.76`, so
items marked "Planned" are 8+ betas in the past — visibly false on launch. "Last updated:
2026-05-23" is ~24 days old. "Robota Cloud beta", the `robota-sdk/action@v1` slug, and a
quarter-pinned "v1.0.0 RC" commit to things that don't exist yet and will read as broken
promises.

Detailed findings + exact rewrites (EN/KO): `.design/www-audit/2026-06-16/04-roadmap-showcase-beta.md`.

## Scope (P0 unless noted; SSOT is the audit report)

- `roadmap.now.items` — re-verify each item's real status against the current build; mark done
  or drop the per-beta version tags and abstract to themes (avoid "beta.68 = planned").
- `roadmap.lastUpdated` — update to launch date or remove the absolute date ("Reviewed regularly").
- `roadmap.next.items[4]` "Robota Cloud beta" — remove or demote to "Later (exploratory)"; drop
  the quarter and specific feature list.
- `roadmap.next.items[1]` — remove the nonexistent `robota-sdk/action@v1` slug.
- `roadmap.next.title` "Next — Q3 2026" / `roadmap.now.subtitle` "Q2 2026 …" — drop hard quarter
  labels (they go stale within weeks). (P1)
- `roadmap.next.items[0]` v1.0.0 RC — keep the condition wording, drop the quarter. (P1)
- `roadmap.descriptionSuffix` "updated quarterly" → "updated regularly". (P1)
- `roadmap.vote.githubDiscussions` / `roadmap.now` "디렉토리" — verify Discussions is enabled
  (else 404); unify 디렉터리/디렉토리 spelling. (P2)
- Showcase (related): `showcase.featuredTitle` plural with one item → singular or add a case;
  narrow `showcase.description` scope to what's actually demonstrated. (P1/P2)

## Done When

- Every roadmap status/version reflects the current build; no past version marked "planned".
- No absolute stale date; no hard quarter promises; no nonexistent product/slug committed.
- EN/KO parity maintained; `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Visit `/roadmap` (EN + KO) → no item references a version older than the current build as
   "planned"; no specific past date reads as stale.
2. No roadmap link 404s (GitHub Action slug, Discussions).

## Evidence Log

2026-06-16 — Implemented.

- Removed the stale `beta.68` "planned" rows (build is beta.76); "Now" table now lists only shipped beta.67 items.
- `lastUpdated` absolute date removed → "Reviewed regularly"; `descriptionSuffix` "updated quarterly" → "updated regularly".
- Hard quarter labels dropped (now.subtitle "Active development", next.title "Next"); nonexistent `robota-sdk/action@v1` slug removed; "Robota Cloud beta" demoted to "Later — Exploration" as "Hosted experience".
- Showcase: `featuredTitle` → singular; description narrowed to demonstrated scope. KO "디렉토리"→"디렉터리".
- Verify: `pnpm --filter robota-www build` + `typecheck` pass.
