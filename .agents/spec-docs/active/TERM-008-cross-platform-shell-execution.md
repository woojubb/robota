---
status: in-progress
type: INFRA
tags: [typescript, cross-platform, windows, shell, tools]
---

# TERM-008: Cross-platform shell execution (Shell tool + shared resolver)

> Carved out of [TERM-007](../../backlog/TERM-007-windows-support-followup.md) item 1 (shell
> selection / `BashTool` hardcoded `sh`). TERM-007 retains the TUI terminal-capability / ConPTY / PTY
> items. This spec covers **only the non-interactive shell-execution slice** and is implemented now.

## Problem

Shell execution is hardcoded to POSIX `sh` in three places, so every shell-running path is
**non-functional on Windows** (no `sh` on a default Windows install):

| Site                                                          | Role                                 | Today                       |
| ------------------------------------------------------------- | ------------------------------------ | --------------------------- |
| `packages/agent-tools/src/builtins/bash-tool.ts`              | LLM `Bash` tool (host command exec)  | `spawn('sh', ['-c', cmd])`  |
| `packages/agent-core/src/hooks/executors/command-executor.ts` | hook `command` executor              | `spawn('sh', ['-c', cmd])`  |
| `packages/agent-command/src/shell/resolve-shell.ts`           | interactive drop-to-shell (`/shell`) | seam exists, **POSIX-only** |

There are **two** failure layers, not one:

1. **Execution fails** — `sh` does not exist, so the spawn errors on Windows.
2. **Even if it ran, the command would be wrong** — the tool is named `Bash` and its description tells
   the model to write bash. On a PowerShell/cmd host the model emits bash syntax that the host shell
   cannot run. The _tool surface itself_ must tell the model which shell/OS is active.

Reproduction: on Windows, the `Bash` tool, hook `command` executors, and `/shell` all fail; on any
platform the model has no signal that the host shell differs from bash.

## Architecture Review

### Affected Scope

- **New (util, SSOT):** `packages/agent-core/src/utils/platform-shell.ts` — `resolvePlatformShell()`
  returns the active shell for a given `(platform, env)`: executable, `commandArgs(cmd)`,
  `interactiveArgs`, shell `kind`, a human `label`, and an LLM-facing `syntaxHint`. `agent-core` is the
  only common ancestor of all three sites (`agent-tools → core`, `agent-command → core`, and `core`
  itself owns `command-executor`), and it already spawns shells — so the SSOT belongs here. It is a
  dependency-free pure util, so it does not violate the agent-core zero-(agent-)deps rule.
- **Renamed (tool):** `Bash` → `Shell`. `bash-tool.ts` → `shell-tool.ts` (`createShellTool`,
  `shellTool`). The tool keeps one stable identity but builds its **description dynamically** from the
  resolved shell (`label` + `syntaxHint`), so the model is told the active shell/OS and writes the
  right syntax. No `Bash` alias is kept (unreleased project; no backward-compat).
- **Rewired (3 sites):** the Shell tool, `command-executor`, and `agent-command`'s `resolveShell()` all
  consume `resolvePlatformShell()`. `resolve-shell.ts` becomes a thin adapter over the core resolver
  (gaining Windows support for free and removing the divergent POSIX-only copy).
- **Assembly:** `create-tools.ts` swaps `createBashTool` → `createShellTool` and the
  `DEFAULT_TOOL_DESCRIPTIONS` `Bash —` entry → `Shell —`.
- **Out of scope:** TUI terminal-capability / ConPTY / `node-pty` (remain in TERM-007); the sandbox
  execution path (already delegates to an `ISandboxClient`, typically Linux — unchanged).

### Contract

```ts
export type TShellKind = 'bash' | 'sh' | 'powershell' | 'cmd';

export interface IPlatformShell {
  command: string; // executable to spawn
  kind: TShellKind; // shell family (drives quoting + hints)
  platform: NodeJS.Platform; // platform resolved for
  commandArgs(command: string): string[]; // non-interactive single-command args
  interactiveArgs: string[]; // interactive (drop-to-shell) args
  label: string; // human label, e.g. 'PowerShell (Windows)'
  syntaxHint: string; // LLM guidance, e.g. 'Write POSIX sh/bash syntax'
}

// Pure + deterministic: pass platform/env to test every branch without touching the host.
export function resolvePlatformShell(
  env?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): IPlatformShell;
```

Resolution rules (deterministic, no filesystem/PATH probing, no new deps):

- **win32:** PowerShell — `command='powershell.exe'`, `kind='powershell'`,
  `commandArgs(cmd)=['-NoProfile','-Command',cmd]`, `interactiveArgs=['-NoProfile']`. An explicit
  `ROBOTA_SHELL` env override is honored first (e.g. point at `pwsh.exe` or `%ComSpec%`).
- **posix (darwin/linux/other):** `command = ROBOTA_SHELL || $SHELL || '/bin/sh'`,
  `kind = basename includes 'bash' ? 'bash' : 'sh'`, `commandArgs(cmd)=['-c',cmd]`,
  `interactiveArgs=[]`.

### Risk

Anthropic models are most fluent with a tool literally named `Bash`. Renaming to `Shell` is an explicit
product decision (chosen to make the surface honest cross-platform); the dynamic description (active
shell + syntax hint) is the mitigation. Tracked here so the tradeoff is visible.

## Test Plan

- **Unit (`agent-core`):** `resolvePlatformShell()` for `win32` (PowerShell args + `ROBOTA_SHELL`
  override), `darwin`/`linux` (`$SHELL` honored, `/bin/sh` fallback, bash-vs-sh `kind`), and `commandArgs`
  shape per shell. Mock via the `(env, platform)` params — no host dependency.
- **Unit (`agent-tools`):** `createShellTool` description embeds the resolved `label`/`syntaxHint`;
  POSIX exec round-trip (`echo` → stdout, exit code) preserved; tool name is `Shell`.
- **Unit (`agent-core` hooks):** `command-executor` runs via the resolved shell (POSIX behavior
  unchanged; spawn arg shape asserted for a mocked `win32`).
- **Regression:** `agent-command` shell-command still drops to the resolved interactive shell on POSIX.
- typecheck / lint / build / `pnpm harness:scan` green.

## TC Coverage Map

| TC                                        | Covered by                                   |
| ----------------------------------------- | -------------------------------------------- |
| TC-01 (resolver per-platform correctness) | agent-core platform-shell unit tests         |
| TC-02 (Shell tool OS-aware description)   | agent-tools shell-tool unit tests            |
| TC-03 (3 sites consume one resolver)      | tool + command-executor + resolveShell tests |
| TC-04 (POSIX behavior unchanged)          | exec round-trip + agent-command regression   |

## User Execution Test Scenarios

- **POSIX (now, this host):** built CLI — invoke the `Shell` tool with a command (e.g. `echo hi`),
  confirm stdout + exit code; run a hook `command`; run `/shell` and confirm drop-to-shell. Evidence
  recorded from the local run.
- **Windows (CI-verified for shell exec):** the `windows-shell` CI job (`windows-latest`, added in
  TERM-007) builds agent-core and runs the resolver + Shell-tool tests on every PR — the Shell tool
  actually spawns `powershell.exe` and executes. Evidence: **first run green** (PR #900, 1m34s). The
  interactive `/shell` drop-to-shell + IME on real Windows Terminal is not CI-exercisable and remains a
  manual Windows-Terminal pass tracked under TERM-007.
