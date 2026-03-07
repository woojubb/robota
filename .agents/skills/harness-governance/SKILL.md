---
name: harness-governance
description: Governs the Robota harness by checking rule-skill-owner consistency, finding undefined terminology, spotting examples that violate rules, and preferring mechanical checks over duplicated prose. Use when editing AGENTS, skills, or repository guidance.
---

# Harness Governance

## Rule Anchor
- `AGENTS.md` > "Rules and Skills Boundary"
- `AGENTS.md` > "Owner Knowledge Policy"
- `AGENTS.md` > "Harness Direction"

## Use This Skill When
- Editing `AGENTS.md`.
- Adding, removing, or revising skills under `.agents/skills/`.
- Changing owner documents, ADRs, or guidance that other skills depend on.
- Reviewing documentation drift or policy contradictions.

## Preconditions
- Identify the changed rule, skill, or owner files.
- Identify the `AGENTS.md` sections a skill or owner document depends on.
- Identify whether the change should become a mechanical check instead of more prose.

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
6. If the invariant is important and repeated, propose or add a mechanical scan instead of expanding prose.
7. Summarize:
   - anchor validity
   - contradictions found
   - rule-violating examples found
   - candidate checks to automate

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

## Related Harness Commands
- Current: `pnpm harness:scan`, `pnpm harness:scan:consistency`, `pnpm harness:scan:specs`, `rg`-based consistency scans
