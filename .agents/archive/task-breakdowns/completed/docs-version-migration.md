---
title: Docs version migration (2.0.0 backup + 3.0.0 refresh)
status: completed
priority: high
created: 2026-03-20
---

# Docs Version Migration

## Goal

Two documentation directories exist with different roles:

- `docs/` — internal-only documents (plans, research, design specs). Not deployed to web.
- `content/` — web documentation source, consumed by `apps/docs/` VitePress build. Currently contains stale v2.0.0-era content.

The `content/` v2.0.0 documents need to be archived and replaced with v3.0.0 documentation.

## Current State

```
content/                    ← VitePress web docs source (STALE — v2.0.0 era)
├── api-reference/          ← Auto-generated API reference (v2 classes: SessionManager, ChatInstance, etc.)
├── development/            ← 14 dev guides
├── examples/               ← 20 examples
├── getting-started/
├── guide/                  ← Architecture, core concepts
└── README.md

docs/                       ← Internal-only (plans, research, design)
├── plans/                  ← 15 design/plan documents (2026-03-13~15)
└── superpowers/            ← plans, research, specs (2026-03-18~20)

apps/docs/                  ← VitePress build app
├── scripts/copy-docs.js    ← Copies content/ → .temp/, then packages/*/docs/
└── package.json
```

## Phases

### Phase 1: Archive v2.0.0 content

- Move all existing `content/` subdirectories to `content/v2.0.0/`
- Preserve directory structure (api-reference/, development/, examples/, guide/, getting-started/)

### Phase 2: Create v3.0.0 web docs

- Write new documentation directly in `content/` (no version subfolder for latest)
- Content should reflect current 3.0.0-beta architecture (10 packages audited, SPECs aligned)
- Include: architecture overview, getting started, package guide, migration notes
- API reference should be regenerated from current codebase

### Phase 3: Verify apps/docs build

- Run `pnpm --filter robota-docs build` to verify VitePress build works
- Verify copy-docs.js still functions with the new content structure

### Result Structure

```
content/
├── v2.0.0/              ← archived old web documents
│   ├── api-reference/
│   ├── development/
│   ├── examples/
│   ├── guide/
│   └── getting-started/
├── (new v3 docs here)   ← latest version, no subfolder
└── README.md

docs/                    ← internal only (unchanged)
├── plans/
└── superpowers/
```
