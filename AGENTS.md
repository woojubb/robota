# AGENTS.md

Robota — a TypeScript pnpm monorepo for building multi-provider AI agents. North star: [VISION.md](VISION.md).
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). `packages/*/docs/SPEC.md` holds the contract, not the code: anything
readable from the code (type and function listings, file inventories, test tables, implementation steps) does not belong
in it. Keep only what the code cannot tell — purpose, the public contract's intent and guarantees, invariants,
non-goals, and design decisions with their reasons — and update it in the same change when the contract changes.

## Workflow

- Work starts from a GitHub issue. Branch from a freshly fetched `origin/develop`; one issue per PR.
- Merge only through a PR with CI green. Before merging, review the diff with the `pr-review-reviewer` agent
  and resolve every MUST/SHOULD. Never push to `develop` or `main` directly.
- A behavior change ships with a test that failed before the change.
- `develop` → `main` promotion, version bumps and npm publish: [.agents/skills/release](.agents/skills/release/SKILL.md).
  Publishing needs the owner's OTP.

## Checks

`pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm deps:check`

## Non-obvious facts

- The product DAG path is composed in `agent-command-workflows`; there is no standalone DAG CLI.
- Running the CLI writes to `~/.robota/`. When exercising the product from a script or test, point `HOME` at a
  temporary directory.
- The owner works on both macOS and Linux; shell commands must be portable or check `uname -s`.
- `.agents/skills/` in product code is a product feature (Robota loads a user project's skills); it is not this
  repository's own harness.

## Ask first

npm publish, release tags, deleting remote branches, changing CI permissions or repository settings, anything
touching secrets.

## Keeping the harness small

1. A correction fixes the instance. It does not add a rule, a hook, or a scan.
2. Adding to the harness needs a failure reproduced on the current model that review and tests cannot catch;
   the same PR removes as much as it adds.
3. When a new model ships, empty the harness back to this level and keep only what is still needed.
