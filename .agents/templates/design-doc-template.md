<!--
Design / LLD document template (RULE-009 / design-doc document-type contract).
Copy to `packages/<pkg>/docs/design/<topic>.md` (package-local) or `.agents/specs/<topic>.md`
(cross-cutting). English. Delete this comment.

MUST sections (blocking — enforced by check-design-doc-completeness.mjs):
  Context & Goal · Constraints · Internal Structure · Key Flows · Test Approach
SHOULD: link to the owning SPEC.md; Alternatives / Trade-offs; Open Questions.

Altitude: this doc owns the component's INTERNAL REALIZATION. The public contract is the SPEC.md
(link, do not restate); architecturally-significant decisions are ADRs; system relationships are
architecture-map docs. See `design-doc-authoring` for the "when required" policy.
-->

# <Component> Design

Realizes [`<pkg>` SPEC](../SPEC.md). <!-- recommended owner pointer -->

## Context & Goal

<Which component, which SPEC contract it realizes, what problem this design solves.>

## Constraints

<From the SPEC + NFRs: performance, concurrency, compatibility, platform.>

## Internal Structure

<Modules/classes and their responsibilities — a table or diagram.>

| Module / class | Responsibility |
| -------------- | -------------- |
|                |                |

## Key Flows

<The important sequence / state / data flow — numbered steps or a mermaid diagram.>

## Test Approach

<How this design is verified: unit/functional layers, key cases, scenario coverage.>

## Alternatives / Trade-offs

<Local trade-offs. Escalate architecturally-significant decisions to an ADR.>

## Open Questions

<Unresolved points, if any.>
