# Release Runs

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
