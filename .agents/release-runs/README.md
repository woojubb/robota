# Release Runs — LIVE

This directory stores live release-run state artifacts created by:

```bash
pnpm harness:release:init -- --version <version>
```

Each release or publish operation must keep exactly one version-specific file current while the
operation is active. The file records branch/SHA, PR, target version, active gate, next action, stop
condition, watcher cleanup, CI triage notes, and final report fields.

Rules:

- Do not store OTPs, npm tokens, API keys, or secrets here.
- Before `pnpm publish:beta`, the matching release-run must pass:

  ```bash
  pnpm harness:release:check -- --version <version> --publish
  ```

- Append CI failure triage before code changes during release work:

  ```bash
  pnpm harness:release:triage -- --version <version> --pr <number> --check <check-name>
  ```

- Keep active watchers as `none` and cleanup status as `clear` before switching tasks or publishing.

## Why this heading says LIVE

HARNESS-066 investigated three `.agents/` trees for the shape "a mechanism whose output stopped while
its registration did not", and its evidence table listed this one as "residue of a retired workflow —
moved to changesets". **That premise was wrong**, and a RETIRED label was briefly written here before
the tree was checked. What the tree actually says:

- 16 artefacts, `3.0.0-beta.62.md` … `3.0.0-beta.79.md`, and `3.0.0-beta.79` is the CURRENT
  `agent-cli` version — the last release produced its run file, so nothing lapsed.
- `.agents/rules/publish.md` makes it mandatory: a version-specific release-run file MUST exist here.
- `scripts/publish/publish-packages.sh` runs `pnpm harness:release:check -- --publish` on every
  publish, and `scripts/harness/check-release-governance.mjs` (registered in `run-all-scans.mjs`)
  enforces the machinery — including one rule that reads THIS file.

The heading is kept because the question will be asked again. The mistake worth recording is that
"retired" was asserted from a report rather than from the tree, in a change whose entire subject is
that the tree must be the thing that says so.
