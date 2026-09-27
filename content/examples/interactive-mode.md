# Interactive Mode

Running `robota` without `-p` opens the terminal UI: a coding-assistant session in the current
directory, built from the same Robota libraries as the SDK examples. This page walks through what you
see on screen. The [CLI guide](../guide/cli.md) is the full reference.

## Starting

```bash
robota                    # Start a new session
robota "Fix the bug"      # Start with an initial prompt
robota -c                 # Continue the most recent session
robota -r session_123     # Resume a session by ID or name
```

When you start a new session in a Git repository you have not trusted yet, `robota` first lists what
trusting it would load (the project's settings, hooks, plugins, skills, agent definitions, provider
overrides and MCP servers) and asks `Trust this folder? [y/N]`. Answering no starts the session
Restricted, without any of those; `robota trust --yes` trusts the folder later.

## Slash commands

Type `/` to open the command menu; it filters as you type. Tab inserts the highlighted command into the
input without running it, so you can add arguments. Enter runs it.

```
/help                Show available commands
/mode plan           Switch the permission mode (plan | default | acceptEdits | bypassPermissions | auto)
/permissions         Show or change the permission mode and permission rules
/compact [focus]     Compress the context window, keeping what the focus text names
/context             Context window usage, context references, auto-compact controls
/clear               Clear conversation history
/resume              Resume a previous session
/rename <name>       Rename the current session
/provider            Manage provider profiles
/memory              Inspect and manage project memory
/rewind              List, inspect and restore edit checkpoints
/background          List and control background tasks
/agent               Run or manage background subagent jobs
/statusline          Show, hide or reset the status line
/reload-plugins      Reload all plugin resources
/workflows           Author, list, validate and run DAG workflows
```

`/help` lists every command available in your session.

Skills and commands appear in the same menu. The CLI reads them from `.robota/skills/`,
`.claude/skills/`, `.claude/commands/` and `.agents/skills/`, in your home directory and, once the
folder is trusted, in the project.

## Permission prompts

In `default` mode, a file edit or a shell command asks first (read-only commands such as `ls` or
`git status` inside the project run without asking). The prompt appears above the input box:

```
[Permission Required]
Tool: Bash
 command: pnpm test

> Allow [y]
  Allow Bash(pnpm *) always (this session) [s]
  Allow Bash(pnpm *) always (this project) [p]
  Deny [n]
```

Move with the arrow keys and press Enter, or press the letter shown. The "always" options name the
pattern they grant, so you can see how far the approval reaches: `Bash(pnpm *)` covers every `pnpm`
command, and a file approval covers the file's directory tree. When the project cannot store a
project-wide approval, the third row reads `Project-wide approval unavailable`. For a short moment
after the prompt appears its keys do nothing, so a key you were typing into the input box cannot
answer it; Esc does not dismiss it.

## Status line

The line under the input box shows the session's state, for example:

```
Thinking  |  Mode: plan  |  auth-refactor  |  git: main  |  Anthropic claude-sonnet-4-6  |  Context: 45% (90K/200K tokens)
```

From left to right:

- **Activity** — `Idle`, `Thinking`, `Tools (n)` while tools run, `Background (n)` for background
  tasks, and `queued` when a prompt is waiting.
- **Mode** — shown for every permission mode except `default`: `plan`, `acceptEdits`,
  `bypassPermissions` or `auto`.
- **Preset** — shown when a preset other than `default` is active.
- **Session name** and **git branch**, when there is one.
- **Provider and model**, followed by `Effort: <level>` when an effort level is set.
- **Context** — how full the context window is, in green below 70%, yellow from 70% and red from 90%.

`/statusline off` hides the line, `/statusline git off` hides the branch, and `/statusline reset`
restores the defaults.

## Session name

The session name appears on the input box border, in the terminal title and in the status line. Set
it with `robota --name <name>` or `/rename <name>`.
