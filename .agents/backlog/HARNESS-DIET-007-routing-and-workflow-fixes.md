---
title: 'HARNESS-DIET-007: top-level routing slim + CI/workflow correctness fixes'
status: todo
created: 2026-07-23
priority: medium
urgency: soon
area: AGENTS.md, .agents/backlog/README.md, .agents/skills/index.md, .agents/specs/document-standards, .github/workflows
depends_on: []
---

# HARNESS-DIET-007: top-level routing & workflow fixes

## Progress (2026-07-23)

- **DONE:** fixed the `document-standards/index.md` spec-template misrouting (`spec-template.md` is a package
  `SPEC.md` template — moved it onto the Package-`SPEC.md` row; the Backlog-spec-doc row is now `—`, owned by
  `backlog-writer` + GATE-WRITE). Fixed `deploy.yml` environment URL `robota.dev`→`robota.io`.
- **REMAINING (owner-sensitive / larger):** slim `AGENTS.md` to routing-only; gut the backlog `README.md`
  ~676-line inline ledger; `compat-node18` fix (making it actually run Node 18 may surface real
  incompatibilities — needs a verified run); `release.yml` OTP-vs-token publish-path reconciliation (owner call);
  `deploy.yml` duplicate `security` job dedup; `skills/index.md` agent-blockquote trim.

## Problem

The entry/routing docs carry the triple-routing duplication and a large stale ledger, and several CI workflows
have concrete correctness bugs (a job that doesn't test what it claims, a mis-pointed template, a contradictory
publish path).

## What

### Routing / doc slim

- **`AGENTS.md`** → routing-only: drop the "Mandatory Rules" Key-rules column (owned by each rule doc) and the
  inlined Project-Structure + Common-Commands blocks (owned by `project-structure.md` / `package.json`). Keep the
  doc-tree table. Collapses the AGENTS.md ↔ `rules/index.md` ↔ `rules/process.md` triple layer (pairs with the
  DIET-004 `process.md` fold).
- **`.agents/backlog/README.md`** (766 lines) → delete the inline `## Items` ledger (~676 lines): it inlines
  ✅-completed items despite the file's own "archived to `completed/`" policy (639 files already in `completed/`)
  and holds the only dead reference (`.agents/reports/…`). Regenerate from frontmatter or link `completed/`;
  reduce prose to Process + File-Format + a pointer to `backlog-execution.md`.
- **`.agents/skills/index.md`** → trim the per-agent blockquotes (duplicate `orchestration-map.md` + the agent
  files) to pointers; drop the `vercel-react-native-skills` row (see DIET-005).

### CI / workflow correctness bugs

- **`compat-node18` (ci.yml)** — sets `node-version: '22.x'`, so it does NOT test the declared `>=18` floor. Pin
  Node 18 (or rename the job to what it actually tests). A required-looking job that catches nothing for its
  stated purpose.
- **`document-standards/index.md`** — the Package-`SPEC.md` taxonomy row has template `—` while `spec-template.md`
  (which IS a package-SPEC template) is mis-routed as the _backlog spec-doc_ template. Point the Package-SPEC row
  at `spec-template.md`; fix/replace the backlog-spec-doc pointer. The guard only checks the pointer resolves, so
  the semantic mismatch is silent.
- **`release.yml`** — `pnpm -r publish --access public --no-git-checks` with `NPM_TOKEN` and **no OTP**
  contradicts the documented single-OTP manual publish flow (INFRA-029; memory: "npm stays OTP-manual"). Two
  competing publish paths is a hazard — remove the token-based path or reconcile it to the OTP flow (owner
  decision).
- **`deploy.yml`** — environment URLs use `robota.dev`/`staging.robota.dev`; the real site is `robota.io`. Fix
  the URL; drop the duplicate `security` job (osv-scanner already in ci.yml; Snyk needs a token + is
  `continue-on-error`).

### Optional

- Factor the shared CI setup boilerplate (checkout + pnpm + node + install) copy-pasted across ~10 jobs into a
  composite action.

## Test Plan

- `AGENTS.md` / `skills/index.md` / `document-standards` link integrity green (`check-document-standards-index`,
  `scan-consistency`, `check-spec-paths`).
- `compat-node18` actually runs on Node 18 (or is renamed); workflows still parse (YAML valid).
- `release.yml`/`deploy.yml` change reviewed by owner (publish-path + deploy-URL are sensitive).

## User Execution Test Scenarios

- Not applicable (routing docs + CI config; link scans + YAML validity + a green CI run are the maintained gate).
