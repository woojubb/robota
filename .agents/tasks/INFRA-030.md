# INFRA-030 — Mechanize agent/skill convention + capability-scout

Spec: `.agents/spec-docs/active/INFRA-030-capability-extraction-system.md`

## Tasks

- [ ] T1 (TC-01): register "agent definition" (`.claude/agents/*.md`) + "thin orchestration skill" (`.agents/skills/*/SKILL.md`) as document types in `.agents/specs/document-standards/index.md` (RULE-007 Meta-Form). agent-definition row `status: partial`, follow-ons (`agent-skill-author` + template) as PLAIN TEXT (not links). One-line Identity note: harness-asset contracts. Must pass `check-document-standards-index.mjs`.
- [ ] T2 (TC-02): `scripts/harness/check-agent-def-convention.mjs` (register in run-all-scans `name: agent-def-convention`): frontmatter name/description/tools; read-only role must not carry Edit/Write; for agents declaring `signal:` (closed vocab: ACTIONABLE FINDINGS / REVIEW VERDICT / MERGE VERIFIED), body output-contract must instruct ending with that token; register-in-index check. Classify signal-bearing by the `signal:` field, NOT tool-absence.
- [ ] T3 (TC-02): add `signal:` frontmatter to exactly the **5 signal-bearing agents** (proposal-reviewer, architecture-auditor, architecture-conformance-auditor, merge-verifier, doc-auditor); leave the 3 edit agents (architecture-fixer, architecture-implementer, doc-fixer) without `signal:`. Guard passes all 8; a STANDALONE malformed fixture fails.
- [ ] T4 (TC-03): new `.claude/agents/capability-scout.md` (read-only tools; conforms to convention/passes the guard; `signal:` declared; output ends with a machine-readable decomposition summary).
- [ ] T5 (TC-04): `.agents/skills/lesson-to-harness/SKILL.md` — dispatch pointer to capability-extraction for "new recurring role"; `.agents/skills/index.md` registers scout + guard.
- [ ] T6 (TC-05): follow-on backlog note deferring `agent-skill-author` + orchestration skill behind the guard (do NOT build them here).
- [ ] T7 (TC-06/07): `pnpm harness:scan` green (incl. agent-def-convention + document-standards). Decision rationale = mechanized-contract (not self-consistency).

## Test Plan / 검증

Mechanize the "correct agent/skill shape" as a document-type contract + a harness scan (the missing enforcement). Authoritative = check-agent-def-convention fixture self-check (passes 8 existing agents after `signal:` frontmatter; fails a standalone malformed fixture) + check-document-standards-index green (partial row + text follow-ons) + harness:scan green. Write-agent deferred behind the guard. Delegated to architecture-implementer.
