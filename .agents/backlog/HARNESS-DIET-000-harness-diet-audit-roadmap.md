---
title: 'HARNESS-DIET-000: harness diet — audit roadmap (rules / skills / hooks / scans / agents / routing)'
status: todo
created: 2026-07-23
priority: high
urgency: soon
area: .agents/rules, .agents/skills, .claude/hooks, .claude/agents, scripts/harness, .github/workflows, AGENTS.md
depends_on: []
---

# HARNESS-DIET-000: harness diet audit roadmap

## Purpose

Owner directive (2026-07-23): audit the repo's harness — **rules, skills, hooks, scans, agent definitions, and
routing/workflows** — and slim it down. Remove what is **unnecessary, non-neutral, excessive, or ineffective**.
This is the epic/index; the concrete work is in the `HARNESS-DIET-001..007` sub-items below. Execution is
deliberately deferred to those items (this pass produced the audit + the backlog, per the directive to "create
the backlogs, then end the refactoring").

## Method

Eight read-only auditor agents divided the surface (22 rules, 60 skills, 12 hooks, 85 harness scripts, 14 agent
defs, top-level routing + 10 CI workflows). Each judged every item on four axes — **UNNECESSARY / NON-NEUTRAL /
EXCESSIVE / INEFFECTIVE** — and returned a per-item verdict (KEEP / SLIM / MERGE / NEUTRALIZE / REMOVE) with
grep-verified evidence. This file records the cross-cutting themes; each sub-item carries its scope's detailed
findings.

## Cross-cutting themes (why this matters)

1. **Non-neutrality is the dominant defect (north-star violation).** Per [`VISION.md`] and
   `.agents/memory/MEMORY.md`, robota is meant to be a **general, neutral** development-agent harness — building
   Robota is only the validation benchmark. Yet Robota package names (`@robota-sdk/*`), specific file paths, app
   inventories, and even required prose strings are hardcoded into machinery that presents as portable: ~10+
   scans, several rules (`publish`, `release-operations`, `frontend`, `code-quality`, `documentation-sync`),
   several skills (`robota-sdk-usage`, `contract-audit`, `backlog-execution-orchestrator`), and one agent
   (`prior-art-researcher`). The fix pattern is uniform: move repo-specifics to config
   (`harness-config`/`project-structure.md`/package SPECs); keep the machinery generic. → DIET-002, 004, 005.
2. **Dead / vacuous machinery.** `bootstrap.mjs` targets deleted apps (`apps/web`, `apps/api-server`);
   `scan-file-size` and `check-document-authority` are registered gates that **can never fail**;
   `record-owner-scenario.mjs` is orphaned; ~11 skills are index-only textbook/vendored dead weight;
   `operational.md`'s Idea-Capture + `{DOMAIN}-{BL|TK}-{NNN}` ID scheme are stale (the repo uses
   `{DOMAIN}-{NNN}`); `compat-node18` runs Node 22, not 18. → DIET-003, 005, 007.
3. **Redundancy / consolidation.** A triple routing layer (`AGENTS.md` ↔ `rules/index.md` ↔ `rules/process.md`);
   a 5-scan "library-neutrality" family that should be one config-driven scan; the INFRA-002 conformance
   skill-tree duplicating the `architecture-refresh` agent loop; `publish.md` + `release-operations.md`;
   `backlog-execution.md` restating one rule ~5× (491 lines); four thin scans foldable into neighbours. →
   DIET-002, 003, 004, 005, 007.
4. **Excessive / heavy-preamble.** Skills that re-state rules a rule already owns; `common-mistakes.md` #1–55
   restating other rules; `git-branch.md` war-stories; over-broad hook matchers (`spec-first-gate` fires on
   `\bcode\b`/`\badd\b`/`\bwrite\b`); per-edit `eslint --fix` duplicating lint-staged. → DIET-004, 005, 006.
5. **Safety (do first).** All 8 read-only reviewer/auditor agents carry `Bash` with **no guardrail against
   tree-mutating git** — and this session a read-only reviewer ran `git reset --hard` and destroyed an untracked
   spec-doc. `pr-review-reviewer` even _instructs_ a working-tree checkout/revert. → DIET-001 (security).

## Sub-items

| Item                                                                 | Scope                                    | Priority      |
| -------------------------------------------------------------------- | ---------------------------------------- | ------------- |
| [HARNESS-DIET-001](HARNESS-DIET-001-reviewer-agent-git-safety.md)    | reviewer-agent destructive-git safety    | high / now    |
| [HARNESS-DIET-002](HARNESS-DIET-002-scans-neutrality-config.md)      | scans: config-drive neutrality           | high / soon   |
| [HARNESS-DIET-003](HARNESS-DIET-003-scans-dead-and-consolidation.md) | scans: remove dead/vacuous + consolidate | high / soon   |
| [HARNESS-DIET-004](HARNESS-DIET-004-rules-consolidation.md)          | rules: consolidate & neutralize          | medium / soon |
| [HARNESS-DIET-005](HARNESS-DIET-005-skills-diet.md)                  | skills: remove dead + consolidate + slim | medium / soon |
| [HARNESS-DIET-006](HARNESS-DIET-006-hooks-diet.md)                   | hooks: remove/slim/merge                 | medium / soon |
| [HARNESS-DIET-007](HARNESS-DIET-007-routing-and-workflow-fixes.md)   | top-level routing & workflow fixes       | medium / soon |

## Guardrails for execution

- Each sub-item is a coherent PR unit (per the PR-batching policy, DX-001). Do NOT bundle unrelated sub-items.
- A REMOVE must be grep-proven unreferenced first; a MERGE must preserve the merged check's coverage (add a
  regression proof where a scan/hook changes behavior — see HARNESS-041 red-proof discipline).
- Neutralization must not weaken enforcement: move the Robota-specific data to config, keep the mechanical gate.
- Update `.agents/skills/index.md`, `.agents/rules/index.md`, `orchestration-map.md`, and `run-all-scans.mjs`
  in the same PR as any add/remove they track (their scans will fail otherwise).
