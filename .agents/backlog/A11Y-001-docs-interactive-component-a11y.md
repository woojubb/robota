---
title: 'A11Y-001: Accessible names + non-color state on docs interactive components'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: apps/docs
depends_on: []
---

# Accessible names + non-color state on docs interactive components

Distinct from DOCS-002 (docs **landing-page** semantics/tap-targets) — these are
**interactive-component** a11y defects in the docs app, found 2026-06-27.

## What

1. **`Sidebar.tsx` toggle buttons (≈ lines 34, 64-73, 121, 151-160).** Expand/collapse
   `<button>`s have no `aria-label`/`title`; state is shown only by a rotated `▶`. Add
   `aria-expanded` + an accessible label so screen readers can identify and operate them.
2. **`TableOfContents.tsx` active dot (≈ lines 95-107).** Active section is a colored `span`
   with no text/`aria` — color-only state (WCAG 1.4.1). Add a non-color cue / `aria-current`.
3. **`mdx/PackageManagerTabs.tsx` (≈ lines 41-60).** Tab buttons show active state by
   underline only, with no `role="tab"`/`aria-selected`. Add proper tab semantics.
4. **`mdx/MermaidDiagram.tsx` (≈ lines 82-95).** The rendered-SVG container has no
   `aria-label`/text alternative (WCAG 1.1.1). Add a descriptive label/role.

(Blog theme-toggle a11y is owned by BRAND-003 — excluded here.)

## Why

These are keyboard/screen-reader and colorblind blockers on the docs reading experience that
the landing-focused DOCS-002 did not touch. They're concrete WCAG 1.1.1 / 1.4.1 / 4.1.2
failures with named fixes.

## Done When

- Each listed control exposes an accessible name and (where stateful) `aria-expanded` /
  `aria-current` / `aria-selected`.
- The active-section indicator no longer relies on color alone.
- The Mermaid container has a text alternative/label.
- Docs build passes; a quick a11y pass on the affected components shows named roles/states.

## Test Plan

- Devtools accessibility tree on a docs page: sidebar toggles, TOC, package-manager tabs, and
  a Mermaid diagram all expose names + states.
- Keyboard-only: toggles operable and announce expanded/collapsed.

## User Execution Test Scenarios

1. Navigate a docs page with a screen reader → sidebar toggles announce expand/collapse state,
   the package-manager tabs announce the selected tab, and diagrams have a label. Evidence:
   _to fill._
