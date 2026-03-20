# Claude Code Context Window Management — Research

## Key Metrics

| Parameter                     | Value            | Notes                                |
| ----------------------------- | ---------------- | ------------------------------------ |
| Default context window        | 200,000 tokens   | Standard Claude models               |
| Extended context window       | 1,000,000 tokens | Opus 4.6, Sonnet 4.6                 |
| Auto-compact trigger          | ~83.5% of window | ~167,000 tokens for 200k window      |
| Manual compact recommendation | 70-75%           | Leaves buffer for complex operations |
| Buffer size                   | ~33,000 tokens   | 16.5% of 200k window                 |
| Compaction ratio              | 60-80% reduction | Typical token savings                |
| Status line update debounce   | 300ms            | Batches rapid updates                |

## Token Tracking

Claude Code tracks context usage via fields in the status line API:

| Field                                 | Type   | Description                            |
| ------------------------------------- | ------ | -------------------------------------- |
| `context_window.used_percentage`      | Number | Pre-calculated percentage (0-100)      |
| `context_window.remaining_percentage` | Number | Remaining percentage                   |
| `context_window.total_input_tokens`   | Number | Cumulative input tokens                |
| `context_window.total_output_tokens`  | Number | Cumulative output tokens               |
| `context_window.context_window_size`  | Number | Max context size in tokens             |
| `context_window.current_usage`        | Object | Token counts from most recent API call |

Usage percentage formula:

```
used_percentage = (input_tokens + cache_creation_input_tokens + cache_read_input_tokens) / context_window_size * 100
```

Output tokens are excluded from the percentage calculation.

Source: https://code.claude.com/docs/en/statusline.md#context-window-fields

## Auto-Compaction Algorithm

### Trigger

- Fires at ~83.5% of context window usage
- Previously triggered at ~77-78%, updated in 2026 to ~83.5%

### Dropping Priority (first dropped → last dropped)

1. **Oldest tool outputs** — build logs, test results, file contents (dropped first)
2. **Detailed early instructions** — exploratory work, debugging steps
3. **Full conversation history** — summarized into compact form
4. **Recent tool outputs** — kept longer
5. **Key code snippets** — preserved
6. **User requests** — always preserved (dropped last)

### Process

1. API detects input tokens exceed trigger threshold
2. Claude generates summary of current conversation
3. Creates a `compaction` block containing the summary
4. Drops all message blocks prior to compaction block
5. Conversation continues from the summary block

Source: https://code.claude.com/docs/en/how-claude-code-works.md#when-context-fills-up

## `/compact` Command

```bash
/compact                              # Default compaction
/compact focus on the API changes     # Custom focus instructions
```

Process:

1. Takes entire current conversation history
2. Generates a summary preserving key decisions, code changes, task status
3. Replaces all prior messages with the summary
4. Achieves 60-80% token reduction

Best practice: Run at 70-75%, not 85-90%, to provide buffer space.

Source: https://restato.github.io/blog/claude-code-compact-strategy/

## Compact Instructions in CLAUDE.md

Users control compaction behavior via CLAUDE.md:

```markdown
## Compact Instructions

Focus on:

- API design decisions and contracts
- User authentication flow
- Database schema changes

Do not include:

- Debugging steps from early attempts
- Exploratory research
- Temporary workarounds
```

Claude uses these instructions when generating compaction summaries, prioritizing specified topics.

Source: https://code.claude.com/docs/en/how-claude-code-works.md#when-context-fills-up

## Tool Outputs vs Conversation Messages

**Tool outputs** are dropped first because:

- They're often verbose (full file contents, build logs, test output)
- Their results can be summarized in a sentence
- They consume disproportionate context space

**Conversation messages** are preserved longer because:

- They contain user intent and decisions
- They're typically shorter
- They provide continuity for the task

During compaction, tool outputs are analyzed for key results, which are included in the summary. Verbose details are dropped.

Source: https://code.claude.com/docs/en/how-claude-code-works.md#the-context-window

## PreCompact / PostCompact Hooks

| Hook        | When              | Can Block? | Use Case                |
| ----------- | ----------------- | ---------- | ----------------------- |
| PreCompact  | Before compaction | No         | Logging, backup         |
| PostCompact | After compaction  | No         | Archive summary, notify |

PreCompact input includes `trigger` ("manual" or "auto") and optional `custom_instructions`.
PostCompact input includes `compact_summary` (the generated summary text).

Both hooks are observability-only — they cannot prevent or modify compaction.

Source: https://code.claude.com/docs/en/hooks.md

## Context Recovery After Compaction

### Always preserved

- User requests and task descriptions
- Key code snippets
- Recent execution results
- The generated summary

### Usually lost

- Detailed early instructions (unless in CLAUDE.md)
- Verbose tool output
- Full command output
- Early exploratory work

### Recovery strategies

1. **CLAUDE.md**: Put persistent rules there — reloaded after compaction
2. **PostCompact hook**: Archive summary, write marker for re-injection
3. **Subagents**: Isolate verbose work in subagent context (doesn't bloat main)

Source: https://code.claude.com/docs/en/hooks.md

## UI Context Indicator

Claude Code's status line supports customizable display:

```bash
#!/bin/bash
input=$(cat)
MODEL=$(echo "$input" | jq -r '.model.display_name')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
echo "[$MODEL] Context: ${PCT}%"
```

Color coding convention:

- Green: 0-70%
- Yellow: 70-89%
- Red: 90%+

`/context` command shows breakdown of what's using context space (CLAUDE.md, skills, MCP tools, conversation history).

Source: https://code.claude.com/docs/en/statusline.md

## Proposed Package Placement for Robota

| Component                          | Package            | Rationale                                       |
| ---------------------------------- | ------------------ | ----------------------------------------------- |
| Token counting/tracking            | **agent-core**     | Provider response usage data is general-purpose |
| Usage percentage + threshold       | **agent-sessions** | Session owns conversation state                 |
| Compaction execution (LLM summary) | **agent-sessions** | Session owns history                            |
| `/compact` slash command           | **agent-cli**      | CLI slash command                               |
| StatusBar display                  | **agent-cli**      | UI display                                      |
| Compact Instructions               | **agent-sdk**      | CLAUDE.md context loading                       |
| PreCompact/PostCompact hooks       | **agent-core**     | General-purpose extension points                |
