# CLI Reference

`@robota-sdk/agent-cli` is a purely CLI entry point that wires providers, transports, and commands into a terminal experience. `InteractiveSession` (from `@robota-sdk/agent-framework`) drives all session logic. The CLI has no session logic of its own: `TuiStateManager` (in `agent-transport/tui`) receives session events and produces an immutable state snapshot consumed by the Ink React component tree. All session logic — command handling, prompt queuing, system commands, skill discovery — lives in the framework layer.

State is managed by `TuiStateManager`, a pure TypeScript class (no React dependency) that receives SDK events and produces an immutable state snapshot. The `useInteractiveSession` hook wraps `TuiStateManager` and feeds its output into the React component tree via `useState`.

## Installation

```bash
# Try it now — no install needed
npx @robota-sdk/agent-cli

# Install globally for persistent use
npm install -g @robota-sdk/agent-cli
```

## Usage

```bash
robota                              # Interactive TUI
robota "initial prompt"             # TUI with initial message
robota -p "prompt"                  # Print mode (one-shot, exits after response)
robota -c                           # Continue last session
robota -r <session-id>              # Resume specific session
robota --permission-mode plan       # Permission mode override
robota --max-turns 10               # Limit agentic turns
robota --output-format json         # Output format (text/json/stream-json)
robota --append-system-prompt "..." # Append to system prompt
robota --configure                  # Interactive provider setup
robota --provider qwen              # Run with a configured provider profile
robota --reset                      # Delete user settings and exit
robota --check-update               # Check npm for a newer CLI version and exit
robota --disable-update-check        # Skip startup update check for this run
robota --version                    # Show version
```

## CLI Updates

Robota checks npm package metadata for newer `@robota-sdk/agent-cli` versions and uses npm itself for updates. It does not include a self-updater.

```bash
robota --check-update
```

When a newer version is available, the CLI prints:

```bash
npm install -g '@robota-sdk/agent-cli@latest'
```

Startup checks are rate-limited by a user-level cache at `~/.robota/update-check.json`. They do not create or modify `~/.robota/settings.json`, and they can be skipped for one invocation with `--disable-update-check`.

## Non-Interactive (Headless) Mode

Print mode (`-p`) runs a single prompt without the interactive TUI and exits. It delegates to `@robota-sdk/agent-transport/headless` for output formatting. When the prompt starts with `/skill-name`, headless mode calls `InteractiveSession.executeCommand()`, and the SDK normalizes the virtual skill alias to command `skills` with args `<skill-name> [args]`.

### Output Formats

Use `--output-format` to control how the response is written to stdout:

**Text (default):**

```bash
robota -p "Explain this error"
# Prints plain text response to stdout
```

**JSON:**

```bash
robota -p "Summarize the project" --output-format json
# Output: { "type": "result", "result": "...", "session_id": "...", "subtype": "success" }
```

**Stream JSON (newline-delimited):**

```bash
robota -p "Write a function" --output-format stream-json
# Each line is a JSON object: content_block_delta events followed by a final result
```

### Stdin Pipe

When `-p` is specified without a positional argument and stdin is piped, the CLI reads from stdin:

```bash
echo "Explain this code" | robota -p
cat error.log | robota -p "What went wrong?"
git diff | robota -p "Review this diff" --output-format json
```

### System Prompt Append

```bash
robota -p "query" --append-system-prompt "Focus on security issues"
robota -p "query" --json-schema '{"type":"object"}'
```

### Exit Codes

| Code | Meaning |
| ---- | ------- |
| 0    | Success |
| 1    | Error   |

## CI/CD Integration

`robota -p` headless mode is designed for unattended script and pipeline use.
No TUI is rendered; stdout carries only the response (or structured JSON), making it safe to capture.

### GitHub Actions

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install Robota CLI
        run: npm install -g @robota-sdk/agent-cli

      - name: AI Diff Review
        run: |
          git diff HEAD~1 | robota -p "Review this diff and list any issues" \
            --permission-mode bypassPermissions \
            --no-session-persistence \
            --output-format json
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Piping Input

Feed context from any command directly into Robota:

```bash
# Review a git diff
git diff HEAD~1 | robota -p "Review this diff"

# Summarise test output
pnpm test 2>&1 | robota -p "Summarise failures and suggest fixes"

# Analyse a file
cat src/index.ts | robota -p "Find security issues"
```

### CI-Specific Flags

| Flag                                  | Purpose                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `--permission-mode bypassPermissions` | Skip all confirmation prompts — required for unattended runs |
| `--no-session-persistence`            | Do not write session files to disk                           |
| `--output-format json`                | Machine-readable output; parse with `jq`                     |
| `--output-format stream-json`         | Newline-delimited JSON for streaming pipelines               |
| `--max-turns <n>`                     | Limit agentic loops to prevent runaway costs                 |

### Parsing JSON Output

```bash
# Extract just the text result
robota -p "Summarise the project" --output-format json | jq -r '.result'

# Check success
result=$(robota -p "Run checks" --output-format json)
if [ "$(echo "$result" | jq -r '.subtype')" = "success" ]; then
  echo "AI review passed"
fi
```

### Environment Variables in CI

Store provider API keys as encrypted secrets and inject them as environment variables.
Robota reads them using the same names as in local development:

```bash
ANTHROPIC_API_KEY=...   # Claude (default)
OPENAI_API_KEY=...      # OpenAI
GEMINI_API_KEY=...      # Gemini
```

## Interactive TUI

The TUI (built with React + Ink) provides:

- **Message list** — Conversation history with markdown rendering
- **Input area** — Text input with slash command autocomplete
- **Status bar** — Permission mode, model, context usage %, and activity state
- **Permission prompts** — Arrow-key Allow/Deny selection for tool calls
- **Streaming** — Real-time text output as the model responds
- **Usage summaries** — Provider usage and cost metadata when available
- **Background work tree** — Running and completed background jobs grouped for quick scanning
- **ESC abort** — Press ESC during streaming to cancel. Partial response is saved with interrupted state
- **History SSOT** — Renders from `IHistoryEntry[]` — the universal timeline of chat messages and session events

### Recent TUI Behavior

The CLI is intentionally a thin TUI over SDK-owned session state. Recent updates focus on making long agentic runs readable:

- Command output transcripts collapse automatically so long shell output does not dominate the conversation.
- Edit tool results render as context hunks with markdown-friendly diff blocks.
- Provider usage summaries appear in the primary scan path when token/cost metadata is present.
- Background subagent work renders as tree rows with status activity instead of a flat list.
- Print/headless mode skips startup update checks so scripted stdout/stderr remain deterministic.

### useInteractiveSession Hook

The `useInteractiveSession` hook is the sole bridge between `InteractiveSession` (SDK) and the React component tree. It:

1. Receives an `InteractiveSession` instance as its argument.
2. Passes SDK events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `context_update`, `error`) to a `TuiStateManager` instance.
3. Exposes derived React state and actions (`submit`, `abort`, `cancelQueue`).

The state shape exposed to components includes `history: IHistoryEntry[]` — the universal timeline of chat messages and session events. Components render from this single list; there is no separate `messages` array.

`TuiStateManager` is a pure TypeScript class with no React dependency. It can be instantiated and tested independently of the component tree, making state transition logic fully unit-testable.

The CLI contains no session management logic beyond this hook. The old `useSession`, `useSubmitHandler`, `useSlashCommands`, `useCommandRegistry`, and `useMessages` hooks have been removed; session execution lives in `InteractiveSession`, and command discovery uses SDK-owned command registry/source classes.

## Slash Commands

Type `/` to trigger the autocomplete popup. Arrow keys to navigate, Tab to insert into input (without executing), Enter to execute immediately.

The available command list is built from the consolidated `@robota-sdk/agent-command` package, which bundles all 20 command modules. The CLI renders this list but does not own the command definitions.

| Command                   | Description                                         |
| ------------------------- | --------------------------------------------------- |
| `/help`                   | Show available commands                             |
| `/clear`                  | Clear conversation history                          |
| `/compact [instructions]` | Compress context window                             |
| `/cost`                   | Show session info                                   |
| `/context`                | Context window details                              |
| `/permissions [mode]`     | Show permission rules or change mode                |
| `/memory`                 | Inspect and manage project memory                   |
| `/rewind`                 | List and restore edit checkpoints                   |
| `/provider`               | Manage provider profiles                            |
| `/resume`                 | Resume a previous session                           |
| `/background`             | List and control background tasks                   |
| `/agent`                  | Run and manage background subagent jobs             |
| `/rename`                 | Rename the current session                          |
| `/validate-session`       | Validate replay-grade session log data              |
| `/exit`                   | Exit CLI                                            |
| `/plugin`                 | Plugin management                                   |
| `/reload-plugins`         | Reload all plugin resources                         |
| `/language [lang]`        | Show or change UI language                          |
| `/settings`               | Open transport settings (enable/disable transports) |
| `/statusline`             | Show, hide, or reset status line fields             |
| `/reset`                  | Delete settings and exit                            |

`/permissions` shows a nested submenu for permission mode selection.

`/provider` and `/provider list` show configured provider profiles. In the interactive TUI, selecting a profile opens provider actions for switch, edit, test, duplicate, delete, and cancel. `/provider switch <profile>` hot-swaps the provider immediately without restarting — conversation history is preserved. In print/headless mode, provider commands keep deterministic text output and do not wait for interactive prompts.

### Plugin Management

Plugins extend the CLI with additional skills, hooks, and tools. They are stored in `~/.robota/plugins/` (user scope) or `.robota/plugins/` (project scope).

**Interactive TUI (`/plugin`):**

Typing `/plugin` opens an interactive menu with arrow-key navigation:

```
Plugin Management
│
├─ Marketplace
│    ├─ Add Marketplace      → enter source (owner/repo or git URL)
│    └─ <marketplace-name>   → Browse plugins / Update / Remove
│         └─ Browse          → plugin list → Install (scope) or Uninstall
│
└─ Installed Plugins
     └─ <plugin-name>       → Uninstall (with confirmation)
```

Navigate with arrow keys, Enter to select, Esc to go back.

**Text subcommands** (also available when typed directly):

```bash
/plugin install <name>@<marketplace>   # Install plugin
/plugin uninstall <name>@<marketplace> # Uninstall plugin
/plugin enable <name>@<marketplace>    # Enable plugin
/plugin disable <name>@<marketplace>   # Disable plugin
/plugin marketplace add <source>       # Add marketplace source
/plugin marketplace remove <name>      # Remove marketplace
/plugin marketplace update <name>      # Update marketplace
/plugin marketplace list               # List registered marketplaces
```

Use `/reload-plugins` to reload plugin resources and refresh plugin-provided slash commands without restarting the CLI.

### Official Plugins

The Robota SDK ships five first-party plugins for common integrations.
Each plugin extends `AbstractPlugin` and registers its tools automatically when added to an agent.

| Package                     | Plugin class   | Env variable      | Description                      |
| --------------------------- | -------------- | ----------------- | -------------------------------- |
| `@robota-sdk/plugin-github` | `GitHubPlugin` | `GITHUB_TOKEN`    | GitHub issues and pull requests  |
| `@robota-sdk/plugin-slack`  | `SlackPlugin`  | `SLACK_BOT_TOKEN` | Post messages and read history   |
| `@robota-sdk/plugin-jira`   | `JiraPlugin`   | `JIRA_API_TOKEN`  | Jira issues and project queries  |
| `@robota-sdk/plugin-linear` | `LinearPlugin` | `LINEAR_API_KEY`  | Linear issues and team queries   |
| `@robota-sdk/plugin-notion` | `NotionPlugin` | `NOTION_TOKEN`    | Notion pages and database search |

**Quick setup:**

```bash
npm install @robota-sdk/plugin-github @robota-sdk/plugin-slack \
            @robota-sdk/plugin-jira   @robota-sdk/plugin-linear \
            @robota-sdk/plugin-notion
```

```typescript
import { GitHubPlugin } from '@robota-sdk/plugin-github';
import { SlackPlugin } from '@robota-sdk/plugin-slack';
import { JiraPlugin } from '@robota-sdk/plugin-jira';
import { LinearPlugin } from '@robota-sdk/plugin-linear';
import { NotionPlugin } from '@robota-sdk/plugin-notion';

agent
  .use(new GitHubPlugin({ token: process.env.GITHUB_TOKEN! }))
  .use(new SlackPlugin({ token: process.env.SLACK_BOT_TOKEN!, defaultChannel: '#alerts' }))
  .use(
    new JiraPlugin({
      baseUrl: process.env.JIRA_URL!,
      email: process.env.JIRA_EMAIL!,
      apiToken: process.env.JIRA_API_TOKEN!,
    }),
  )
  .use(new LinearPlugin({ apiKey: process.env.LINEAR_API_KEY! }))
  .use(new NotionPlugin({ token: process.env.NOTION_TOKEN! }));
```

See each package's `README.md` for the full API reference.

### Provider Switch (`/provider switch`)

`/provider switch <profile>` hot-swaps the active provider without restarting the session. The provider is replaced in-place and conversation history is preserved. The profile name must already exist in settings (configured via `--configure-provider` or `/provider add`).

From the interactive TUI, selecting a provider profile from `/provider list` and choosing **switch** performs the same hot-swap.

### Skill Commands

Skills are activated through the `skills` built-in command module, rendered as `/skills` by the CLI. The CLI only parses the leading slash and calls `InteractiveSession.executeCommand()`: `/audit src/index.ts` is a virtual alias that the SDK normalizes to command `skills` with args `audit src/index.ts`. `.agents/` is the primary Robota convention; `.claude/` paths provide Claude Code compatibility. At runtime, higher-priority paths override lower ones:

1. `.agents/skills/` (project, Robota primary)
2. `.claude/skills/` (project, Claude Code compatible)
3. `.claude/commands/` (project, Claude Code legacy)
4. `~/.robota/skills/` (user)

Skills appear as additional slash commands below the built-in commands.

Plugin skills appear with a hint showing their source: `/audit (rulebased-harness) Run audit checks`
Plugin commands use colon format: `/rulebased-harness:audit`

### Skill Frontmatter

Each skill is a markdown file with YAML frontmatter controlling its behavior:

| Field                      | Type    | Description                                            |
| -------------------------- | ------- | ------------------------------------------------------ |
| `name`                     | string  | Display name for the slash command                     |
| `description`              | string  | One-line description shown in autocomplete             |
| `argument-hint`            | string  | Placeholder text for the argument (e.g., `<file>`)     |
| `disable-model-invocation` | boolean | If true, model cannot auto-invoke this skill           |
| `user-invocable`           | boolean | If false, only the model can invoke (not via `/` menu) |
| `allowed-tools`            | array   | Tool allowlist for the skill's execution context       |
| `model`                    | string  | Model override for skill execution                     |
| `effort`                   | string  | Reasoning effort level                                 |
| `context`                  | string  | Execution context; `fork` spawns a subagent            |
| `agent`                    | string  | Agent definition name for subagent execution           |

### Variable Substitution

Skill markdown bodies support variable substitution before execution:

- `$ARGUMENTS` / `$ARGUMENTS[N]` — Full argument string or Nth argument
- `$N` — Shorthand for Nth positional argument
- `${CLAUDE_SESSION_ID}` — Current session ID
- `${CLAUDE_SKILL_DIR}` — Directory containing the skill file

### Shell Preprocessing

Use the `` !`command` `` syntax to embed shell command output into the skill body at invocation time. The command runs in the project working directory.

### Invocation Methods

- **User direct**: Type `/skill-name` in the input area, or pass `/skill-name ...` to print/headless mode
- **Natural-language request**: Prompts such as `Use the repo-writing skill ...` remain normal model input; the model must activate the skill through the projected `robota_command_skills` tool with `args: "<skill-name> [args]"`
- **Skill discovery**: Use `/skills` to list registered skills and show the activation contract. Model-side selection uses the system prompt `## Skills` metadata when `skills` is model-invocable.
- **Model command invocation**: The model activates a matching skill through the standard projected command tool `robota_command_skills` with `args: "<skill-name> [args]"`.
- **Model-only**: Skills with `user-invocable: false` are invisible in the `/` menu but available to the model

Skill descriptions are metadata only. Mentioning or recommending a skill in ordinary assistant text
does not activate that skill; activation is recorded only when `/skills` or an explicit virtual
`/skill-name` invocation loads the full `SKILL.md` through SDK skill activation.

When `context: fork` is set, the skill runs in a spawned subagent session rather than the main conversation. See [agent-framework SPEC.md](../../packages/agent-framework/docs/SPEC.md) for details.

## Session Management

The CLI supports continuing, resuming, forking, and naming sessions for workflow continuity across invocations.

### Continue and Resume

```bash
robota -c                    # Continue the most recent session
robota -r <session-id>       # Resume a specific session by ID
robota -r <session-id> --fork-session # Fork a session (new session with copied history)
robota --name "my-task"      # Assign a name to the session at startup
```

Within the TUI, use `/resume` to list recent sessions and select one to resume. Use `/rename <name>` to rename the current session. Use `/validate-session` to validate the current JSONL session log for replay-grade provider/tool coverage.

### Session Names

When a session has a name, it is displayed in the input area border, the terminal title bar, and the status bar. Names make it easy to identify sessions when resuming later.

## Permission Modes

| Mode                | Read | Write  | Bash   |
| ------------------- | ---- | ------ | ------ |
| `plan`              | auto | deny   | deny   |
| `default`           | auto | prompt | prompt |
| `acceptEdits`       | auto | auto   | prompt |
| `bypassPermissions` | auto | auto   | auto   |

When a tool requires approval, the TUI shows a permission prompt with arrow-key selection.

The status bar hides `default` permission mode because it is the baseline. Non-default permission
modes remain visible as `Mode: plan`, `Mode: acceptEdits`, or `Mode: bypassPermissions`.

## Context Window

The status bar shows context usage with color coding:

| Range  | Color  | Meaning                         |
| ------ | ------ | ------------------------------- |
| 0–69%  | Green  | Healthy                         |
| 70–89% | Yellow | Approaching limit               |
| 90%+   | Red    | Near limit, compaction imminent |

Auto-compaction triggers at ~83.5% of the model's context window. A separate hard-capacity guard blocks only when effective usage is near the actual model limit and includes diagnostic values in the resulting message. Use `/compact` with optional instructions for manual compaction:

```
/compact focus on the API design decisions
```

## Prompt Queue

If you submit a prompt while the model is still executing (thinking), `InteractiveSession` queues the new prompt automatically. The input area border turns cyan to indicate a prompt is waiting. As soon as the current execution completes, the queued prompt is submitted automatically. Press Backspace while a prompt is queued to cancel it (calls `cancelQueue()` on the session).

## Input Navigation

The input area supports multi-line cursor movement. When input spans multiple rows, press Up/Down arrows to move the cursor to the previous or next display row within the input. This lets you navigate and edit long prompts without the cursor jumping out of the input box.

## Paste Handling

When pasting multiline text into the input area, the CLI collapses the content into a compact label:

```
[Pasted text #1 +42 lines]
```

Multiple pastes are numbered sequentially (`#1`, `#2`, etc.). The full pasted content is expanded when the prompt is submitted, so the AI receives the complete text. This keeps the input area readable while supporting large code blocks and log excerpts.

## Tool Display

Tool invocations in the TUI use a unified display format with status indicators:

| Status  | Symbol | Color                        | Meaning            |
| ------- | ------ | ---------------------------- | ------------------ |
| Running | ⟳      | Yellow                       | Tool is executing  |
| Success | ✓      | Green                        | Completed normally |
| Error   | ✗      | Red + strikethrough          | Execution failed   |
| Denied  | ⊘      | YellowBright + strikethrough | Permission denied  |

Long tool arguments are middle-truncated, keeping the last 30 characters visible for context.

### Edit Diff Display

When the Edit tool completes, the CLI renders a `DiffBlock` showing the change. The display format consists of a file path header followed by removal (`-`) rows with red foreground plus dark red background and addition (`+`) rows with green foreground plus dark green background. Diff row backgrounds fill the rendered row, including padding, so additions and removals remain scannable in dense edits. A maximum of 10 lines are displayed; larger diffs are truncated with an `... and N more lines` indicator. No-op edits (where old and new strings are identical) are suppressed entirely.

### Subagent Execution

The AI can spawn subagents through the `/agent` built-in command module using the projected `robota_command_agent` tool with `args: ...`. Subagents run in isolated sessions with their own tool access and inherit the parent session's hooks and permissions. Built-in agent types include `Explore`, `Plan`, and a general-purpose agent.

For explicit multi-agent or parallel-agent requests, `/agent` supports a batch jobs shape. A single command invocation starts all valid jobs before waiting for terminal summaries and returns structured per-job results with a shared group identifier.

## Session Logging

Events are logged to `.robota/logs/{sessionId}.jsonl` in JSONL format. Events include `session_init`, `pre_run`, `text_delta`, `assistant`, `server_tool`, `context`, and `background_task_event`.

The session log also records execution-boundary events emitted by the core run loop: `provider_request`, `provider_native_raw_payload`, `provider_response_raw`, `provider_response_normalized`, `assistant_message_committed`, `tool_batch_started`, `tool_execution_request`, and `tool_execution_result`. Provider packages own the exact native SDK request, response, and stream payload objects; the core routes them through provider-neutral events, and the session logger redacts or externalizes large payloads before writing JSONL.

Use `/validate-session` to check that the current session log has replay-grade provider/tool coverage, including provider-native raw response or stream payload events paired with each provider request.

Background subagents write append-only transcripts to `.robota/logs/{sessionId}/subagents/{agentId}.jsonl`. These transcripts include streaming deltas, tool calls/results, final output, and errors as they occur. The resumable `.robota/sessions/{sessionId}.json` file stores background task snapshots and transcript paths, not every token chunk.

## First-Run Setup

When no usable settings file exists, the CLI prompts for an Anthropic API key (input is masked with asterisks) and creates `~/.robota/settings.json` with a minimal config. Use `robota --reset` to delete the settings file and return to the first-run state. OpenAI-compatible local profiles can be configured manually without using the first-run Anthropic prompt.

## Configuration

The CLI uses a layered configuration system. `.robota/` is the primary configuration convention; `.claude/` paths are supported as a Claude Code compatibility layer. Later layers override earlier ones:

1. `~/.robota/settings.json` (user global)
2. `~/.claude/settings.json` (user global, Claude Code compatible)
3. `.robota/settings.json` (project, primary)
4. `.robota/settings.local.json` (local override, gitignored)
5. `.claude/settings.json` (project, Claude Code compatible)
6. `.claude/settings.local.json` (local override, gitignored, Claude Code compatible)

The `.claude/` paths take higher runtime priority so that Claude Code settings override `.robota/` defaults.

See [Using the SDK — Configuration](./sdk.md#configuration) for the full config format.

## Tool Output Limits

- Tool output is capped at 30,000 characters (middle-truncated)
- Glob tool defaults to a maximum of 1,000 entries per invocation

## Memory Management

The TUI applies several optimizations to keep memory usage bounded during long sessions:

- **Message windowing**: Only the most recent `MAX_RENDERED_MESSAGES` (100) messages are rendered in the React tree. Older messages are removed from the DOM but retained in session state.
- **Tool state cleanup**: Completed tool results beyond `MAX_COMPLETED_TOOLS` (50) have their detailed state cleared to reduce memory pressure.
- **React.memo**: `MessageItem` components are wrapped with `React.memo` to prevent unnecessary re-renders when new messages arrive.

See [agent-cli SPEC.md](../../packages/agent-cli/docs/SPEC.md) for implementation details.

## Known Limitations

- **Korean IME + macOS Terminal.app crash**: Korean/CJK IME input may crash macOS Terminal.app due to an Ink raw mode + Terminal.app IME interaction bug. **Use [iTerm2](https://iterm2.com/) instead.** This is a known industry-wide issue shared with Claude Code (issues #22732, #3045). A custom `CjkTextInput` component mitigates common issues but cannot prevent the Terminal.app crash.
- **Abort propagation**: `session.abort()` triggers an AbortSignal that flows through the entire chain (Session -> Robota -> Provider). The provider returns partial content with `state: 'interrupted'`. Streaming renders are debounced at 16ms. Interrupted responses display "Interrupted by user." and failed requests display "Request failed:" messages. The "Thinking..." indicator has been removed; a "Waiting for response... (ESC to interrupt)" message is shown instead.
