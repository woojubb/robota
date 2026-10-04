# AGENTS.md

Robota — a TypeScript agent monorepo. Read [VISION.md](VISION.md) at the start of every development task; use its guiding question when choosing direction or assessing changes.
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). `**/docs/SPEC.md` holds only what the code cannot tell: Purpose,
Contract (the intent of its guarantees), Invariants, Non-goals, Design decisions with reasons. Most changes leave it
untouched. Never write what code or tests show (listings, inventories, orders, limits, steps), issue numbers, stages
or dates; when the contract changes, rewrite the existing sentence instead of appending a paragraph.

## Workflow

- Write repository documentation, code comments, commit messages, and GitHub issues, PRs, reviews and comments
  in English. Use the user's language only for direct conversation; it does not determine artifact language.
- Start from a GitHub issue and freshly fetched `origin/develop`; one issue per PR. Before coding, record and review a proportionate plan in the issue/PR covering the full requested problem/outcome/scope, current evidence, acceptance, design/rationale, foreseeable risks, verification, sequence/owners, compatibility/delivery, and assumptions/review/entry decisions.
  Small changes may be concise; explain non-applicable dimensions. An authorized **UNRESOLVED — PROVISIONAL CHOICE** may proceed with the selected choice, rationale, affected scope, risk/reversibility, owner and revisit evidence/trigger; only concrete missing authority, prerequisites or contract conflicts block dependent steps. Consult [HARNESS.md](HARNESS.md) for harness changes.
- Before filing an issue, search the open ones. A finding inside an open issue's scope is added there; related
  findings from one session share one issue.
- Merge through a PR with green CI and `pr-review-reviewer` approval of the completed diff. Resolve MUST/SHOULD;
  re-review affected fixes, not approved work without new evidence. Then merge; never push to `develop` or `main` directly.
- After merging a PR, delete its local and remote head branches without asking (never `develop` or `main`); ask only when a concrete reason to retain the branch needs the owner's decision.
- A behavior change ships with a test that failed before the change.
- A product slash command or skill that is added or changed carries a description written for the model (what it
  does, when to use it, what it returns) and a deliberate, tested choice of model invocation: what the model should
  run on its own is model-invocable and described so it is picked at the right moment. Trust, credential and
  permission-widening actions stay user-only; a failure that needs such an action names the command to suggest.
- `develop` → `main` promotion, version bumps and npm publish: [.agents/skills/release](.agents/skills/release/SKILL.md).

## Checks

`pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm deps:check`. For CLI runtime changes, personally run the actual source CLI with disposable HOME/product state, submit a normal prompt and a slash command, and verify session initialization and completed responses; record the exact commit, invocations, provider mode and results in the issue/PR. Help/version output alone does not establish a working session.

## Non-obvious facts

- Running the CLI writes to the selected `PRODUCT_USER_STATE_DIR`; a script or test that runs it uses
  temporary product state and points `HOME` at a temporary directory.
- The owner works on both macOS and Linux; shell commands must be portable or check `uname -s`.
- `.agents/skills/` in product code is a product feature (Robota loads a user project's skills), not this harness.

## Ask first

npm publish (unless the owner asked for the release), release tags, deleting remote branches other than
merged PR heads covered above, changing CI permissions or repository settings, anything touching secrets.

## Keeping the harness small

1. Correct the cause or existing guidance; verify enough to resolve the failure, then resume requested work.
   Record evidence/reuse in its issue/PR; revise or remove obsolete guidance instead of appending rules, hooks, or scans.
2. Adding to the harness needs a failure reproduced on the current model that review and tests cannot catch;
   the same PR removes as much as it adds.
3. When a new model ships, empty the harness back to this level, keep only what is still needed, and re-apply
   the SPEC rule above to every SPEC.
