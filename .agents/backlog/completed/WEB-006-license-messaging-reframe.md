---
title: 'apps/www — Reframe AGPL/license messaging (stop selling it as a benefit)'
status: done
---

# apps/www — Reframe AGPL/license messaging

## What

Stop presenting the AGPL-3.0 license as a competitive advantage / feature across the
marketing site. State licensing as a neutral fact in a small number of places, and sell the
actual user benefits (auditable, self-hostable, no vendor lock-in, commercial option) instead.

## Why

AGPL-3.0 is a license **choice** with real obligations (copyleft + network/Section-13
source-disclosure). It is not a user benefit and for many commercial users it is a constraint
— which is exactly why a commercial license exists. The current copy frames it as a perk and
in places hides the obligations ("use in commercial products — no CLA required"), which is
misleading and a launch-day credibility/compliance risk. The site owner explicitly flagged
this: "AGPL is not even an advantage, but it's written that way in the feature comparison."

Detailed findings + exact rewrites (EN/KO): `.design/www-audit/2026-06-16/` —
`02-compare.md` (PRIMARY), `01-home.md`, `03-enterprise.md`, `05-global-consistency.md`.

## Scope (locations to fix — SSOT is the audit reports)

P0:

- `home.features[4]` — replace the "🔓 AGPL-3.0 & Commercial / no CLA required" card with a
  real benefit ("Auditable & self-hostable"); state license as a neutral one-liner in body.
- `compare.description` headline — remove AGPL as a selling point.
- `compare.features[4]` "Open source (AGPL-3.0)" table row — relabel "Source-available";
  move license abbreviations to a footnote (the row is not a Robota-only win).
- `compare.differentiators[2]` "3. Fully Open Source (AGPL-3.0)" — retitle "Open & Self-Hostable";
  fix body that implies obligation-free commercial use.
- `enterprise.security.highlights[0]` — relabel to "Auditable source code"; move dual-license
  detail to the (already well-written) enterprise FAQ.
- `common.footer.copyright` — remove license name; "© 2026 Robota" only.

P1/P2:

- `home.hero.descriptionSuffix` — drop license from the hero.
- `common.footer.tagline` — keep ONE neutral license statement here; fix "commercial" vs
  "Commercial" casing consistency.

## Standard wording

- EN: `Open source (AGPL-3.0). A commercial license is available.`
- KO: `오픈소스 (AGPL-3.0). 상업용 라이선스 별도 제공.`
- License appears in at most ~3 places: footer (once), enterprise FAQ (detail), compare table row (once).

## Done When

- License is no longer framed as a feature/differentiator anywhere.
- No copy implies obligation-free commercial use of the AGPL build.
- License stated neutrally in ≤3 places; removed from copyright line and hero.
- EN/KO parity maintained; `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Visit `/`, `/compare`, `/enterprise` in EN and KO → license appears only as a neutral fact,
   never as a checkmark feature or differentiator card.
2. Footer copyright reads "© 2026 Robota" with no license name; tagline states the dual license once.

## Evidence Log

2026-06-16 — Implemented and verified against the built static export (`apps/www/out`).

- `footer.copyright` now "© 2026 Robota" (license name removed); `tagline` carries the single neutral statement.
- Removed benefit-framing: built HTML grep count 0 for "no CLA required" and the "AGPL-3.0 & Commercial" feature/differentiator titles.
- `home.features[4]` → "Auditable & Self-Hostable"; `compare.features[4]` → "Source-available"; `compare.differentiators[2]` → "Open & Self-Hostable"; `enterprise.security.highlights[0]` → "Auditable source code" (all present in out/, EN+KO).
- License now appears as neutral fact only in footer tagline + enterprise FAQ + compare row.
- Verify: `pnpm --filter robota-www build` + `typecheck` pass.
