---
title: Docs version migration (2.0.0 backup + 3.0.0 refresh)
status: backlog
priority: high
created: 2026-03-20
---

# Docs Version Migration

## Goal

The `docs/` directory contains plans and research documents from the v2→v3 transition period. These need to be:

1. Verified that they accurately represent the v2.0.0-era architecture
2. Backed up into a `docs/v2.0.0/` archive folder
3. A new `docs/v3.0.0/` folder created with fresh documentation reflecting the current 3.0.0-beta architecture

## Current State

```
docs/
├── plans/           ← 15 design/plan documents (2026-03-13 ~ 2026-03-15)
└── superpowers/
    ├── plans/       ← 2 plans (agents decomposition, CLI MVP)
    ├── research/    ← 4 research docs (Claude Code, CJK input, context mgmt)
    └── specs/       ← 2 specs (agents decomposition, CLI design)
```

All documents are from the v2→v3 refactoring period. Most describe the transition plan, not the final v3 state.

## Phases

### Phase 1: Verify v2.0.0 accuracy

- Read each document and confirm it describes v2.0.0-era architecture
- Flag any documents that already describe v3.0.0 features (these belong in v3.0.0)
- Classify: v2.0.0 archive / v3.0.0 relevant / transition (both)

### Phase 2: Archive to v2.0.0

- Create `docs/v2.0.0/` and move verified v2.0.0 documents there
- Preserve directory structure (plans/, superpowers/)

### Phase 3: Create v3.0.0 docs

- Create `docs/v3.0.0/` with fresh documentation
- Content should reflect current architecture (10 packages audited, SPECs aligned)
- Include: architecture overview, getting started, package guide, migration guide from v2
