---
title: 'WEB-017: www accessibility pass — focus-visible, icon labels, subpage tap targets'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: apps/www
depends_on: []
---

# www accessibility pass

## What

The design review covered the homepage; the rest of `apps/www` has a11y gaps:

1. **No visible focus indicator.** `globals.css` has hover states but no `:focus-visible`
   ring on links/buttons — keyboard users can't see focus (WCAG 2.4.7). Add a global
   `:focus-visible` outline/ring using the accent token.
2. **Icon/symbol-only elements lack accessible names.** Roadmap page renders bare `✓`/
   `→`/`·` in spans; the compare page's `Check()`/`Cross()` render `✓`/`✗` with no label.
   Add `aria-label`/`sr-only` text (e.g. "supported"/"not supported"/"done").
3. **Subpage tap targets.** Compare/showcase/enterprise/roadmap/beta CTAs use varied
   padding and don't consistently meet the 44px floor that Header/Footer enforce. Bring
   primary controls to ≥44px.

## Why

Accessibility is a recurring requirement; keyboard focus and screen-reader labelling are
baseline WCAG items the subpages currently fail.

## Done When

- A visible `:focus-visible` indicator on all interactive elements.
- Symbol/icon-only elements have accessible names.
- Subpage primary controls meet ≥44px.
- www build passes; a quick audit shows 0 unlabeled icon controls and focus rings present.

## Test Plan

- Keyboard-tab through each page → visible focus on every control.
- Re-run the touch-target audit on subpages; grep for icon spans without `aria-label`.

## User Execution Test Scenarios

1. Tab through home + each subpage with no mouse → focus is always visible; a screen
   reader announces meaningful names for the ✓/✗/→ controls. Evidence: _to fill._
