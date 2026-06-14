# Operational Rules

Rules for day-to-day development practices: error handling, documentation, and task management.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.
- Public domain functions that can fail MUST return `Result<T, E>`. Throwing is reserved for truly unexpected programmer errors.

### Idea Capture Policy

- When the user mentions an idea, suggestion, or future task (e.g., "~하면 좋겠다", "나중에 ~하자", "~해야한다"), do NOT start implementation immediately.
- Instead, record it as a task file in `.agents/tasks/` with status `backlog` and acknowledge briefly ("기록했습니다").
- Continue the current work without interruption.
- Only start implementation when the user explicitly requests it (e.g., "이거 진행해", "할일 목록에서 X 해줘").
- When the user asks to see the backlog ("할일 목록 보여줘"), list all recorded tasks from `.agents/tasks/`.

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

All task and backlog files use an uppercase prefix ID in both the filename and the `title` frontmatter.

**Format:** `{DOMAIN}-{TYPE}-{NUMBER}`

| Domain  | Scope                       |
| ------- | --------------------------- |
| `CLI`   | agent-cli                   |
| `SDK`   | agent-sdk                   |
| `CORE`  | agent-core                  |
| `PLUG`  | Plugin system               |
| `ORCH`  | Cross-package orchestration |
| `INFRA` | Infrastructure / deployment |

| Type | Meaning                 |
| ---- | ----------------------- |
| `BL` | Backlog                 |
| `TK` | Task (in-progress work) |

**Examples:** `CLI-BL-001`, `SDK-TK-002`, `PLUG-BL-003`

**File naming:** `.agents/tasks/CLI-BL-001-file-attachment.md`

### Document Size Rule

- **Routing/index documents** — `.agents/rules/index.md`, `.agents/project-structure.md`, `AGENTS.md` — MUST stay lean (target under 80 lines). They route to detail; they do not inline it. When one exceeds the target, split detail into a focused sub-file and convert the original into a router; each sub-file keeps a `Parent:` link.
- **Detail rule documents** — rule catalogs (e.g. `common-mistakes.md`), gate specifications (e.g. `backlog-execution.md`, `spec-workflow.md`), and multi-section rule groups — are content documents consumed for their substance and are NOT bound by the 80-line target (same rationale as the skills exemption below).
- **Skills** (`.agents/skills/*/SKILL.md`) are exempt — procedural workflows agents consume in one pass.
- **Production source** size is governed separately by `code-quality.md` (300-line anti-monolith limit, enforced by `harness:scan` file-size).
