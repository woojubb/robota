---
title: 'BRAND-001: Unified brand palette + typography across web properties'
status: in-progress
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

### Confirmed palette (user-approved 2026-06-26)

Chosen on intrinsic merit (not docs continuity) and applied to BOTH sites:

| Token             | Value                    | Use                                   |
| ----------------- | ------------------------ | ------------------------------------- |
| `--accent`        | `#2DD4A7` (emerald/teal) | primary CTA fill, links, prompt caret |
| `--accent-hover`  | `#25B492`                | hover/active                          |
| `--accent-subtle` | `rgba(45,212,167,0.12)`  | tints, badges, focus rings            |
| `--bg`            | `#0A0A0F`                | page background                       |
| `--surface`       | `#131320`                | cards/surfaces                        |
| `--text`          | `#E8E6F0`                | body text                             |
| `--text-muted`    | `#A7A795`                | secondary text                        |
| font (sans)       | IBM Plex Sans            | body + display                        |
| font (mono)       | IBM Plex Mono            | code, CLI snippets                    |

Accent contrast on `#0A0A0F` ≈ 8.9:1 (AAA). Replaces docs `#00FF88` and www `#A78BFA`.

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
   accent matches the confirmed unified color. Evidence: verified on the production
   build artifact (`apps/www/out`) served locally 2026-06-26 — `--accent` resolves to
   `#2dd4a7`, body/h1 `font-family` = "IBM Plex Sans", CTA buttons render emerald
   (screenshot `www-after.png`). Live-deploy confirmation pending CF Pages publish.
2. Visit the docs site → same typeface and accent token as www (brand-consistent).
   Evidence: verified on `apps/docs/out` served locally 2026-06-26 — `--accent`/`--primary`
   = `#2dd4a7`, body `font-family` = "IBM Plex Sans"; "Documentation"/"Get Started"/code
   highlights render emerald (screenshot `docs-after.png`). Live-deploy pending CF publish.
