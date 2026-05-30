---
title: 'PM-002: Why Robota comparison page'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: high
urgency: now
area: apps/docs, content/
depends_on: []
---

## Background

New users asked "why use this instead of Claude Code?" but no comparison existed anywhere in the docs.

## Changes Made

- Created `content/compare/README.md` — full comparison page with:
  - Feature matrix: Robota vs Claude Code, Cursor, Aider, Cline
  - Cost comparison table with monthly estimates
  - 5 key differentiator sections (multi-provider, embeddable SDK, MIT, local model, no subscription)
  - "When to choose something else" section for honest guidance
  - Quick Start block with `npx @robota-sdk/agent-cli`
- Added "Why Robota" nav item to `apps/docs/.vitepress/config/en.js` → `/compare/`
- Updated `content/README.md` comparison table to include Cursor/Aider/Cline and added link to full page

## Test Plan

- Page renders at `/compare/` when docs site is built
- Nav item visible on all pages

## User Execution Test Scenarios

Not applicable — documentation/marketing page.
