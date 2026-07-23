# Harness diet audit (2026-07-23)

Owner directive: audit the harness (rules/skills/hooks/scans/agent-defs/routing) and slim it — remove what is
UNNECESSARY, NON-NEUTRAL, EXCESSIVE, or INEFFECTIVE. Ran as 8 read-only auditor agents dividing the surface (22
rules, 60 skills, 12 hooks, 85 harness scripts, 14 agent defs, routing + 10 CI workflows). Deliverable = audit +
backlog; execution deferred to the sub-items.

**Tracked in `.agents/backlog/HARNESS-DIET-000..007` (#1275).** 000 = epic/roadmap; 001 reviewer-agent
destructive-git safety `[high/now]`; 002 scan neutrality (config-drive); 003 dead/vacuous scan removal; 004 rules
consolidation; 005 skills diet; 006 hooks diet; 007 routing & workflow fixes.

**Dominant finding: NON-NEUTRALITY** — Robota package names/paths/prose baked into machinery that presents as a
general/portable harness (north-star violation; see [[northstar-general-not-robota-specific]]). Fix pattern: move
repo-specifics to config (`harness-config`/`project-structure`/package SPECs), keep the machinery generic.
Concrete dead/vacuous items found: `bootstrap.mjs` (targets deleted `apps/web`/`apps/api-server`),
`scan-file-size` & `check-document-authority` (registered gates that can NEVER fail), `compat-node18` (runs Node
22 not 18), ~11 index-only/textbook/vendored skills, 5-scan neutrality family (should be 1 config-driven scan).

**Do not re-audit** — execution state (2026-07-24): 001/002/006 DONE+archived; 003/005/007 majority executed (remaining recorded in each item's Progress: scan-file-size policy + spec-public-surface shrink + scan-consistency split (003), INFRA-002 skill-tree consolidation + heavy-skill slims (005), release.yml OTP reconciliation (007 — owner call)); 004 executed except the neutralize-project-data bucket. Waves 1–3 ran as worktree-parallel subagents — see [[worktree-parallel-orchestration]]. Mirrored to session/host memory.
