---
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-tool-defaults': minor
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': minor
---

The execution containment seam states where tools run.

- **`ISandboxClient.filesystem`** (`'shared' | 'separate'`, absent means `separate`).
  - With a **separate** filesystem (E2B, in-memory), every file tool goes through the sandbox, and
    `Glob`/`Grep`, which can only read the host, are withheld. Previously a remote sandbox still
    offered host-reading search tools beside sandbox-writing edit tools.
  - With a **shared** filesystem (OS-level confinement over the host's files), file tools stay on
    the host under the path guard, and only commands go through the sandbox.
- **`describeExecutionContainment` / `routesFilesThroughSandbox`** name the containment (`host`,
  `sandbox-shared`, `sandbox-separate`) instead of inferring it from an absent value.
- **`robota doctor` reports `execution.containment`.** Robota composes no sandbox today, so the
  doctor says shell commands run unconfined on the host and the permission rules are the only
  boundary. The CLI composition and the doctor read the same value.
- **The `Agent` and `BackgroundProcess` tools no longer fall back to `process.cwd()`** when they
  were built without an execution root. They report an assembly error instead, as the file tools
  already did (ARCH-010).
