---
title: 'WEB-015: Centralize brand color tokens; remove dead --accent-hover'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: soon
area: apps/www, apps/docs
depends_on: []
---

# Centralize brand color tokens; remove dead --accent-hover

Follow-up from the code review of BRAND-001.

## What

1. **Hardcoded brand literals (altitude).** After centralizing `--accent`/`--primary` as
   CSS variables, ~19 literal copies of `#2dd4a7` / `rgba(45,212,167,…)` remain across 7
   files (`MermaidDiagram.tsx`, `PackageManagerTabs.tsx`, `DocsLayout.tsx`, the two
   landing `page.tsx`, etc.). The brand has changed twice and each change re-ran a 7-file
   hunt-and-replace. Where possible, reference the CSS var (or `color-mix()` of it for the
   alpha variants); for JS contexts (Mermaid `themeVariables`) read from one shared
   brand-token source instead of a literal.
2. **Dead `--accent-hover` (`apps/www/globals.css`).** `--accent-hover: #25b492` and its
   `@theme` mapping `--color-accent-hover` were added but are referenced nowhere — Tailwind
   v4 emits an unused utility and the token misleads readers into thinking a hover state
   exists. Either wire it into the intended hover styles (e.g. CTA `:hover`) or remove it.

## Why

Code review (2026-06-27): brand color is only half-tokenized — literals scattered across
components drift on the next brand change; the unused hover token is dead surface.

## Done When

- No hardcoded `#2dd4a7`/`45,212,167` literal where a token/`color-mix` reference is
  feasible; JS theme colors read from one source.
- `--accent-hover` is either consumed or removed.
- `apps/www` and `apps/docs` builds pass; brand still renders emerald.

## Test Plan

- Grep for stray brand literals after the change.
- Build both apps; spot-check the accent renders unchanged.

## User Execution Test Scenarios

1. Visit www + docs → accent still emerald; (if `--accent-hover` kept) the CTA hover uses
   it. Evidence: _to fill._

## Resolution (2026-06-27)

- Dead `--accent-hover` **wired** (not removed): all primary CTAs swapped
  `hover:opacity-90` → `hover:bg-[var(--accent-hover)]`, so the token is live.
- `*-dim`/`*-glow` tokens and component inline-style literals now derive from the
  accent via `color-mix(in srgb, var(--accent) N%, transparent)` / `var(--accent)`
  (www + docs globals.css, DocsLayout, PackageManagerTabs, docs/www landing glows).
  A future brand change is now a single edit to `--accent`/`--primary`.
- Mermaid `themeVariables` keep literal colors (Mermaid resolves them into the SVG at
  config time and can't read CSS vars) — documented as an explicit exception.

Both www + docs builds pass; `--accent-dim` resolves to color-mix(var(--accent)); accent
still renders emerald.
