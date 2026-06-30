# TERM-008 — Cross-platform shell execution (Shell tool + shared resolver)

Spec: .agents/spec-docs/active/TERM-008-cross-platform-shell-execution.md
Status: implemented; verifying. Carved from TERM-007 item 1 (shell selection / hardcoded `sh`).

## Decision (recorded)

- SSOT resolver `resolvePlatformShell(env, platform)` in **agent-core** (`src/utils/platform-shell.ts`) —
  the only common ancestor of the three `sh` sites; pure fn of (env, platform), fully mockable.
- Tool: registered under **both** `Shell` and `Bash` (alias) — one OS-aware implementation. `Bash` kept
  for Anthropic model familiarity; `Shell` is the honest cross-platform name. Description built
  dynamically from the resolved shell (`label` + `syntaxHint`) so the model writes the right syntax.
- OS-aware hints name the OS family (macOS BSD vs Linux GNU vs Windows PowerShell/cmd) — both POSIX
  variants differ (e.g. `sed -i`, `date` flags), and Windows has cmd and PowerShell.
- win32 → PowerShell default, cmd via `ROBOTA_SHELL`; posix → `$SHELL` else `/bin/sh`.

## Phases

### Phase 1 — Resolver SSOT

- [x] `resolvePlatformShell` + `IPlatformShell`/`TShellKind` in agent-core; exported via utils barrel.
- [x] Unit tests (`platform-shell.test.ts`): posix `$SHELL`/`/bin/sh`/bash-vs-sh, win32 PowerShell +
      cmd override + pwsh override, `ROBOTA_SHELL` precedence, OS-family naming in the hint.

### Phase 2 — Rewire the three sh sites

- [x] `Shell`/`Bash` tool (`agent-tools/src/builtins/shell-tool.ts`, replaces `bash-tool.ts`).
- [x] hook `command` executor (`agent-core/.../command-executor.ts`) → resolver.
- [x] interactive `resolveShell()` (`agent-command`) → delegates to the resolver (Windows for free).
- [x] permission system (`TKnownToolName`, `MODE_POLICY`, `primaryArg`), reversible-execution
      `HOST_SHELL_TOOLS`, TUI `COMMAND_TOOL_NAMES`, assembly `createDefaultTools`/descriptions — all
      extended to know `Shell` alongside `Bash`.

### Phase 3 — Functional coverage (TEST-003 harness)

- [x] `shell-tool-functional.test.ts`: drives a REAL InteractiveSession via `scriptedSession`,
      exercising both the `Shell` tool and the `Bash` alias end-to-end (file written, tool call observed).
- [x] `shell-tool.test.ts` (agent-tools): names `Shell`/`Bash`, OS-aware description embeds label+hint,
      POSIX exec round-trip.

### Phase 4 — Verify

- [x] typecheck + build + tests green (agent-core 750, agent-tools 163, framework 1027, command 210, tui 377).
- [x] lint (0 errors) + `pnpm harness:scan` 39/39 green (final gate).

## Test Plan

- **Unit (agent-core `platform-shell.test.ts`):** `resolvePlatformShell` per platform — posix `$SHELL`
  honored / `/bin/sh` fallback / bash-vs-sh `kind`; win32 PowerShell default + `cmd.exe` override (cmd
  `/d /s /c`) + `pwsh.exe` override; `ROBOTA_SHELL` precedence; OS-family naming in the hint (macOS/BSD
  vs Linux/GNU). Platform mocked via the `(env, platform)` params — both Windows shells covered on any host.
- **Unit (agent-tools `shell-tool.test.ts`):** tool registers as `Shell` and `Bash`; description embeds
  the resolved `label` + `syntaxHint`; POSIX exec round-trip (`echo` → stdout + exit code).
- **Functional (agent-framework `shell-tool-functional.test.ts`, TEST-003 harness):** a REAL
  InteractiveSession drives both the `Shell` tool and the `Bash` alias end-to-end — a file is written
  in the isolated workspace and the tool call is observed.
- **Regression:** permission/reversible/TUI suites still green with `Shell` added to the known-tool sets;
  `create-tools` returns `[Shell, Bash, …]`.
- **Gate:** typecheck + build + lint (0 errors) + `pnpm harness:scan` 39/39.

## Docs updated

- agent-tools SPEC + README, agent-core SPEC (resolver), agent-framework SPEC, content/guide+examples,
  TERM-007 backlog (item 1 marked done here).
