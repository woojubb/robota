---
status: done
type: RULE
tags: [typescript]
---

# RULE-006: Distill transferable operational / tool-use behavioral norms from the RCP system prompt

## Problem

The user adopted the **external reference conduct profile (RCP)** as governing authority with **unlimited
RCP precedence on conflict**. This draft covers **one area only: operational / tool-use
behavior** — when to ask the user vs proceed, web_search/web_fetch discipline, file
creation/handling, MCP/connector usage, and artifact/storage philosophy. **Behavioral norms only;
claude.ai tool schemas are out of scope** (companion area RULE-001 owns communication/conduct
style; base-model safety/copyright is out of scope entirely).

RCP is a **consumer chat-product (claude.ai) prompt**. Its operational sections are tied to
product tooling (`create_file`, `present_files`, `window.storage`, `ask_user_input_v0`,
`search_mcp_registry`, `/mnt/user-data/*`). Importing them wholesale is wrong: most are
non-portable. Only the **behavioral norms** transfer — and several map onto mechanisms this repo
already has (pnpm pinning, ToolSearch opt-in, the Bash/Edit/Write toolset, `SendUserFile`).

This draft proposes importing **only the portable norms not already covered**, expressed
domain-free (no tool names), restated against this repo's reality.

## Gap Analysis (RCP operational norms vs current harness)

| RCP norm                                                                                                                                                         | Repo mapping                                                                                                                                                                                                               | Verdict                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **N1** Check context before asking; if request is already specific, proceed and state assumptions inline; one question max; "A or B?" wants analysis not buttons | `operational.md` Option Proposal, `research.md` Recommendation Authority, `feedback_agent_decision_authority`, `feedback_never_ask_user_to_test` — mostly covered; "check context first + inline assumptions" not codified | **conflict→RCP** (more specific; wins) / largely **covered**    |
| **N2** web_search discipline: don't search stable facts, search changed/unknown current state, unrecognized-entity rule, scale calls 1/3-5/5-10 to complexity    | `research.md` mandates proportional research + doc-first prior art, but **no search trigger / scaling / unrecognized-entity rule**                                                                                         | **NEW**                                                         |
| **N3** web_fetch discipline: user names a URL → always fetch it; snippets too brief → fetch full page; only exact provided/returned URLs                         | none                                                                                                                                                                                                                       | **NEW**                                                         |
| **N4** Tool priority (internal>external), skepticism on SEO/conspiracy topics, **never fabricate attributions**                                                  | `operational.md` No Fallback (single verifiable path); attribution-honesty aligned but unstated; internal>external priority uncodified                                                                                     | **NEW (thin)**                                                  |
| **N5** Create files only when needed; edit the actual uploaded file on "fix my file"; standalone-artifact vs conversational-answer split                         | This task's system guidance already enforces "never create files unless necessary; prefer editing; no proactive \*.md"; not in harness rule files                                                                          | **conflict→RCP** (same direction) / operationally **covered**   |
| **N6** Don't fabricate file presence; actually create outputs; share files not folders; don't re-read in-context uploads                                         | aligns with system guidance ("verify with ls; absolute paths"); uncodified                                                                                                                                                 | **NEW (thin)**                                                  |
| **N7** Package management: verify tool availability before use                                                                                                   | `AGENTS.md` Common Commands pins pnpm as SSOT                                                                                                                                                                              | **COVERED** (pnpm pinned); claude.ai pip bits non-portable      |
| **N8** MCP/connector opt-in & directory-first; check available MCPs before browser; no fake/mock tool UIs                                                        | ToolSearch already enforces fetch-schema-before-call (structural opt-in); `context7` server instructs docs-over-websearch                                                                                                  | **COVERED** (ToolSearch = opt-in); consumer-app flow irrelevant |
| **N9** Artifact KV storage philosophy (try-catch, batch keys, reset option)                                                                                      | no artifact runtime / `window.storage` in repo                                                                                                                                                                             | **NON-PORTABLE** (claude.ai-only)                               |

Net: **N2, N3 = NEW**; **N4, N6 = NEW (thin)**; N1/N5 = covered-but-reinforced (RCP wins on
detail); N7/N8 = covered by repo mechanisms; N9 = excluded.

## Proposed additions (the only content to import)

Express domain-free (no tool names like web_search/WebFetch — say "search/fetch tools when
available"), restated for this repo.

**P1. Search/fetch discipline (from N2/N3)**

- Do not search/look up stable, well-established facts the agent already knows. Search to verify
  anything that may have changed since training (current versions, library APIs, external status)
  before asserting it.
- Unrecognized-entity rule: before answering about a product/model/version/technique the agent
  does not recognize, look it up; partial recognition is not current knowledge.
- Scale lookups to complexity (single fact → 1; medium → a few; deep comparison → several); use the
  minimum needed.
- When the user names a URL/source, fetch that exact source; when snippets are insufficient, fetch
  the full content.

**P2. Source honesty & tool priority (from N4)**

- Never fabricate attributions; if a source for a statement is uncertain, omit it.
- Prefer repo-internal sources (code, specs, docs) over external search for repo-internal
  questions; combine when comparing internal vs external. (Respect `research.md`: source code is
  not prior-art evidence — read the public doc it points to.)
- Be appropriately skeptical of SEO-prone / contested results; re-search on conflict.

**P3. File handling & creation discipline (from N5/N6)**

- Create files only when necessary; prefer editing an existing file over creating a new one; no
  proactive docs/README unless requested. (Reinforces this repo's standing guidance.)
- On "fix/modify my file", edit the actual target file, not a new copy.
- Never claim a file exists or was produced without actually creating it; verify paths before
  asserting presence; surface deliverables explicitly (share the file, not a folder).

## Architecture Review

### Affected Scope (placement — decide at GATE-APPROVAL)

**Recommended owner: extend `.agents/rules/operational.md` (Process sub-rule).**

- Rationale: P1–P3 are _operational_ (search/fetch discipline, source honesty, file handling) —
  the same bucket as `operational.md`'s No-Fallback / Idea-Capture / Option-Proposal rules, and
  already routed under `process.md`. No new rule group, no new `AGENTS.md` table row needed (the
  Process row already covers it via `operational.md`). One owner, no document-authority conflict.
- Add three short sections (P1 Search/Fetch Discipline, P2 Source Honesty & Tool Priority, P3 File
  Handling Discipline) to `operational.md`; update the `process.md` operational row description only
  if the scope summary changes.

**Alt A: new rule doc `.agents/rules/agent-conduct.md`** (shared with RULE-001).

- Pro: co-locates all RCP-derived conduct; RULE-001 already proposes this file.
- Con: P1–P3 are operational tool-use, not communication conduct — different concern from
  RULE-001's A–D; mixing dilutes the doc. Defer: if RULE-001 creates `agent-conduct.md`, revisit
  whether tool-use norms belong there vs `operational.md`.

**Alt B: keep in the RCP agent-preset package.**

- Con: these are general good operational hygiene, not preset-specific; should apply to default
  work too.

**Recommendation:** `operational.md` (cleaner owner — operational norms with operational rules).
RULE-001 keeps communication/conduct in its own placement; this draft stays out of that file.

### Alternatives Considered (scope)

- **Import the whole operational/computer_use/mcp/storage sections** — rejected: most is
  claude.ai-specific (paths, `create_file`, `window.storage`, connector flows); violates
  "domain-free rules / no duplication".
- **Import nothing** — rejected: P1 (search/fetch discipline) and P3 (file handling) are genuine
  gaps; the rest is already covered by repo mechanisms.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (`.agents/rules/operational.md` + optional `process.md` row)
- [x] Sibling scan 완료 — gap-analyzed against `operational.md`, `research.md`, `api-boundary.md`, `AGENTS.md` Common Commands/Harness Entrypoints, ToolSearch/context7 mechanisms, RULE-001 draft
- [x] 대안 최소 2개 검토 완료 (placement operational.md / agent-conduct.md / preset + scope import-all/import-none)
- [ ] 결정 근거 문서화 완료 — pending GATE-APPROVAL choice of placement

## Solution

After GATE-APPROVAL picks a placement (recommend `operational.md`):

1. Add sections P1–P3 to `.agents/rules/operational.md` (concise, domain-free, English, no tool
   names — use "search/fetch tools when available").
2. No `AGENTS.md` table row needed (Process row already routes to `operational.md`); update the
   `process.md` operational summary only if its one-line scope description changes.
3. Run `pnpm harness:scan` (document-authority + consistency + doc-structure) to confirm no
   conflict/duplication with `research.md` or RULE-001's conduct doc.

## Affected Files

- `.agents/rules/operational.md` (extend) — recommended owner
- `.agents/rules/process.md` (operational row summary) — only if scope description changes
- (Alt) `.agents/rules/agent-conduct.md` — only if GATE-APPROVAL co-locates with RULE-001

## Completion Criteria

- [ ] Only P1–P3 added; no claude.ai product/tool/path/storage content imported.
- [ ] Expressed domain-free (no tool names); no duplication with `research.md` or RULE-001.
- [ ] `pnpm harness:scan` passes (document-authority, consistency, doc-structure).
- [ ] N7/N8/N9 explicitly NOT imported (covered by pnpm/ToolSearch, or non-portable).

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                                                      |
| ----- | --------- | -------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | automated | `pnpm harness:scan:document-authority` | no ownership/duplication conflict for P1–P3 vs research.md/RULE-001        |
| TC-02 | automated | `pnpm harness:scan:consistency`        | operational.md ↔ process.md ↔ index consistent                             |
| TC-03 | manual    | review diff                            | confirm only P1–P3 imported, domain-free, no tool names; N7/N8/N9 excluded |

## Implementation Risk (non-portable items)

- **create_file / artifacts behavior** — RCP "file creation" exposes outputs as download
  links / rendered UI (a product behavior). This repo has only Bash/Edit/Write + `SendUserFile`;
  no 1:1 mapping. Import the _principle_ (create only when needed, prefer editing, never fabricate
  presence) — not the mechanism.
- **window.storage KV API** (5MB/200-char keys, no localStorage) — claude.ai artifact runtime
  only. Non-portable; do not conflate with `.agents/tasks/` or spec-docs persistence.
- **ask_user_input_v0 tappable-button UI** and its `single/multi_select/rank_priorities` schema —
  claude.ai UI; import only the _when-to-ask_ behavior, drop the widget.
- **MCP connector flow** (`search_mcp_registry` → `suggest_connectors` → `navigate`, third-party
  consumer-app opt-in, Imagine UI) — claude.ai connector product; ToolSearch already provides the
  opt-in equivalent here, so no rule needed.
- **pip `--break-system-packages`, `.npm-global`, `/mnt/user-data/*`, `/home/claude`** — claude.ai
  sandbox paths; this repo is pnpm + repo-relative absolute paths.
- **N4 internal>external tool priority** assumes gdrive/slack; re-interpreted here as
  "repo code/specs/docs over external search" — must respect `research.md`'s "source code is not
  prior-art evidence" boundary.

## Tasks

- [ ] `.agents/tasks/RULE-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- 2026-06-18 — Source assessed: `the external reference conduct profile (not committed)` operational sections
  (mcp_app_suggestions 252–300, computer_use 301–435, persistent_storage 171–251, ask_user_input_v0
  648, web_fetch 1290 / web_search 1349 / core_search_behaviors 446 / search_usage_guidelines 468).
  9 norms extracted (N1–N9): N2/N3 NEW, N4/N6 NEW(thin), N1/N5 covered-but-reinforced (RCP
  wins), N7/N8 covered by pnpm/ToolSearch, N9 non-portable. 3 import items (P1–P3). Recommended
  owner: `operational.md`. Draft pending placement decision.

- 2026-06-18 — IMPLEMENTED: consolidated into `.agents/rules/agent-conduct.md` (communication, accountability/honesty, epistemics, safety pointer) + operational items in `.agents/rules/operational.md`; precedence statement + Mandatory Rules row added to AGENTS.md + rules/index.md. `pnpm harness:scan` = all 26 passed.
