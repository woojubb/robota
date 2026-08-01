---
title: 'DOCS-021: finish Tailwind conversion of docs-site homepage/ToC inline styles'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: low
urgency: later
area: apps/docs
depends_on: []
---

# DOCS-021: docs-site inline-style debt

## Problem

DOCS-002 (#1332) converted Header/Sidebar/DocsLayout/Search/ThemeToggle to Tailwind, but pre-existing
inline `style` usage remains on the homepage and ToC components (flagged as follow-up in that PR) —
violating the Tailwind-only frontend rule.

## What

Convert the remaining inline styles to Tailwind utilities; delete any dead custom CSS uncovered.

## Test Plan

`pnpm --filter robota-docs build` fully green (311-page prerender + pagefind); grep floor: zero `style={{`
in `apps/docs/src` (excluding any documented dynamic-value exemptions).

## Outcome

All remaining inline styles converted to Tailwind utilities — grep floor is **zero** `style={{` hits in
`apps/docs/src`, with **no exemptions needed** (every value was static; per-type Callout colors became a
static class record, conditional ToC indent/active states became conditional class strings).

Files converted:

- `src/app/[locale]/[[...slug]]/page.tsx` (homepage hero, badge, quick-link cards, quick-install block)
- `src/components/TableOfContents.tsx` (sticky nav, label, links, active dot)
- `src/components/mdx/Callout.tsx`, `CodeBlock.tsx`, `MermaidDiagram.tsx`, `PackageManagerTabs.tsx`

Cascade fix uncovered and required: the `.prose` rules in `globals.css` were **unlayered**, so they beat
every Tailwind utility (which live in `@layer utilities`). The old inline styles out-ranked `.prose`; naive
utility conversion would have regressed (e.g. `.prose h1` 1.875rem beating the hero's 2.25rem) — and the
hero CTAs converted in #1332 were already affected (CTA text computed to `--primary` instead of
`--primary-foreground`). Fix: `.prose` block moved into `@layer components` (declared before `utilities`,
so utilities win — restoring inline-style precedence semantics). Shiki/pagefind blocks intentionally left
unlayered (conflict outcomes vs `.prose` unchanged: shiki already won all ties by source order).

Verification (agent-run): `pnpm --filter robota-docs build` green (314 static pages + pagefind, 311 indexed);
typecheck + `next lint` clean; all 59 harness scans pass; headless-browser computed-style audit on the
built export confirmed pixel-fidelity against the original inline values (homepage h1/badge/cards/install
pre, ToC nav/label/links, CodeBlock copy button, Mermaid container) and confirmed the CTA color fix.
No dead custom CSS found (all `globals.css` rules are live).
