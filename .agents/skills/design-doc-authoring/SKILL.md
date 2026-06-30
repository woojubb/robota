---
name: design-doc-authoring
description: Use when documenting a component's internal realization (LLD) — module breakdown, key flows, local trade-offs. Produces a design doc that satisfies the design/LLD document-type contract (RULE-009).
---

# Design Doc Authoring

Produces a design / LLD document that passes the design-doc document-type contract (`RULE-009`) and the
`check-design-doc-completeness.mjs` gate. A design doc owns a component's **internal realization** — not
its public contract (that is `SPEC.md`), not system relationships (architecture-map), not a single
architecturally-significant decision (ADR).

## Rule Anchor

- `.agents/specs/document-standards/index.md` — the artifact taxonomy + meta-form.
- `.agents/rules/learning-loop.md` — "Contract Before Automation".

## When is a design doc required? (process guidance — not a hard scan)

Write one when a component's internal realization is **non-trivial**:

- it has a state machine or non-obvious lifecycle;
- it orchestrates multiple modules / async flows;
- it implements a non-obvious algorithm or data structure;
- you are planning a substantial implementation and want the design reviewed first.

Skip it for simple components whose `SPEC.md` already says enough — a box-ticking design doc is noise.
The completeness gate validates the _structure_ of design docs that exist; it does not force one to
exist (that judgment is yours).

## Location

- **Package-local:** `packages/<pkg>/docs/design/<topic>.md` (English, beside the SPEC it realizes).
- **Cross-cutting (spans packages):** `.agents/specs/<topic>.md`.
- NOT `.design/` — that is for ADR / decision logs.

## Steps

1. **Copy the template** `.agents/templates/design-doc-template.md` to the location above.
2. **Write the MUST sections:** Context & Goal · Constraints · Internal Structure · Key Flows ·
   Test Approach.
3. **Link the owning `SPEC.md`** (recommended) and keep the public contract there — do not restate it.
4. **Escalate out of scope:** an architecturally-significant decision → an ADR; a system-relationship
   change → an architecture-map doc.
5. **Run the gate:** `pnpm harness:scan:design-doc`. Archive a stale design doc under
   `design/archive/` rather than letting it drift.

## What This Skill Does NOT Do

- Own the public package contract → `packages/*/docs/SPEC.md`.
- Record a single architecturally-significant decision → `architecture-decision-records`.
- Map system relationships → `architecture-map-authoring`.
