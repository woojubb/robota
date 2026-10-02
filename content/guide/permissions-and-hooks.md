# Permissions and Hooks

## Permission System

Defined in `agent-core`, consumed by `agent-session`. One deterministic evaluation order serves every caller — the interactive session, background tasks and subagents.

### Evaluation Algorithm

Each call gets one of three answers: `auto` (run it), `approve` (ask a person) or `deny`. The steps
run in this order and the first one that decides wins:

1. **Deny list**: if any deny pattern matches, return `deny`.
2. **Ceiling**: a background task or subagent can carry one (its policy's allow list). A call outside
   it is `deny` in every mode.
3. **Peer turns**: `peer_reply` (answering another session's message) is `deny` outside a turn that
   a peer's message started, and `peer_send_file` is `deny` inside one. A peer turn changes nothing
   else; its other calls are decided like the session's own.
4. **Unevaluable deny**: a deny pattern the gate cannot evaluate returns `approve` (`deny` in `plan`
   mode).
5. **Never auto-approved**: return `approve` in every mode, `bypassPermissions` included, for:
   - an `ask` pattern match;
   - removing a critical path with `rm`/`rmdir` (the root, a top-level directory, home, the working
     directory or a parent);
   - a write into `.git`, `<project-state>`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a
     shell rc file.
6. **Ask for everything**: when the caller routes every remaining call to a person (a background
   task whose policy is `prompt`), return `approve`.
7. **bypassPermissions**: return `auto`.
8. **Allow list**: if any allow pattern matches, return `auto` (no prompt).
9. **Mode policy**: look up the tool's risk class in the mode matrix. A shell command the OS sandbox
   confines returns `auto` here in `default`, `acceptEdits` and `auto` mode when sandbox `auto-allow`
   is on. A tool with no declared risk class asks (`deny` in `plan` mode).

`approve` goes to the attached approver, and with no approver it is a denial. In `plan` mode, `approve` for anything but a read-only tool is a denial.

Print mode (`__PRODUCT_CLI_NAME__ -p`), `createQuery()` and headless sessions default to `default` mode and have no approver, so a call that would ask is denied. Pass `--permission-mode` / `permissionMode` to choose another mode.

### Permission Modes

| Mode                | Read | Write            | Bash             |
| ------------------- | ---- | ---------------- | ---------------- |
| `plan`              | auto | deny             | deny             |
| `default`           | auto | approve (prompt) | approve (prompt) |
| `acceptEdits`       | auto | auto             | approve (prompt) |
| `bypassPermissions` | auto | auto             | auto             |
| `auto`              | auto | auto             | classifier       |

#### Auto mode

In `auto` mode, a call the mode does not approve goes to a classifier instead of a prompt. The
classifier is a side call to the session's own model. It sees the call, the working directory and
the git remotes the repository had, and not the conversation. Text the agent read from a file or a
web page cannot argue for its own call.

- **What it blocks:**
  - downloading and running code;
  - sending data outside the working directory and its remotes;
  - deploys, releases and migrations;
  - mass or irreversible deletion;
  - force pushes and other destructive git operations;
  - touching credentials;
  - destroying infrastructure;
  - weakening tests, hooks or permission settings.

  A block goes back to the model with its reason.

- **What reaches a person:**
  - Deny rules still deny.
  - `ask` rules, critical removals and protected paths still ask a person.
  - After 3 refusals in a row (blocks, or no usable verdict), or 20 blocks in a session, the mode
    asks a person until one approves.
  - With no one to ask, such a call is denied.
- **Allow rules:** while the mode is on, allow rules that approve any command are set aside.
  Examples are `Bash(*)`, `Bash(python *)`, `Bash(npm run *)`, `Bash(pnpm *)` and `Agent`. Narrow
  rules such as `Bash(npm test)` still apply.
- **Retry:** a blocked call can be let through once with `/permissions retry <n>`, where `<n>` is
  its number under recent denials.
- **Turning it off:** an organization turns the mode off with `"disableAutoMode": true` in the org
  policy file.

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
- uses a short option outside each command's known-safe letters, which leaves out the ones that
  follow symlinks or read a named file (`grep -R`/`-S`/`-f`, `ls -L`, `du -L`, `find -L`), or a
  long option that takes a file or a list of files, abbreviated or not (`--exclude-from`,
  `--files0`, `--deref`);
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

### OS sandbox

Shell commands (`Bash`, `Shell`) can run inside an OS-level sandbox that confines the command and
every process it starts. Linux and WSL2 use [bubblewrap](https://github.com/containers/bubblewrap)
(`bwrap`, installed from the `bubblewrap` package); macOS uses the built-in Seatbelt
(`sandbox-exec`). Native Windows has no backend; run __PRODUCT_CLI_NAME__ inside WSL2 to use it.

Inside the sandbox:

- the whole filesystem is readable, except the paths in `filesystem.denyRead`;
- writes are allowed only in the working directory, the temporary directories and
  `filesystem.allowWrite`;
- inside the working directory, `.git`, `<project-state>`, `.claude`, `.agents`, `.mcp.json` and shell or
  npm config files stay read-only (isolated worktrees under `<project-state>/worktrees` stay writable).
  `.git` is read-only as a whole, so git commands that write — `commit`, `checkout`, `fetch` —
  fail inside the sandbox; add `git` to `excludedCommands` to run them on the host through the
  ordinary prompt. On Linux, when a command exits, one of these entries it created where none
  existed is moved to `<project-state>/sandbox-quarantine` (or `<user-state>/sandbox-quarantine` when the
  project has no `<project-state>` directory), and a symlink it replaced is restored, with a note in its
  output. Until that command exits the entry is on disk, so a session started meanwhile could read
  it. If an entry cannot be moved, commands ask until it is gone. While one of these entries is a
  symlink into a writable place (the working directory, a temporary directory, `allowWrite`) or
  points nowhere, commands are confined but never approved automatically;
- everything else in the working directory is the command's to change, just as it is the file
  tools'. A nested repository, a `package.json` script or a `Makefile` it writes is project content:
  review changes before running host tools over them. In `auto-allow` this includes `default`
  mode, where the file tools would still have asked, and a git directory planted in the project runs
  its configured programs on the next `git status` — including one a git-aware shell prompt runs;
- the network is reachable only when `network.enabled` is `true`, and while it is off Unix
  sockets are closed too, so a daemon on the host (a container engine, the session bus, an ssh
  agent) is out of reach. With the network on, those sockets are reachable, and a container
  engine's socket is as good as running on the host. There is no per-domain list;
- the command runs in its own process namespace and cannot signal or inspect __PRODUCT_CLI_NAME__ or other host
  processes.

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker"],
    "failIfUnavailable": false,
    "filesystem": { "allowWrite": ["~/.cache"], "denyRead": ["~/.ssh"] },
    "network": { "enabled": false }
  }
}
```

The keys merge like other settings, so a trusted project's settings can change them — including
widening `allowWrite` or turning the network on — just as they can add allow rules.

**Modes.** `/sandbox` shows the state and switches mode for the next command; the choice is saved in
the user settings, where a project or local setting that sets the same key still wins at the next
start.

- `auto-allow` (`autoAllowBashIfSandboxed: true`): a confined command runs without a prompt in
  `default` and `acceptEdits`. Deny rules, ask rules, removal of a critical path and plan mode still
  apply first. Only `Bash` and `Shell` calls are confined; a background process or a
  model-invoked command still asks.
- `regular`: commands are confined and the permission prompts work as usual.
- `off`: commands run on the host.

`excludedCommands` names programs that run unconfined and take the ordinary permission path; it
applies to a line that runs only that program, so `docker ps; rm -rf build` stays confined. The model
cannot ask to leave the sandbox.

**When it cannot run.** If `bwrap` is missing or cannot create a sandbox (for example where user
namespaces are disabled), __PRODUCT_CLI_NAME__ prints a warning at startup and runs commands unconfined;
`__PRODUCT_CLI_NAME__ doctor` and `/sandbox` say what is missing. With `failIfUnavailable: true` __PRODUCT_CLI_NAME__ refuses to
start instead.

**Containers and VMs.** The sandbox confines what a command can write and reach; it does not
isolate __PRODUCT_CLI_NAME__ itself, its file tools, or its model traffic. A dev container or VM isolates the
whole process, including everything the sandbox leaves readable. Use the sandbox to stop a command
from changing things outside the project, and a container or VM when nothing on the host should be
visible at all.

### Pattern Syntax

```
Bash(pnpm *)        # Bash with command starting "pnpm "
Read(/src/**)        # Read for files under /src/
Write(*)             # Write with any argument
ToolName             # Match any invocation (no arg constraint)
Agent(model:opus*)  # deny/ask only: a named top-level parameter
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

The full catalog, with each event's exact timing, input fields and blocking behavior, is
[`packages/agent-core/docs/HOOK-CATALOG.md`](../../packages/agent-core/docs/HOOK-CATALOG.md). Summary:

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

### How a hook answers

Each hook run ends in one of three outcomes:

| `command` hook exit                  | Other hook types                   | Outcome | On `PreToolUse`                                 |
| ------------------------------------ | ---------------------------------- | ------- | ----------------------------------------------- |
| `0`                                  | `{ "ok": true }`                   | allow   | The call goes on to the normal permission check |
| `2` (stderr is the reason)           | `{ "ok": false, "reason": "..." }` | deny    | The call is refused with the reason             |
| any other code, a timeout, a failure | an unreadable or failed response   | error   | The call is refused: no verdict is not approval |

An `allow` outcome alone does not approve a call: it only lets the call continue to the permission
rules and mode. On `PreToolUse`, an `allow` whose stdout is JSON with `"continue": false` or
`hookSpecificOutput.permissionDecision: "deny"` refuses the call. A `command` hook's
`hookSpecificOutput.permissionDecision` can also steer it:

- `"allow"` skips the prompt you would otherwise get. Deny rules, the mode's refusals, the `auto`
  mode classifier and `ask` rules still apply.
- `"ask"` asks you even when the mode or an earlier "always allow" would run the call. With no one to
  ask, the call is refused.
- `"defer"` leaves the call to the normal permission check.

For command hooks, the highest-priority `permissionDecision` wins (`deny` > `ask` > `defer` >
`allow`). Its accompanying `updatedInput` replaces the call's arguments; among equally ranked
decisions, the last supplied replacement wins. A replacement without a named decision is ignored.
All PreToolUse hooks run again
against the rewritten input before permission rules, prompts or execution; a rewrite cycle is
refused. Hooks may therefore run more than once for a call. A delegated action or arguments already
settled by a tool cannot be replaced and are refused instead. `http`, `prompt`, `agent` and
`guardrail` hooks can only refuse a call.

On every other event the outcome is recorded and nothing is blocked.

### Hook Types

| Type        | Layer           | Description                                                                 |
| ----------- | --------------- | --------------------------------------------------------------------------- |
| `command`   | agent-core      | Shell command; receives the input as JSON on stdin, answers by exit code    |
| `http`      | agent-core      | POSTs the input as JSON to a URL; `$VAR` references in headers are expanded |
| `prompt`    | agent-framework | Asks a model to judge the input                                             |
| `agent`     | agent-framework | Runs a subagent session on the input                                        |
| `guardrail` | agent-core      | Runs guardrail functions an SDK host registered; the first failure denies   |

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

### Hook Output as Context

The output of a `UserPromptSubmit` hook is added to the prompt inside a `<system-reminder>` block,
and a `SessionStart` hook's output is added the same way to the session's first prompt. Hooks use
this to give the model instructions or context. A `UserPromptSubmit` hook cannot stop the prompt.

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

An empty matcher matches every tool. Each hook can set `timeout` in seconds; without one, a
`command` hook may run for 600 seconds, an `agent` hook for 60 and an `http` hook for 10.

## Plugin Hooks

Plugins can define their own hooks in `hooks/hooks.json` within the plugin directory. Plugin hooks are merged into the session lifecycle alongside project-defined hooks.

### Environment Variables

Plugin hooks receive additional environment variables:

| Variable             | Description                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `CLAUDE_PLUGIN_ROOT` | The plugin's root directory (also substituted as `${CLAUDE_PLUGIN_ROOT}` in hook commands) |
| `CLAUDE_PLUGIN_PATH` | The plugin's root directory (same value as `CLAUDE_PLUGIN_ROOT`)                           |
| `CLAUDE_PLUGIN_DATA` | A data directory for the plugin                                                            |

Like every command hook, plugin hooks also receive `CLAUDE_PROJECT_DIR` (the project working
directory) and `CLAUDE_SESSION_ID` (the session id). The `CLAUDE_` prefix keeps Claude Code plugins
working unchanged.

## Execution Loop Context Management

The session execution loop includes context budget checks to prevent exceeding the model's context window:

- **Pre-send hard guard**: Before each provider call, core checks effective context usage against 95% of the context window and returns diagnostic values if it must block. Routine auto-compaction runs earlier in `agent-session` at the configured threshold, defaulting to ~83.5%.
- **Tool result budget**: Individual tool results are checked against an 80% context budget. Results exceeding this limit are replaced with an error message indicating the output was too large.
- **Forced summary on turn exhaustion**: When `maxRounds` is exhausted, the session injects a synthetic user message and makes a final provider call without tools to produce a summary response.

See [agent-session SPEC.md](../../packages/agent-session/docs/SPEC.md) for implementation details.

## Subagent Hook Forwarding

When a subagent session is created (via `createSubagentSession`), it inherits the parent session's hooks configuration. All hook events (`PreToolUse`, `PostToolUse`, etc.) fire in the subagent context with the same handlers as the parent. This ensures consistent policy enforcement across the parent and all spawned subagents.
