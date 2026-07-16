# Memory Mirroring (absolute rule)

**Principle.** Whenever durable, cross-session knowledge is written to an agent's session/host memory
(e.g. Claude Code's per-project memory outside the repo), the **same content MUST also be written to the
in-repo memory** at [`.agents/memory/`](../memory/). Session/host memory alone is **never** sufficient for
durable knowledge.

**Why.** Session/host memory is machine-local and does not travel with the repository. Every clone,
every contributor, every CI or headless agent must operate from the **same harness knowledge**, and the
only shared, version-controlled surface is the repo itself. Knowledge that lives only in one machine's
session memory is invisible to every other clone — it silently fragments the harness. The repo is the
single source of truth for durable agent knowledge; session memory is at most a local cache/mirror of it.

**How to apply.**

1. Before (or immediately after) writing any durable fact/principle/goal to session/host memory, write the
   **same fact** to `.agents/memory/<slug>.md` and add a one-line pointer to `.agents/memory/MEMORY.md`.
2. What counts as durable: owner goals/north-stars, standing preferences, architecture/tooling decisions,
   reusable operational knowledge — anything you would want a _different clone in a different session_ to know.
3. What does NOT count (session memory optional, repo mirror not required): ephemeral turn-level state,
   secrets/credentials (never commit these), and anything already owned by an existing repo document
   (rules, specs, `evals/lessons/`) — link to that owner instead of duplicating.
4. If a fact belongs more precisely to an existing owner document (a rule, a package `SPEC.md`, an ADR,
   `evals/lessons/`), put it there and point `.agents/memory/` at it. One owner per fact, no duplication.
5. This rule is symmetric: content is not "saved durably" until it exists in the repo. A session-memory-only
   write is an incomplete save.

**Scope.** Applies to every agent operating in this repo, every session, on every clone. It does not require
mirroring secrets or ephemeral state, and it never overrides the no-secrets-in-repo rule.
