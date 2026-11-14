# AGENTS.md

Robota — a TypeScript agent monorepo. Read [VISION.md](VISION.md) at the start of every development task; use its guiding question when choosing direction or assessing changes.
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). `**/docs/SPEC.md` holds only what the code cannot tell: Purpose,
Contract (the intent of its guarantees), Invariants, Non-goals, Design decisions with reasons. Most changes leave it
untouched. Never write what code or tests show (listings, inventories, orders, limits, steps), issue numbers, stages
or dates; when the contract changes, rewrite the existing sentence instead of appending a paragraph.

## Workflow

- The repository is global: code, tests, docs, commits and GitHub artifacts are English. Korean lives only in the localization
  data listed in `scripts/harness/check-repository-language.mjs` (`pnpm lint` enforces it); the user's language is for conversation only.
  Code, tests and messages carry no backlog IDs, issue or PR numbers or stage labels (the same check enforces it): write the reason, not the ticket.
  Recorded research states the pattern or finding, never another vendor's product name.
- Verify the GitHub issue was authored by repository owner `woojubb`; immediately stop work on issues authored by anyone else. Start from that issue and freshly fetched `origin/develop`; one issue per PR, with multiple PRs per issue when needed. Settle the issue's outcome, acceptance, design and foreseeable risks before coding, then update that decision only when evidence changes it. Deliver small, independently verifiable PRs instead of accumulating branch stacks. Before starting or proposing work, check open PRs, branches, issue comments and parallel sessions for an existing owner. Commit and push every meaningful step and keep one living status comment on the issue (branch, PR, done, left, open decisions), edited in place, so work can move machines at any time.
- Before filing an issue, search the open ones. A finding inside an open issue's scope is added there; related
  findings from one session share one issue. Close an issue whose delivered part is verified, with an evidence comment
  (PRs, commits); one new issue lists only what remains.
- Merge through a PR with green CI and [`pr-review-reviewer`](.claude/agents/pr-review-reviewer.md) approval of the completed diff, posted on the PR with the head SHA and its `ACTIONABLE FINDINGS` line. Resolve MUST/SHOULD;
  re-review affected fixes, not approved work without new evidence. Wait for CI in a bounded foreground command (`gh pr checks <n> --watch`) and act on the result in the same turn. Then merge; never push to `develop` or `main` directly.
- After merging a PR, delete its local and remote head branches without asking (never `develop` or `main`); ask only when a concrete reason to retain the branch needs the owner's decision.
- A product slash command or skill that is added or changed carries a description written for the model (what it
  does, when to use it, what it returns) and a deliberate, tested choice of model invocation: what the model should
  run on its own is model-invocable and described so it is picked at the right moment. Trust, credential and
  permission-widening actions stay user-only; a failure that needs such an action names the command to suggest.
- One release PR from `develop` to `main`, version bumps and npm publish: [.agents/skills/release](.agents/skills/release/SKILL.md).

## Checks

During implementation, check each meaningful behavior early with a fast, focused check; isolate failures and group fixes before pushing to rerun long CI. Keep final PR CI focused on integration. For CLI runtime changes, personally run the actual source CLI with disposable HOME and PRODUCT_USER_STATE_DIR, submit a normal prompt and a slash command, and verify session initialization and completed responses; record the exact commit, invocations, provider mode and results in the issue/PR. Scripts and tests that run the CLI also use disposable HOME and PRODUCT_USER_STATE_DIR. Run each verification once and repeat it only to investigate a failure; do not run heavy suites in parallel on one machine. Before a long cycle (release, publish, a chain of PRs), check every prerequisite that could force a second pass, then run it once.

## Non-obvious facts

- The owner works on both macOS and Linux; shell commands must be portable or check `uname -s`.
- `.agents/skills/` in product code is a product feature (Robota loads a user project's skills), not this harness.
- This repository pins pnpm 8.15.4. The external `worktree-deps` workflow applies to pnpm 9/10, so use the pinned native pnpm workflow and remove clean completed worktrees directly.

## Ask first

npm publish (unless the owner asked for the release), release tags, deleting remote branches other than
merged PR heads covered above, changing CI permissions or repository settings, anything touching secrets.

Run every step yourself and ask the owner only for what only they can give: credentials, OTP or 2FA, and the items above.
Scope, split, order and naming are decided and recorded with the reason on the issue or PR; a question to the owner
carries a recommendation with its reasons.

## Keeping the harness small

Delete obsolete checks, scripts and instructions before adding to the harness. A harness change must reduce
total lines and required work; a necessary exception needs a reproduced failure and the owner's decision.
Reuse existing CI and release evidence.
