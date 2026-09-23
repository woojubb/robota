# AGENTS.md

Robota — a TypeScript pnpm monorepo for building multi-provider AI agents. North star: [VISION.md](VISION.md).
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Package contracts: `packages/*/docs/SPEC.md` — update the SPEC in
the same change when a package's public contract changes.

## Workflow

- Work starts from a GitHub issue. Branch from a freshly fetched `origin/develop`; one issue per PR.
- Merge only through a PR with CI green and an independent review verdict (`review-policy`). Never push to
  `develop` or `main` directly.
- A behavior change ships with a test that failed before the change.
- `develop` → `main` promotion, version bumps and npm publish follow
  [.agents/skills/version-bump](.agents/skills/version-bump/SKILL.md) and
  [.agents/skills/npm-otp-publish](.agents/skills/npm-otp-publish/SKILL.md). Publishing needs the owner's OTP.

## Checks

`pnpm build` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm deps:check`

## Non-obvious facts

- The product DAG path is composed in `agent-command-workflows`; `dag-cli` is a private shell nothing consumes.
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
