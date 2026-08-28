# The pre-push suite does not run the lint ceiling — run `pnpm lint` before the first push

**Observed (2026-08-29, PR #2439, CORE-049).** The `quality` job went red on the lint-warning ceiling: 2204 warnings against `--max-warnings 2203`. The base sat exactly at the ceiling, and the branch had added one warning — a new `matchUrl` with a cyclomatic complexity of 23 against the limit of 15. Nothing local had said so: the pre-push suite does not run the workspace lint, and `scan-lint-warning-ratchet` states why (a full workspace lint is minutes per push, so the ceiling is enforced by `pnpm lint` itself in the `quality` job and in `harness:verify:release`).

**Owner's point.** A lint problem surfacing on the PR is wrong when the same command runs locally: the red check costs a CI round and a review round that `pnpm lint` in the background would have saved.

**How to apply.** Before the FIRST push of a branch that touches `packages/` or `apps/`, run `pnpm lint` (workspace; ~3 min; run it in the background) and read the count line against `scripts/harness/lint-warning-baseline.json`. `npx eslint <touched files>` is the fast proxy — but a test file passed explicitly reports only "File ignored because of a matching ignore pattern", so read the count, not the exit code ([applied-check-must-read-the-code-line](applied-check-must-read-the-code-line.md)). A `complexity` / `max-lines-per-function` warning on a new function is the usual shape: split the function into the clauses it already has.

Owner of the mechanism: `scripts/harness/scan-lint-warning-ratchet.mjs` (INFRA-039); the CI step is `Lint-warning ceiling` in `.github/workflows/ci.yml`.
