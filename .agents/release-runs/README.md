# Release Runs — RETIRED 2026-08-03

**This directory is residue of a retired workflow (HARNESS-066).** Releases moved to changesets; the
single artefact here (`3.0.0-beta.79.md`) is the last run recorded under the old scheme.

Kept rather than deleted, and labelled rather than left ambiguous: the distinction between "retired"
and "stalled" is the thing HARNESS-066 exists to preserve, and deleting the directory would erase the
evidence along with the confusion. `scripts/harness/release-run.mjs` still runs if invoked; nothing
invokes it.

---

## What it was

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
