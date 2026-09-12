---
name: harness-governance
description: Audit AGENTS, skills, and repository guidance for clear routing, single ownership, contradictions, and enforceable invariants.
---

# Harness Governance

## Rule Anchor

- `AGENTS.md` > "Document Discovery Policy"
- `AGENTS.md` > "Rules and Skills Boundary"
- `AGENTS.md` > "Owner Knowledge Policy"

## Use This Skill When

- Editing `AGENTS.md`.
- Adding, removing, or revising skills under `.agents/skills/`.
- Changing owner documents, ADRs, or guidance that other skills depend on.
- Reviewing documentation drift or policy contradictions.

## Preconditions

- Identify the changed rule, skill, or owner files.
- Identify the `AGENTS.md` sections a skill or owner document depends on.
- Identify whether the change should become a mechanical check instead of more prose.
- Inventory sibling skill names and descriptions before changing a selection boundary.

## Execution Steps

1. Map each changed skill to its `AGENTS.md` anchors.
2. Check that every anchor points to a real `AGENTS.md` section.
3. Scan for undefined rule-level terminology introduced only in a skill.
4. Scan for examples that teach forbidden patterns:
   - unchecked casts for external data
   - implicit fallback logic
   - hierarchy-implying agent naming
   - blanket dynamic import guidance that contradicts repository policy
5. Remove duplicated policy text when the rule already exists in `AGENTS.md`.
6. Audit the instruction-selection surface:
   - A description says what the skill does and the task boundary that activates it.
   - Workflow steps, implementation details, history, and exhaustive exclusions stay out of descriptions.
   - Sibling descriptions are distinguishable without loading their bodies.
7. Audit progressive disclosure:
   - `AGENTS.md` routes by task instead of requiring broad pre-reading.
   - A multi-mode skill keeps shared decisions in `SKILL.md` and routes conditional detail to focused
     references or scripts.
   - A narrow skill stays self-contained; do not add a router or reference hierarchy without a real branch.
   - Preserve exact sequences only where safety, permissions, or a fragile protocol makes deviation risky.
8. Remove model-specific handholding that duplicates capabilities, but keep model-independent safety,
   authorization, repository, and verification boundaries.
9. If the invariant is important and repeated, propose or add a mechanical scan instead of expanding prose.
   Do not replace selection clarity with an arbitrary character-count check.
10. Summarize:
    - anchor validity
    - contradictions found
    - rule-violating examples found
    - description overlap and instruction-loading findings
    - candidate checks to automate

## Introducing a Mechanical Guard — Scope Discipline

When you add a mechanical guard (a scan/check that enforces an invariant):

1. **Declare its scan scope explicitly** — which paths/packages/tokens the guard inspects — in the guard
   script and in the skill/rule that owns it. A guard with an implicit or unstated scope is a defect.
2. **Capture out-of-scope findings as a backlog.** If the guard surfaces a real problem outside its
   declared scope, file it as a backlog item (`.agents/spec-docs/`); do NOT silently widen the guard to
   cover it, and do NOT drop the finding.
3. Widening the guard's scope is itself a change that needs its own justification — handle it deliberately,
   not as a side effect of an unrelated run.
4. **Assert the relation, not a proxy for it.** A guard must verify the actual relation it claims to
   enforce — a dependency _edge_, a contract _shape_, a direction, a round-trip — not merely that a
   referenced _name/token exists_. Token-existence checks give false confidence: a doc can name real
   packages while stating a dependency edge that does not exist, and two differently-named contracts can be
   structurally identical while every name-level check passes. If the true relation is hard to check
   mechanically, either check the closest verifiable proxy **and say so explicitly** (state what it does and
   does not catch), or record the gap as a backlog item — never let a name-existence pass masquerade as
   relation conformance. When a guard's stated intent and its actual scan target diverge (e.g. the docstring
   names one package but the code scans another), that is itself a defect to fix.

## Stop Conditions

- A skill anchor points to a missing `AGENTS.md` section.
- A skill introduces new rule-level terminology without an owner definition.
- A skill example violates repository rules.
- The same policy is duplicated in multiple places with different wording.

## Checklist

- [ ] Changed skills point to real `AGENTS.md` anchors.
- [ ] No new undefined rule terminology is introduced.
- [ ] Examples do not violate repository rules.
- [ ] Duplicated policy prose is reduced where possible.
- [ ] Skill descriptions state a discriminating activation boundary without workflow detail.
- [ ] Sibling skills remain distinguishable from descriptions alone.
- [ ] Conditional detail is loaded only by the workflow branch that needs it.
- [ ] Safe flexibility is preserved; fragile safety and permission protocols remain explicit.
- [ ] Repeated invariants are considered for automation.

## Focused Examples

```bash
rg -n '^## ' AGENTS.md
rg -n "main agent|sub-agent|parent-agent|child-agent" .agents/skills AGENTS.md
rg -n "fallback to|temporary workaround|Path-Only" .agents/skills AGENTS.md
```

```bash
rg -n "as any|as unknown as|obj as " .agents/skills
rg -n "await import\\(" .agents/skills AGENTS.md
```

## Anti-Patterns

- Treating skills as a second rulebook.
- Leaving stale anchors after renaming `AGENTS.md` sections.
- Adding more prose when a simple scan would enforce the invariant better.
- Keeping examples that contradict the written rule because they are "just illustrative".
- Putting the skill's itinerary, internal agents, or historical rationale in its selection description.
- Requiring every task to read a document because some tasks need it.
- Turning a description-length proxy into a substitute for testing routing clarity.

## Related Harness Commands

- Current: `pnpm harness:scan`, `pnpm harness:scan:consistency`, `pnpm harness:scan:specs`, `rg`-based consistency scans
