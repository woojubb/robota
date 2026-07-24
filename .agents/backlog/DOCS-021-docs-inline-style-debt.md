---
title: 'DOCS-021: finish Tailwind conversion of docs-site homepage/ToC inline styles'
status: todo
created: 2026-07-25
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
