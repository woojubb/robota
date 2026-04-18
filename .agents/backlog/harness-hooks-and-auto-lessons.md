# Harness Auto Lessons Pipeline (Phase C)

> **Phase B completed** — PR #92 (`feat(harness): PreToolUse hook blocking any/console/try-catch-fallback`).
> This backlog item now covers Phase C only: auto-lessons signal collection and aggregation.

## What

Automatically collect lesson-learned signals from Phase B hook events into a curated pipeline that feeds a separate `auto-lessons.md` register, preserving the human-curated `common-mistakes.md` as a high-quality SSOT.

## Why

Current enforcement is reactive (CI scans, post-commit review). Recurring mistakes in `common-mistakes.md` (29 patterns) are detected late. A real-time guardrail + a learning loop is needed so that:

- Known mistake patterns are **blocked before** they reach the commit boundary.
- Failure signals (blocked edits, user corrections, revert/fix cycles) are **captured automatically** rather than relying on manual lesson logging.
- The human-curated register stays clean; auto-collected signals live in a separate file to avoid signal-to-noise degradation.

## Design Decisions (locked)

| Topic        | Decision                                                               | Rationale                                                                 |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Merge policy | Separate `auto-lessons.md`; `common-mistakes.md` remains human-curated | Append-only memory degrades signal-to-noise; human SSOT must be protected |

## Signal Collection

### Signal collectors (fully automatic)

| Hook                                        | Signal                                                                                                       | Sink                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `PreToolUse` Edit\|Write (from Phase B)     | Blocked pattern event `{ pattern, file, escape_attempted }`                                                  | `.agents/evals/harness-log/blocks.jsonl` |
| `UserPromptSubmit`                          | Correction keywords (`아니`, `틀렸`, `그거 말고`, `다시`, `하지 마`, `no, …`) + previous assistant turn hash | `corrections.jsonl`                      |
| `Stop` (new: `revert-detect.sh`)            | Same file edited ≥ 3 times, `git revert`/`fix:` commits in session, repeated tool errors                     | `reverts.jsonl`                          |
| `Stop` (extend existing `eval-log-stop.sh`) | Add `blocks_total`, `corrections_total`, `reverts_total` to `sessions.jsonl`                                 | `sessions.jsonl`                         |

### Aggregation & promotion

| Artifact                      | Trigger                                                                                         | Output                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm harness:lessons:digest` | Stop hook (idempotent, once per session)                                                        | `.agents/evals/lessons/weekly-digest.md` — last 7 days signal summary |
| `auto-lessons.md`             | Digest script appends when a pattern crosses threshold (e.g. same pattern ≥ 5 events in 7 days) | Separate register; NEVER touches `common-mistakes.md`                 |
| Manual promotion              | Human PR                                                                                        | Move/condense entry from `auto-lessons.md` → `common-mistakes.md`     |

### Directory layout

```
.agents/evals/
├── harness-log/
│   ├── sessions.jsonl            (existing, extend)
│   ├── blocks.jsonl              (new)
│   ├── corrections.jsonl         (new)
│   └── reverts.jsonl             (new)
└── lessons/
    ├── weekly-digest.md          (auto-generated)
    └── auto-lessons.md           (auto-appended, separate from common-mistakes.md)
```

## Acceptance Criteria

- [ ] `blocks.jsonl`, `corrections.jsonl`, `reverts.jsonl` append-only files created and populated during real sessions.
- [ ] `pnpm harness:lessons:digest` regenerates `weekly-digest.md` idempotently.
- [ ] Auto-threshold (≥ 5 events / 7 days per pattern) produces an `auto-lessons.md` entry with: pattern id, frequency, example file paths, first/last seen.
- [ ] `common-mistakes.md` is never written by any automated script (verified by test).
- [ ] Session summary in `sessions.jsonl` contains `blocks_total`, `corrections_total`, `reverts_total`.

## Risks & Mitigations

| Risk                                                                    | Mitigation                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| False positives over-block real work                                    | Escape comment mechanism; warn-only first for 2 weeks if needed                            |
| Self-reinforcing error (agent avoids correct paths due to stale lesson) | Auto-lessons live in separate file; `common-mistakes.md` promotion requires human review   |
| Over-generalization (lesson applied outside original context)           | Each auto-lesson entry stores source context (file, session, reason); digest shows recency |
| Hook script drift / silent failure                                      | `harness:self-check` extended to exercise each hook with a fixture                         |

## References

### Claude Code hook semantics

- [Hooks reference — Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [190 Things Claude Code Hooks Cannot Enforce (And What to Do Instead) — DEV](https://dev.to/boucle2026/what-claude-code-hooks-can-and-cannot-enforce-148o)
- [Claude Code Hook Control Flow — Steve Kinney](https://stevekinney.com/courses/ai-development/claude-code-hook-control-flow)
- [Block Tool Commands Before Execution with PreToolUse Hooks — egghead.io](https://egghead.io/block-tool-commands-before-execution-with-pre-tool-use-hooks~erv55)
- [Claude Code Hooks: Guardrails That Actually Work — paddo.dev](https://paddo.dev/blog/claude-code-hooks-guardrails/)

### Agent learning / reflection theory

- [Reflexion: autonomous agent with dynamic memory and self-reflection — Shinn & Labash](https://www.semanticscholar.org/paper/Reflexion:-an-autonomous-agent-with-dynamic-memory-Shinn-Labash/46299fee72ca833337b3882ae1d8316f44b32b3c)
- [Reflexion — Prompt Engineering Guide](https://www.promptingguide.ai/techniques/reflexion)
- [Experiential Reflective Learning for Self-Improving LLM Agents (ERL) — arXiv 2603.24639](https://arxiv.org/html/2603.24639v2)

### Memory hygiene

- [I Ran 500 More Agent Memory Experiments — DEV](https://dev.to/marcosomma/i-ran-500-more-agent-memory-experiments-the-real-problem-wasnt-recall-it-was-binding-24kc)
- [How Memory Management Impacts LLM Agents — arXiv 2505.16067](https://arxiv.org/html/2505.16067v2)

## Promotion Path

1. Assign backlog ID (e.g. HARNESS-BL-001) → move to `.agents/tasks/<ID>-harness-auto-lessons.md`.
2. Branch: `feat/harness-auto-lessons` (create at implementation time).
