# Operational Rules

Rules for day-to-day development practices: error handling, documentation, task management, and
application boundaries (absorbed `api-boundary.md`, now a pointer stub).
Parent: [rules index](index.md)

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.
- Public domain functions that can fail MUST return `Result<T, E>`. Throwing is reserved for truly unexpected programmer errors.

### Idea Capture Policy

- When the user mentions an idea, suggestion, or future task (e.g., "~하면 좋겠다", "나중에 ~하자", "~해야한다"), do NOT start implementation immediately.
- Instead, record it where future work actually lives: a backlog item in `.agents/backlog/` (per its README) or, for spec-shaped ideas, a spec-doc draft in `.agents/spec-docs/draft/`. Acknowledge briefly ("기록했습니다").
- Continue the current work without interruption.
- Only start implementation when the user explicitly requests it (e.g., "이거 진행해", "할일 목록에서 X 해줘").
- When the user asks to see the backlog ("할일 목록 보여줘"), list the recorded items from `.agents/backlog/`.

### Option Proposal Rule

- When presenting options to the user, always include a recommendation with rationale.
- For each option, evaluate and state the impact: affected files/packages, risk level, migration effort.
- Format: options → recommendation → impact assessment. Never present options without a clear recommendation.

### Feature Documentation Requirement

- When a new feature is implemented (new tool, new API, new command, new capability), documentation MUST be updated in the same commit or PR.
- Follow [documentation-sync.md](documentation-sync.md) for the exact package README and robota.io source paths that must be checked.
- Required documentation updates:
  1. **SPEC.md** of the affected package — add or update the feature description.
  2. **README.md** of the affected package — add usage examples if the package is published.
  3. **Backlog/task cleanup** — move completed backlog items to `completed/`.
  4. **Stale content** — any existing documentation that contradicts the new feature MUST be corrected.
- A feature without documentation updates is an incomplete feature.
- This rule is enforced by `harness:scan:specs` which checks that SPEC.md exists and is non-empty for all published packages.

### Task/Backlog ID Convention

All backlog, spec-doc, and task files use an uppercase prefix ID in both the filename and the `title` frontmatter.

**Format:** `{DOMAIN}-{NNN}` — an uppercase domain prefix plus a zero-padded number
(e.g. `CLI-061`, `CORE-025`, `HARNESS-030`, `GUI-001`, `INFRA-044`). The domain names the owning
area (package, app, or cross-cutting concern); new domains may be introduced when a new area
appears. There is no separate `BL`/`TK` type segment.

**File naming:** `{ID}-{slug}.md`, e.g. `.agents/backlog/CLI-061-ime-last-character-drop.md`.

### Document Size Rule

- **Routing/index documents** — `.agents/rules/index.md`, `.agents/project-structure.md`, `AGENTS.md` — MUST stay lean (target under 80 lines). They route to detail; they do not inline it. When one exceeds the target, split detail into a focused sub-file and convert the original into a router; each sub-file keeps a `Parent:` link.
- **Detail rule documents** — rule catalogs (e.g. `common-mistakes.md`), gate specifications (e.g. `backlog-execution.md`, `spec-workflow.md`), and multi-section rule groups — are content documents consumed for their substance and are NOT bound by the 80-line target (same rationale as the skills exemption below).
- **Skills** (`.agents/skills/*/SKILL.md`) are exempt — procedural workflows agents consume in one pass.
- **Production source** size is governed separately by `code-quality.md` (300-line anti-monolith limit, enforced by `harness:scan` file-size).

### Search / Fetch Discipline

Adopted from the RCP conduct authority ([agent-conduct.md](agent-conduct.md) holds precedence).

- Do not search/look up stable, well-established facts already known. Search to verify anything
  that may have changed since training (current versions, library APIs, external status) before
  asserting it.
- Unrecognized-entity rule: before answering about a product, model, version, or technique not
  recognized, look it up — partial recognition is not current knowledge.
- Scale lookups to complexity (single fact → one; medium → a few; deep comparison → several); use
  the minimum needed.
- When the user names a URL or source, fetch that exact source; when snippets are insufficient,
  fetch the full content.

### Source Honesty & Tool Priority

- Never fabricate attributions; if the source for a statement is uncertain, omit it.
- Prefer repo-internal sources (code, specs, docs) over external search for repo-internal
  questions; combine when comparing internal vs external. Respect [research.md](research.md):
  third-party source code is not prior-art evidence — read the public doc it points to.
- Be appropriately skeptical of SEO-prone or contested results; re-search on conflict.

### File Handling Discipline

- Create files only when necessary; prefer editing an existing file over creating a new one; no
  proactive docs/README unless requested.
- On "fix/modify my file", edit the actual target file, not a new copy.
- Never claim a file exists or was produced without actually creating it; verify paths before
  asserting presence; surface deliverables explicitly (share the file, not a folder).

## API Boundary & Process Lifecycle

Absorbed from `api-boundary.md` (now a pointer stub).

### API Specification

- Applications with external API endpoints must maintain standardized API specifications (e.g., OpenAPI for HTTP). See `api-spec-management` skill for workflow details.

### Process Lifecycle

- Applications in `apps/` must handle SIGTERM and SIGINT for graceful shutdown.
- In-progress work must complete or be safely cancelled within a configurable timeout.
- All acquired resources (connections, file handles) must be released on shutdown.
