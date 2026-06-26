---
title: 'BRAND-001: Unified brand palette + typography across web properties'
status: todo
created: 2026-06-26
priority: high
urgency: soon
area: apps/www, apps/docs
depends_on: []
---

# Unified brand palette + typography across web properties

## What

Define ONE brand design system (typography + color tokens) shared by both web
properties and apply it to both:

- **Typography:** IBM Plex Sans + IBM Plex Mono as the canonical type pair (already
  used on the docs site). Replace `apps/www`'s `system-ui`/`ui-sans-serif` default stack.
- **Accent:** define a single new accent color as a CSS variable and use it on both
  sites. Today the two properties diverge — docs uses neon-green `#00FF88`, www uses
  violet `#A78BFA`. Pick/define one unified accent (design proposal — confirm with user
  before applying; user chose "new unified palette" over adopting either existing one).
- Express the palette as CSS custom properties / Tailwind theme tokens so both apps
  consume the same source of truth (no scattered hardcoded hex).

## Why

The design review (2026-06-26) found the flagship marketing site (`www.robota.io`) reads
as a generic dark SaaS template while the docs site has stronger conviction. Two issues:

1. `system-ui` as the primary typeface is the "gave up on typography" signal and costs
   credibility for a developer tool.
2. Violet/purple accent is a recognized AI-slop signal; the two properties having
   different accents means there is no unified brand color.

## Findings addressed

- www primary font is `system-ui` (should be IBM Plex, matching docs).
- www accent `#A78BFA` (violet) vs docs accent `#00FF88` (neon-green) — no unified color.
- Hardcoded color values scattered rather than a shared token set.

## Done When

- A confirmed palette spec exists (typography + accent + neutral scale) as design tokens.
- `apps/www` and `apps/docs` both consume the shared tokens; no `system-ui` as primary
  body/display font on either site.
- `pnpm --filter robota-www build` and the docs build both pass.

## Test Plan

- Build both apps; confirm no type errors and fonts resolve.
- Grep both apps for stray hardcoded accent hex (`#A78BFA`, `#00FF88`) — should be gone
  or reduced to the token definition.

## User Execution Test Scenarios

1. Visit `https://www.robota.io` → body/headings render in IBM Plex (not system font);
   accent matches the confirmed unified color. Evidence: _to fill after implementation._
2. Visit the docs site → same typeface and accent token as www (brand-consistent).
   Evidence: _to fill after implementation._
