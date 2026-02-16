---
name: architecture-decision-records
description: Records architectural decisions with context, alternatives, and consequences using the ADR format. Use when making or reviewing significant design choices that affect multiple modules or packages.
---

# Architecture Decision Records (ADR)

## Rule Anchor
- `.cursor/rules/development-architecture-rules.mdc`
- `.cursor/rules/build-and-resolution-rules.mdc`

## Use This Skill When
- A design choice affects multiple packages or modules.
- There are two or more viable alternatives with meaningful trade-offs.
- A Gate checkpoint is being passed.
- A previous decision needs to be revisited or superseded.
- Onboarding requires understanding "why was this done this way?"

## Core Principles
1. One ADR per decision (not per feature or per meeting).
2. Immutable once accepted; superseded by a new ADR, never edited.
3. Lightweight: short context, clear decision, concrete consequences.
4. Stored in version control alongside code.

## File Convention
- Location: `.design/decisions/`
- Naming: `ADR-NNN-short-title.md` (e.g., `ADR-001-dag-event-prefix-system.md`)
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
3. **Option C**: description — pros / cons

## Decision
Which option was chosen and why.

## Consequences
- What becomes easier or possible.
- What becomes harder or impossible.
- What follow-up work is needed.

## References
- Related ADRs, specs, or rule anchors.
```

## Workflow
1. Identify that a decision is being made (not just an implementation detail).
2. Write the ADR using the template above.
3. Review: does the decision align with existing rules and principles?
4. Merge the ADR file into the repository.
5. When a decision is superseded, create a new ADR and mark the old one as `superseded by ADR-NNN`.

## Checklist
- [ ] Context clearly states the problem, not just the solution.
- [ ] At least two alternatives are documented with trade-offs.
- [ ] Decision states the chosen option and the primary reason.
- [ ] Consequences include both positive and negative impacts.
- [ ] ADR is stored in `.design/decisions/` with correct naming.
- [ ] Related Gate checkpoints reference the ADR.

## Anti-Patterns
- Recording trivial implementation details as ADRs.
- Editing accepted ADRs instead of superseding them.
- Writing ADRs after the fact without reconstructing alternatives.
- ADRs that describe "what" without "why".
- No ADR for Gate-level decisions.
