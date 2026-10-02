# Print Mode

`__PRODUCT_CLI_NAME__ -p` runs one prompt without the terminal UI, prints the answer and exits — for scripts, CI
jobs and shell pipelines.

## Basic usage

```bash
__PRODUCT_CLI_NAME__ -p "List all TypeScript files in src/"
```

`-p` takes no value: the command's non-option text is the prompt, so quote it. With the default
`text` output format, `__PRODUCT_CLI_NAME__` prints the final response to stdout when the turn completes; errors go
to stderr.

In a Git repository you have not trusted yet, print mode does not run: it prints
`Workspace trust is required before headless startup` and exits with code 1, rather than silently
running without the project's settings, hooks and skills. Trust the folder once with
`__PRODUCT_CLI_NAME__ trust --yes`, or pass `--safe-mode` to run with every customization off.

## Permissions

Print mode has no one to answer permission prompts. In the default permission mode, anything that
would ask — a file edit, a shell command other than a read-only one — is denied. State the mode the
task needs:

```bash
# Read-only: plan and inspect, change nothing (same as --dry-run)
__PRODUCT_CLI_NAME__ -p "Explain this project" --permission-mode plan

# Allow file edits; shell commands that would ask are still denied
__PRODUCT_CLI_NAME__ -p "Generate JSDoc for all exported functions in src/utils.ts" --permission-mode acceptEdits

# Allow tool calls without asking
__PRODUCT_CLI_NAME__ -p "Run all tests and fix the failures" --permission-mode bypassPermissions
```

`bypassPermissions` still applies your `permissions.deny` and `permissions.ask` rules, and it never
auto-approves `rm` on the filesystem root, a top-level directory, your home or the working directory,
or writes into `.git`, `<project-state>`, `.claude`, `.agents` and shell or tool configuration files. The
[permissions guide](../guide/permissions-and-hooks.md) lists what each mode allows.

## Other options

```bash
# Use a specific model
__PRODUCT_CLI_NAME__ -p "Explain this project" --model claude-opus-4-6

# Limit agentic turns
__PRODUCT_CLI_NAME__ -p "Find and fix the bug" --max-turns 5

# Append to the default system prompt
__PRODUCT_CLI_NAME__ -p "Fix the bug" --append-system-prompt "Focus on error handling"
```

## Piping input

When you give no prompt text, print mode reads the whole prompt from stdin. When you give prompt text,
stdin is not read.

```bash
# The piped text is the prompt
echo "Summarize the README.md" | __PRODUCT_CLI_NAME__ -p

# Combine an instruction with a file's content
{ echo "Analyze this error log:"; cat error.log; } | __PRODUCT_CLI_NAME__ -p

# Or pass the content as part of the prompt argument
__PRODUCT_CLI_NAME__ -p "Review the changes in this diff: $(git diff)" --permission-mode plan

# Capture the answer in a variable
REVIEW=$(__PRODUCT_CLI_NAME__ -p "Summarize the README.md" --permission-mode plan)
echo "$REVIEW"
```

## JSON output

```bash
# One JSON object when the turn ends
__PRODUCT_CLI_NAME__ -p "Summarize this project" --output-format json

# Extract the answer with jq
__PRODUCT_CLI_NAME__ -p "Summarize this project" --output-format json | jq -r '.result'

# One JSON object per line while the turn runs, ending with the result object
__PRODUCT_CLI_NAME__ -p "Explain recursion" --output-format stream-json

# Ask the model for JSON matching a schema
__PRODUCT_CLI_NAME__ -p "Describe this package" --json-schema '{"type":"object"}'
```

The `json` result object has `type: "result"`, `result` (the answer), `session_id` and `subtype`
(`success` or `error`). In `stream-json`, text arrives as `stream_event` lines whose `event` is a
`content_block_delta`, and the last line is the same result object.

## Exit codes

- `0` — the turn completed.
- `1` — an error, including a missing prompt.
