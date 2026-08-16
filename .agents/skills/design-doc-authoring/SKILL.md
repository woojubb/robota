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

## Placement criterion — the consumer-impact test (owner of this fact)

"When is a design doc required?" above decides **whether** to write one. This section decides **what
goes in it** versus what belongs in the owning `SPEC.md`. This skill is the single owner of the
criterion; `spec-writing-standard` and `spec-workflow.md` link here and carry no copy.

> **Ask: is this fact part of what a consumer binds to — such that changing it would force code
> outside this package, or a person using the product, to change with it?**
> **Yes → `SPEC.md` (the contract). No → `docs/design/` (the secret).**

**It asks about the surface, not the headcount.** The question is conditional on there being a
consumer, which is what "contract" means — it is not "did anyone actually get broken". This
distinction is load-bearing **right now**: the project is pre-release with no published version, so a
literal "would anyone have to change?" is answered _no_ for every fact in the repository, and the whole
boundary collapses into `docs/design/`. A key binding is contract because it is the surface a person
types at, not because a bug report would arrive. Judge the fact's role, and the criterion keeps working
before the first user and after the millionth.

Do not use "what versus how". That test is unusable here, because one level's _how_ is the next
level's _what_ — the boundary is relative, so it decides nothing. Consumer impact is absolute: it
asks who is forced to change, which is answerable for any given fact.

| Fact                                                                             | Impact | Goes in                   |
| -------------------------------------------------------------------------------- | ------ | ------------------------- |
| Exported signatures, SSOT types                                                  | yes    | `SPEC.md`                 |
| Error codes, categories, recoverability                                          | yes    | `SPEC.md`                 |
| Externally observable event names and payloads                                   | yes    | `SPEC.md`                 |
| Extension points (abstract classes, callback signatures)                         | yes    | `SPEC.md`                 |
| **End-user-facing contract** (key bindings, terminal visual grammar, exit codes) | yes    | **`SPEC.md`** — see below |
| Module decomposition, file layout, internal helpers                              | no     | `docs/design/`            |
| _Internal_ state-machine transitions (observable states are contract)            | no     | `docs/design/`            |
| Render pipeline, caching strategy, algorithm choice                              | no     | `docs/design/`            |
| Why this decomposition was chosen (its motivation)                               | —      | `docs/design/`            |
| One architecturally-significant decision + rejected alternatives                 | —      | ADR                       |

**The consumer is not only code.** A terminal application's key bindings and visual grammar are a
contract whose consumer is a person. They read like presentation detail and are easy to mistake for
whitebox material, but they are what that person operates the product through — so they stay in
`SPEC.md`, under the optional `User-Facing Contract` section. Reading "consumer" as "calling code" is
the mistake this row exists to prevent.

**Recursion.** The test applies at whatever decomposition level you are documenting: a nested package
is a consumer boundary of its own, so a fact internal to a parent may be contract for a child.

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
