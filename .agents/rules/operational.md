# Operational Rules

Rules for day-to-day development practices: error handling, research, documentation, and task management.
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

### Prior Art Research Requirement

- Before implementing any new feature or capability, research whether equivalent solutions already exist in established products (e.g., Claude Code, VS Code, Cursor, Warp, etc.).
- The research MUST be completed BEFORE writing implementation code or finalizing a spec.
- Research deliverables:
  1. **Identify prior art** — which products have this feature, how they implement it.
  2. **Document findings** — save to `.agents/backlog/<item>.md` or the task file under a `## Prior Art Research` section.
  3. **Extract spec decisions** — use research to inform parameter names, UX patterns, edge cases, and defaults.
- If no prior art is found, document that fact explicitly ("No known prior art found").
- A feature implementation that skips prior art research when equivalent solutions obviously exist is a process violation.
- This applies to CLI features, SDK APIs, tool behaviors, and UX patterns — not to internal refactoring or bug fixes.

### Feature Documentation Requirement

- When a new feature is implemented (new tool, new API, new command, new capability), documentation MUST be updated in the same commit or PR.
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
| `DAG`   | DAG related                 |
| `ORCH`  | Orchestration               |
| `INFRA` | Infrastructure / deployment |

| Type | Meaning                 |
| ---- | ----------------------- |
| `BL` | Backlog                 |
| `TK` | Task (in-progress work) |

**Examples:** `CLI-BL-001`, `SDK-TK-002`, `PLUG-BL-003`

**File naming:** `.agents/tasks/CLI-BL-001-file-attachment.md`

### Document Size Rule

- Rule files (`.agents/rules/*.md`) and routing documents (`.agents/project-structure.md`, etc.) MUST stay under 80 lines.
- When a file exceeds 80 lines, split it into focused sub-files and convert the original into a routing file that links to them.
- Skills (`.agents/skills/*/SKILL.md`) are exempt — they are procedural workflows that agents consume in one pass.
- Each sub-file must have a `Parent:` link back to the routing file.
