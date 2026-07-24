---
name: architecture-decision-records
description: Records architectural decisions with context, alternatives, and consequences using the ADR format. Use when making or reviewing significant design choices that affect multiple modules or packages.
---

# Architecture Decision Records (ADR)

## Rule Anchor

- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Build Requirements"

Write one ADR per decision when a design choice affects multiple packages or modules, or has 2+ viable
alternatives with real trade-offs. Accepted ADRs are immutable — supersede with a new ADR, never
edit. Section presence + Status values are mechanically enforced by
`scripts/harness/check-adr-completeness.mjs`; this skill owns the template.

## Location & Naming

- Location: `.design/decisions/`
- Naming: `ADR-NNN-short-title.md` (e.g., `ADR-001-runtime-event-prefix-system.md`)
- Status values: `proposed`, `accepted`, `superseded`, `deprecated`, `rejected`

## Template

```markdown
# ADR-NNN: Short Title

## Status

accepted | superseded by ADR-NNN | rejected

## Context

What is the problem or question? Why does it need a decision now?

## Alternatives Considered

1. **Option A**: description — pros / cons
2. **Option B**: description — pros / cons

## Decision

Which option was chosen and why.

## Consequences

- What becomes easier or possible.
- What becomes harder or impossible.
- What follow-up work is needed.

## References

- Related ADRs, specs, or rule anchors.
```
