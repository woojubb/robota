<!--
Thanks for the PR! Keep the title in Conventional Commits form (e.g. `feat: ...`, `fix: ...`) — commitlint
checks it. Fill in the sections below and delete this comment.
-->

## Summary

<!-- What does this change do, and why? -->

## Related issue

<!-- e.g. Closes #123 -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Docs / chore / refactor (no runtime behavior change)

## How was this tested?

<!-- Commands run and what you verified. For a bug/regression fix, confirm the new test FAILS without the fix
     (prove it red against the pre-fix state) — a test that passes on the buggy code guards nothing. -->

## Checklist

- [ ] `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` pass for the affected packages
- [ ] `pnpm harness:scan` passes (repo gates)
- [ ] Tests added/updated for the change (and a bug fix's regression test is proven red-before-green)
- [ ] Docs updated where relevant (package `docs/SPEC.md`, README, `content/`)
- [ ] Commits follow Conventional Commits
- [ ] Targets `develop` (feature → develop → main; only `develop`/`release/*`/`hotfix/*` may target `main`)
