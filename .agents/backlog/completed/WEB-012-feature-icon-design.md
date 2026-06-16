---
title: 'apps/www — Replace feature emoji with a consistent icon set (design)'
status: done
---

# apps/www — Replace feature emoji with a consistent icon set

## What

Replace the color emoji used as headings on the home feature cards (and similar spots) with a
consistent monochrome line-icon set, or remove them.

## Why

The pre-launch copy review (WEB-010) flagged the emoji headings (🔑🔄📦🏠🔓⚡) as the single
most "childish (유치)" element for a professional developer audience. WEB-010 fixed the copy
tone and terminology, but the icon treatment is a design decision (which icon set, or none)
that was intentionally split out rather than guessed.

Reference: `.design/www-audit/2026-06-16/STYLE-GUIDE.md` (§ 아이콘) and `05-global-consistency.md`.

## Scope

- `home.features[].icon` in `en.json`/`ko.json` and the render in `home/page.tsx`
  (`<div className="text-2xl">{f.icon}</div>`).
- Decide: adopt a line-icon set (e.g. lucide-react) or drop icons entirely.
- Apply consistently; check the roadmap status badge emoji (✓ / 📋) for the same treatment.

## Done When

- Feature cards use a consistent icon treatment (line icons or none), no color emoji headings.
- `pnpm --filter robota-www build` passes.

## User Execution Test Scenarios

1. Visit `/` → feature cards render with the chosen consistent icon treatment, no childish emoji.

## Evidence Log

2026-06-16 — Implemented with lucide-react line icons.

- Added `lucide-react` to `apps/www` (lockfile change scoped to lucide only).
- `home/page.tsx` now renders monochrome line icons (KeyRound, Repeat, Package, Server, ShieldCheck, Zap) per feature, `text-[var(--primary)]`, strokeWidth 1.75; color emoji removed.
- `icon` field removed from `home.features[]` in en.json + ko.json and from the TS type.
- Roadmap status badge keeps the ✓ checkmark (functional); 📋 branch unused since planned rows were removed in WEB-009.
- Verify: `pnpm --filter robota-www build` + `typecheck` pass; lint shows only pre-existing Footer/Header warnings.
