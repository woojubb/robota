---
status: in-progress
type: INFRA
tags: [typescript]
---

# DOCAUDIT-004: SPEC cosmetic cleanup (P2)

## Problem

Minor path/casing/wording defects found by the 2026-06-19 audit. Low-risk, batched.

## Scope (AF-19, AF-20, AF-21, AF-22, AF-23, AF-24, AF-26)

- **AF-19** `agent-core` SPEC — hook executors are at `hooks/executors/command-executor.ts` /
  `hooks/executors/http-executor.ts`, not `hooks/command-executor.ts`.
- **AF-20** `agent-provider` SPEC — `dist/browser` is built but `package.json` `exports` has no
  `browser` condition; either note "built, not yet exposed" or wire the export (doc-side: note it).
- **AF-21** `agent-tool-mcp` SPEC — `RelayMcpTool` is asserted to `implements ITool` but the class
  has no `implements` clause (only a doc-comment); soften to "structurally ITool-shaped" or note it.
- **AF-22** `agent-web-ui` SPEC — Class Contract Registry says `AgentActivityPanel.tsx` carries
  `'use client'`; it does not. Correct the registry row.
- **AF-23** `agent-tools` SPEC — production deps are 3 (`fast-glob`, `p-limit`, `zod`), not "(2)".
- **AF-24** `agent-tools` SPEC — `IWorkspaceManifest` consumer is `interactive-session-options.ts`,
  not `interactive-session-init.ts`.
- **AF-26** `agent-remote-client` SPEC — `server.ts` is a JSDoc-header stub that exports nothing;
  drop "empty".

## Done When

- All cited paths/casing/dep-counts match code.
- `pnpm harness:scan` passes.

## Evidence Log
