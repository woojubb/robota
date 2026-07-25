# Harness composition design — rules, skills, agents

> **Living document.** This is the current snapshot of how the harness is meant to be composed, not a
> record of one decision. Update it whenever the shape changes; date each revision in the log at the
> bottom so the reasoning stays traceable. Work items that apply it (e.g. `HARNESS-049`) come and go —
> this document stays.

## The three artifact kinds

| Artifact                                              | Owns                                                               | Must NOT contain                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| **Rule** (`.agents/rules/*.md`)                       | Invariants — "X must hold", "never Y" — and **who owns each fact** | Step-by-step procedure; role definitions           |
| **Orchestration skill** (`.agents/skills/*/SKILL.md`) | A pipeline: phases, ordering, gates, what to dispatch and when     | A role's judgement criteria; restated rule text    |
| **Agent definition** (`.claude/agents/*.md`)          | One role: charter, judgement criteria, tool scope, terminal signal | Pipeline ordering; knowledge of what runs after it |

**The boundary test.** If a skill explains _how to judge_, that content belongs in an agent file. If an
agent file explains _what runs next_, that belongs in the skill above it. If a rule explains _how_
rather than _what must hold_, it belongs in a skill.

## Orchestration nests

A phase of a high-level pipeline is frequently a pipeline in its own right. So an orchestration skill
may dispatch **other orchestration skills** as well as agents:

```
router skill            → routes to the right pipeline for the request
  └─ orchestration      → sequences phases; a phase may be another orchestration skill
       └─ orchestration → sequences that phase's own steps
            └─ agent    → does the actual role work (the leaf)
```

Nesting is **expected, not an exception**. Depth is whatever the work actually has. The invariant holds
at every level: each level carries **only its own ordering** — a parent never restates a child's steps,
and a child never knows what follows its parent's phase. Only leaves are agents.

## Why this shape

- **A rule that reads like a runbook cannot be enforced.** It can only be followed by whoever happens to
  read it — the "prose without a mechanism" failure this harness has hit repeatedly.
- **A role inlined in a skill cannot be reused.** Extracted into its own file, the same reviewer or
  auditor serves every pipeline that needs it. This is already proven here: every agent definition in
  `.claude/agents/` is dispatched by at least two skills, and the judge roles are the most reused.
- **A skill that carries judgement criteria drifts from the skills that copy it.** One role, one file,
  one owner — the same single-source discipline `AGENTS.md` applies to facts.

## Neutrality

A skill is **universal procedure**. Repo-specific facts — script names, branch names, item IDs,
baseline names, tool names — belong to the rule (or doc) that owns them and are **pointed at**, never
restated. `worktree-parallel-orchestration/SKILL.md` is the reference implementation of this after its
neutrality pass: it says "the project's CI-equivalent verification entry point", not a command name.

The line to hold: abstract enough to port, concrete enough to execute. Naming the _mechanism of the
procedure itself_ (the isolation primitive, the agent-dispatch call) is fine; naming _this repo's
plumbing_ is not. When a fact must stay concrete for the procedure to be runnable, say so explicitly
rather than leaving it implicit.

## Working agreements

- **Move, never duplicate.** When content relocates, the source loses it. Each fact keeps exactly one
  owner document.
- **No behavioral loss.** A mandatory constraint that becomes procedure must not lose force. Diff the
  invariants before/after and show each one's new home.
- **Incremental.** One rule, one skill, or one role at a time — each merged and verified.
- **Mechanically checked.** Anything a harness scan references must keep resolving: registered skills,
  agent-definition conventions, anchors. The scans are the floor, not the review.

## Open questions

- Is there a natural depth limit for nesting, or does it stay work-shaped? (No evidence yet either way —
  revisit once several nested pipelines exist.)
- Should the router level be a skill at all, or a rule that routes? Current answer: a skill, because
  routing is procedure — but this has not been stress-tested.
- Does an intermediate orchestration skill ever legitimately need judgement (e.g. choosing which phase to
  run)? If so, is that "ordering" or "judgement"? Not yet resolved.

## Revision log

| Date       | Change                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-26 | Created. Three-artifact split, boundary test, nesting, neutrality, working agreements — captured from the `HARNESS-049` framing and the `worktree-parallel-orchestration` neutrality pass. |
