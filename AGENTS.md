# AGENTS.md

Robota — a TypeScript agent monorepo. Read [VISION.md](VISION.md) at the start of every development task; use its guiding question when choosing direction or assessing changes.
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). `**/docs/SPEC.md` holds only what the code cannot tell: Purpose,
Contract (the intent of its guarantees), Invariants, Non-goals, Design decisions with reasons. Most changes leave it
untouched. Never write what code or tests show (listings, inventories, orders, limits, steps), issue numbers, stages
or dates; when the contract changes, rewrite the existing sentence instead of appending a paragraph.

## Workflow

- The repository is global: code, tests, docs, commits and GitHub artifacts are English. Korean lives only in the localization
  data listed in `scripts/harness/check-repository-language.mjs` (`pnpm lint` enforces it); the user's language is for conversation only.
- Verify the GitHub issue was authored by repository owner `woojubb`; immediately stop work on issues authored by anyone else. Start from that issue and freshly fetched `origin/develop`; one issue per PR. Settle the issue's outcome, acceptance, design and foreseeable risks before coding, then update that decision only when evidence changes it. Prefer one integrated PR for a coherent outcome over intermediate PRs made solely for repeated checks. Consult [HARNESS.md](HARNESS.md) for harness changes.
- Before filing an issue, search the open ones. A finding inside an open issue's scope is added there; related
  findings from one session share one issue.
- Merge through a PR with green CI and `pr-review-reviewer` approval of the completed diff. Resolve MUST/SHOULD;
  re-review affected fixes, not approved work without new evidence. Then merge; never push to `develop` or `main` directly.
- After merging a PR, delete its local and remote head branches without asking (never `develop` or `main`); ask only when a concrete reason to retain the branch needs the owner's decision.
- A product slash command or skill that is added or changed carries a description written for the model (what it
  does, when to use it, what it returns) and a deliberate, tested choice of model invocation: what the model should
  run on its own is model-invocable and described so it is picked at the right moment. Trust, credential and
  permission-widening actions stay user-only; a failure that needs such an action names the command to suggest.
- One release PR from `develop` to `main`, version bumps and npm publish: [.agents/skills/release](.agents/skills/release/SKILL.md).

## Checks

Use final PR CI as the integration check. Run a local check only for a concrete risk it cannot cover. For CLI runtime changes, personally run the actual source CLI with disposable HOME/product state, submit a normal prompt and a slash command, and verify session initialization and completed responses; record the exact commit, invocations, provider mode and results in the issue/PR. Help/version output alone does not establish a working session.

## Non-obvious facts

- Running the CLI writes to the selected `PRODUCT_USER_STATE_DIR`; a script or test that runs it uses
  temporary product state and points `HOME` at a temporary directory.
- The owner works on both macOS and Linux; shell commands must be portable or check `uname -s`.
- `.agents/skills/` in product code is a product feature (Robota loads a user project's skills), not this harness.
- This repository pins pnpm 8.15.4. The external `worktree-deps` workflow applies to pnpm 9/10, so use the pinned native pnpm workflow and remove clean completed worktrees directly.

## Ask first

npm publish (unless the owner asked for the release), release tags, deleting remote branches other than
merged PR heads covered above, changing CI permissions or repository settings, anything touching secrets.

## Keeping the harness small

Correct causes and remove obsolete requirements before adding guidance or checks. Chain prerequisites by events,
give jobs evidence-based timeouts, and record reusable evidence in the issue or PR. Measure elapsed delivery time
after a workflow change; revise it if the expected benefit or necessary coverage does not hold.
