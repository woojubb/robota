---
title: 'DOCS-002: Docs landing structure, nav crowding, and a11y/SEO fixes'
status: done
created: 2026-06-26
completed: 2026-07-24
priority: medium
urgency: soon
area: apps/docs
depends_on: [DEPLOY-001]
---

# Docs landing structure, nav crowding, and a11y/SEO fixes

## What

Cluster of smaller defects on the docs landing (`robota.io`):

- **Semantic structure:** the page has 0 `<section>` elements and only one `<h1>`, no
  `<h2>`/`<h3>`. The "Getting Started / Guide / Packages …" cards are not headings. Mark
  up sections and card titles semantically (improves a11y and SEO/AEO).
- **Empty "Guide" card:** the second hero card shows only the title "Guide" with no
  description, while "Getting Started" has body copy. Add the missing description (or
  remove the empty card).
- **Top-nav crowding:** logo + 8 nav items + search + theme + language + GitHub +
  "← robota.io" overflow the bar. The GitHub link renders as a blank/empty box (missing
  icon — likely tied to the homepage 404s). Restore the icon and reduce crowding.
- **Touch targets:** 25 interactive elements `< 44px`.
- **Console 404s:** 7+ failed resource loads on the docs homepage.

Note: the self-referential "← robota.io" link is owned by [[DEPLOY-001]].

## Why

Design review (2026-06-26): weak document semantics hurt accessibility and search
indexing; the empty card and blank GitHub icon read as unfinished; crowded nav and tiny
tap targets hurt usability.

## Findings addressed

- 0 sections / 1 h1 / 0 h2-h3 semantic structure.
- Empty "Guide" hero card.
- Blank GitHub icon in top nav + nav crowding.
- 25 touch targets `< 44px`; 7+ console 404s.

## Done When

- Sections and card titles use semantic landmarks/headings.
- No empty hero card; GitHub icon renders.
- No homepage console 404s; primary tap targets ≥44px.
- Docs build passes.

## Test Plan

- Re-audit headings (≥1 h1, h2/h3 present) and `<section>` count.
- Console shows no resource 404s; touch-target audit count → 0 for primary controls.

## Progress (2026-06-26)

- **Semantic structure (done):** quick-links wrapped in a `<section aria-labelledby>`
  with an `<h2>` "Explore the docs"; card titles are now `<h3>`. Verified on the build:
  sections 0→1, h1 1, h2 0→1, h3 0→6 (proper h1→h2→h3 hierarchy).
- **Console 404s (done):** the RSC `.txt?_rsc` prefetch 404s are removed via
  `prefetch={false}` on the docs `<Link>` (Header + Sidebar). The
  `pagefind/pagefind.js` 404 is also fixed: pagefind was never a dependency and the
  `postbuild` hook never ran (pnpm disables pre/post scripts by default). Added
  `pagefind` as a devDependency and chained it into `build`
  (`next build && pagefind --site out`); the build now indexes the site (175 pages,
  17.4k words) and emits `out/pagefind/pagefind.js`.
- **Empty "Guide" card:** false positive — the card has a description; it was a
  truncated-viewport artifact in the original review. No change.
- **GitHub icon:** the SVG is present and renders in the current build; the live
  "blank box" was a stale deployment.
- **Touch targets (residual):** docs nav/sidebar still has sub-44px links — deferred as
  a lower-priority follow-up within this item.

## Progress (2026-07-24) — remaining scope closed

- **Touch targets (done):** every visible header control (logo, 6 nav links, search, theme,
  language, GitHub) and both hero CTAs now measure exactly 44px (`min-h-11`/`min-w-11`);
  browser audit on the built site → 0 controls under 44px. Sidebar rows keep desktop
  density (36px) but grow to 44px on touch devices via `pointer-coarse:min-h-11`.
- **Nav crowding (done):** the "← robota.io" back link is now `hidden xl:inline-flex`
  (wide screens only) and the Search button collapses to icon-only below `lg`; the nav
  itself stays scrollable and hides under `md` (hamburger + sidebar covers it).
- **Sidebar 404s fixed (found during this pass):** every sidebar link was locale-less
  (`/getting-started/` instead of `/en/getting-started/`) and returned live 404s
  (verified: `https://docs.robota.io/getting-started/` → 404). `buildSidebar` now
  locale-prefixes all hrefs; all sampled links resolve 200 on the built site. This also
  un-broke active-row detection (plus a trailing-slash normalization for
  `trailingSlash: true`), so `aria-current="page"` now renders in both the header nav
  and the sidebar.
- **A11y additions:** "Skip to content" link (first focusable, targets `#docs-content`),
  `<nav aria-label="Documentation">` landmark around the sidebar tree, visible
  `:focus-visible` outline on all interactive elements, decorative SVGs/arrows marked
  `aria-hidden`, clearer language-toggle label.
- **Styling rule compliance:** Header, Sidebar, DocsLayout, SearchButton, ThemeToggle and
  the hero CTAs converted from inline `style` to Tailwind utilities; the `<style>` block
  in DocsLayout and the dead `.nav-link`/`.sidebar-item-*`/`.docs-header-line` custom
  classes in globals.css were removed. (Remaining inline styles on the homepage/ToC are a
  pre-existing debt outside this item's defect list.)

## User Execution Test Scenarios

1. Open `https://robota.io` → every hero card has a title and description; the GitHub icon
   is visible; console shows no 404s. Evidence (agent-run, 2026-07-24, Playwright against
   the built static export served locally — the same artifact CF Pages deploys): all 6
   quick-link cards render `<h3>` title + description; GitHub SVG present; homepage
   console 0 errors / 0 warnings; all 21 network requests (chunks, CSS, fonts, pagefind)
   returned 200.
2. Run a quick a11y/heading check (e.g. devtools accessibility tree) → page has a single
   h1 and section headings. Evidence (agent-run, 2026-07-24, browser evaluate on the
   built homepage): sections 1, h1 1, h2 1, h3 6; nav landmarks "Main navigation" +
   "Documentation"; skip link present; 13/13 visible primary controls ≥ 44px (0 under).
   Sidebar navigation: 21 links, all `/en/…`-prefixed, sampled links resolve 200, and
   `aria-current="page"` set on the active header + sidebar entries.
