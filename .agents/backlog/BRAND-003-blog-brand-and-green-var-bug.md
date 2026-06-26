---
title: 'BRAND-003: Unify apps/blog brand + fix undefined --green CSS variable'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: apps/blog
depends_on: [BRAND-001]
---

# Unify apps/blog brand + fix undefined --green CSS variable

## What

`apps/blog` (Astro) has two issues:

1. **Rendering bug:** `Base.astro` / `BlogPost.astro` reference `var(--green)` (~13×) and
   `var(--green-bg)` (2×), but `src/styles/global.css` never defines them (README cites a
   `#39ff85` green accent). The browser drops the undefined var, so the green accent is
   broken. Define the variables — using the unified emerald token, not a one-off green.
2. **Brand divergence:** `global.css` sets `--brand: #a78bfa` (violet) + JetBrains Mono /
   Noto Sans KR. Align to the unified emerald `#2dd4a7` + IBM Plex pair.
3. **a11y:** the theme toggle is a non-semantic `<span>` with a click handler (no
   `<button>`, `role`, `aria-label`, or keyboard support) — make it a real button.

## Why

Brand consistency across robota.io properties, plus a concrete rendering bug (undefined
CSS var) and an inaccessible control.

## Done When

- `--green`/`--green-bg` are defined (or replaced by the emerald token); the accent renders.
- Blog uses the emerald palette + IBM Plex; no `#a78bfa` / undefined-var references.
- Theme toggle is a keyboard-accessible `<button>` with an `aria-label`.
- Blog build passes.

## Test Plan

- Build blog; grep for `var(--green` with no matching definition → resolved.
- Keyboard-tab to the theme toggle and activate with Enter/Space.

## User Execution Test Scenarios

1. Open the blog → green/accent elements render (not unstyled); palette matches the SDK
   brand; the theme toggle works via keyboard. Evidence: _to fill._
