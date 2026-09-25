# Permissions and Hooks

## Permission System

Defined in `agent-core`, consumed by `agent-session`. One deterministic evaluation order serves every caller — the interactive session, background tasks and subagents.

### Evaluation Algorithm

1. **Deny list**: if any deny pattern matches, return `deny`.
2. **Ceiling**: a background task or subagent carries one (its policy's allow list). A call outside it is `deny` in every mode.
3. **Unevaluable deny**: a deny pattern the gate cannot evaluate returns `approve` (ask).
4. **Never auto-approved**: return `approve` in every mode, `bypassPermissions` included, for:
   - an `ask` pattern match;
   - removing a critical path with `rm`/`rmdir` (the root, a top-level directory, home, the working directory or a parent);
   - a write into `.git`, `.robota`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a shell rc file.
5. **bypassPermissions**: return `auto`.
6. **Allow list**: if any allow pattern matches, return `auto` (no prompt).
7. **Mode policy**: look up the tool's risk class in the mode matrix.

`approve` goes to the attached approver, and with no approver it is a denial. In `plan` mode, `approve` for anything but a read-only tool is a denial.

Print mode (`robota -p`), `createQuery()` and headless sessions default to `default` mode and have no approver, so a call that would ask is denied. Pass `--permission-mode` / `permissionMode` to choose another mode.

### Permission Modes

| Mode                | Read | Write            | Bash             |
| ------------------- | ---- | ---------------- | ---------------- |
| `plan`              | auto | deny             | deny             |
| `default`           | auto | approve (prompt) | approve (prompt) |
| `acceptEdits`       | auto | auto             | approve (prompt) |
| `bypassPermissions` | auto | auto             | auto             |

#### Read-only commands

A Bash call whose every command is in the built-in read-only set is decided like a read, so it runs
without a prompt in every mode, `plan` included. The set is `ls`, `cat`, `echo`, `pwd`, `head`,
`tail`, `grep`, `wc`, `which`, `stat`, `du`, `cd`, `find` without `-exec`/`-delete`/`-fprint*`
predicates, and `git status`, `log`, `diff`, `show`, `rev-parse`, `ls-files`, `describe`,
plus the listing forms of `git branch` and `git remote`. The set is not configurable; add an `ask`
or `deny` rule to require a prompt for one of these.

A compound command qualifies only when each part does on its own. A command does not qualify when it:

- names a path outside the working directory: an absolute path, `~`, a `..` that climbs out, a
  PowerShell drive or provider (`C:x`, `Env:`), or a symlink whose target is outside;
- follows symlinks while recursing or reads a file named by an option (`grep -R`, `grep -f`,
  `find -L`, `ls -L`, `du -L`), or takes a file or a list of files through an option
  (`--exclude-from`, `--files0-from`);
- passes an unquoted glob, since it expands to names the check never sees;
- contains a non-ASCII character;
- writes through a redirect (`>`, `>>`, `&>`, `>&file`), except to `/dev/null` or another
  descriptor (`2>&1`);
- uses a here-doc, a variable, an escape, or any substitution, grouping, brace expansion or comment
  (`$`, `` ` ``, `\`, `(`, `{`, `#` and similar). These mean different things in bash, zsh, fish and
  PowerShell, so the gate does not guess;
- starts with a variable assignment (`PAGER=… git log`) or names a program by path (`./ls`);
- runs `git` with a global option (`-c`, `-C`), with `--output`, `--ext-diff` or `--no-index`, or
  after a `cd`;
- runs in a `workingDirectory` other than the session's.

### Pattern Syntax

```
Bash(pnpm *)        # Bash with command starting "pnpm "
Read(/src/**)        # Read for files under /src/
Write(*)             # Write with any argument
ToolName             # Match any invocation (no arg constraint)
Bash(run_in_background:true)  # deny/ask only: a named top-level parameter
github__*            # a tool-name glob: every tool of one MCP server
```

- A parameter rule (`Tool(name:value)`) applies to deny and ask lists only. A parameter the call omits never matches. A rule on the tool's primary field, such as `Bash(command:rm *)`, is reported at startup and asks on every call; write `Bash(rm *)` instead.
- An allow rule may glob the tool name only after a literal `<server>__` prefix.
- A deny that names a tool outright (`Bash`, `Bash(*)`, `github__*`) removes the tool from the model's tool list.

### Configuration

```json
{
  "permissions": {
    "allow": ["Read(*)", "Glob(*)", "Grep(*)", "Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"],
    "ask": ["Bash(git push *)"]
  }
}
```

Each list is the union of every settings layer that sets it: a project file adds to the user's rules and never replaces them.

## Hook System

Lifecycle hooks for extending session behavior. Defined in `agent-core` and `agent-framework`, consumed by `agent-session`.

### Events

The full, authoritative catalog — every event with its exact timing, fire-site, input fields, and
blocking semantics — lives in the SSOT
[`packages/agent-core/docs/HOOK-CATALOG.md`](../../packages/agent-core/docs/HOOK-CATALOG.md), kept
true to the code by the `scan-hook-catalog` drift guard. Summary:

| Event                | Timing                                        | Purpose                         | Blocking            |
| -------------------- | --------------------------------------------- | ------------------------------- | ------------------- |
| `PreToolUse`         | Before tool execution                         | Validation, **blocking** (gate) | **BLOCKING** (gate) |
| `PostToolUse`        | After tool execution                          | Logging, auditing               | Informational       |
| `PreCompact`         | Before context compaction                     | Validation                      | Informational       |
| `PostCompact`        | After context compaction                      | Notification (includes summary) | Informational       |
| `SessionStart`       | Session initialization                        | Setup                           | Informational       |
| `SessionEnd`         | Session teardown                              | Cleanup, flush                  | Informational       |
| `Stop`               | After a turn's response completes             | Cleanup                         | Informational       |
| `StopFailure`        | When a turn errors                            | Error notification              | Informational       |
| `UserPromptSubmit`   | Before user prompt sent                       | Prompt preprocessing, injection | Informational       |
| `SubagentStart`      | When a subagent starts                        | Subagent lifecycle tracking     | Informational       |
| `SubagentStop`       | When a subagent finishes/fails/cancels        | Subagent lifecycle tracking     | Informational       |
| `WorktreeCreate`     | When a subagent worktree is created           | Worktree lifecycle tracking     | Informational       |
| `WorktreeRemove`     | When a subagent worktree is removed           | Worktree lifecycle tracking     | Informational       |
| `PreModelCall`       | As a provider request goes out (per round)    | Observe model calls             | Informational       |
| `PostModelCall`      | After the provider response is normalized     | Observe model responses         | Informational       |
| `PermissionDecision` | Right after a tool-call permission is decided | Audit permission decisions      | Informational       |

Only `PreToolUse` can block. `PreModelCall`, `PostModelCall`, and `PermissionDecision` are
informational-only (fire-and-forget) despite the "Pre"/"Decision" naming — they cannot veto the
action they observe.

### Exit Code Protocol

| Code  | Meaning                        |
| ----- | ------------------------------ |
| 0     | Allow / proceed                |
| 2     | Block / deny (stderr = reason) |
| other | Proceed with warning           |

### Hook Types

| Type      | Layer           | Description                                                   |
| --------- | --------------- | ------------------------------------------------------------- |
| `command` | agent-core      | Shell command; receives JSON via stdin, uses exit codes       |
| `http`    | agent-core      | HTTP POST to a URL; supports env var interpolation in headers |
| `prompt`  | agent-framework | Single-turn LLM evaluation; returns model response            |
| `agent`   | agent-framework | Multi-turn subagent; runs a full agent loop                   |

### Hook Input

Hooks receive JSON via stdin:

```json
{
  "session_id": "session_1234",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "pnpm test" },
  "prompt": "the user's current prompt text"
}
```

The `prompt` field is included for Claude Code compatibility and contains the user's current prompt text (present for `UserPromptSubmit` and `SessionStart` events).

### Hook Stdout Injection

For `SessionStart` and `UserPromptSubmit` events, hook stdout is injected into the AI context as a `<system-reminder>` block. This allows hooks to dynamically provide instructions, context, or constraints to the model.

### Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "bash .hooks/validate-bash.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "bash .hooks/log-tool-use.sh" }]
      }
    ]
  }
}
```

Hooks have a 10-second timeout. Empty matcher matches all tools.

## Plugin Hooks

Plugins can define their own hooks in `hooks/hooks.json` within the plugin directory. Plugin hooks are merged into the session lifecycle alongside project-defined hooks.

### Environment Variables

Plugin hooks receive additional environment variables:

| Variable             | Description                       |
| -------------------- | --------------------------------- |
| `CLAUDE_PLUGIN_ROOT` | Root directory of the plugin      |
| `CLAUDE_PLUGIN_PATH` | Full path to the hook script      |
| `CLAUDE_PROJECT_DIR` | Current project working directory |
| `CLAUDE_SESSION_ID`  | Active session identifier         |

These environment variables use the `CLAUDE_` prefix for compatibility with Claude Code plugin conventions.

## Execution Loop Context Management

The session execution loop includes context budget checks to prevent exceeding the model's context window:

- **Pre-send hard guard**: Before each provider call, core checks effective context usage against 95% of the context window and returns diagnostic values if it must block. Routine auto-compaction runs earlier in `agent-session` at the configured threshold, defaulting to ~83.5%.
- **Tool result budget**: Individual tool results are checked against an 80% context budget. Results exceeding this limit are replaced with an error message indicating the output was too large.
- **Forced summary on turn exhaustion**: When `maxRounds` is exhausted, the session injects a synthetic user message and makes a final provider call without tools to produce a summary response.

See [agent-session SPEC.md](../../packages/agent-session/docs/SPEC.md) for implementation details.

## Subagent Hook Forwarding

When a subagent session is created (via `createSubagentSession`), it inherits the parent session's hooks configuration. All hook events (`PreToolUse`, `PostToolUse`, etc.) fire in the subagent context with the same handlers as the parent. This ensures consistent policy enforcement across the parent and all spawned subagents.
