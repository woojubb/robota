# SPEC.md — @robota-sdk/agent-transport-headless

## Scope

Headless transport adapter for non-interactive `InteractiveSession` execution. Provides a factory that wraps an SDK `InteractiveSession` and runs a single prompt with structured output, suitable for scripting, CI pipelines, and programmatic integrations.

## Boundaries

- Does NOT own `InteractiveSession` — imported from `@robota-sdk/agent-sdk`
- Does NOT own CLI argument parsing — handled by `@robota-sdk/agent-cli`
- Does NOT own provider creation — provider is created upstream and injected via session
- OWNS: output format rendering (text, json, stream-json) and exit code determination

## Public API Surface

| Export                   | Kind      | Description                             |
| ------------------------ | --------- | --------------------------------------- |
| `createHeadlessRunner`   | function  | Factory that returns a `{ run }` object |
| `IHeadlessRunnerOptions` | interface | Options for `createHeadlessRunner`      |
| `TOutputFormat`          | type      | `'text' \| 'json' \| 'stream-json'`     |

### `createHeadlessRunner(options: IHeadlessRunnerOptions)`

Returns `{ run: (prompt: string) => Promise<number> }`.

The `run` function submits the prompt to the session, writes output to `process.stdout`, and resolves with an exit code.

### IHeadlessRunnerOptions

| Field          | Type                                | Description              |
| -------------- | ----------------------------------- | ------------------------ |
| `session`      | `InteractiveSession`                | SDK session instance     |
| `outputFormat` | `'text' \| 'json' \| 'stream-json'` | Output format for stdout |

## Output Formats

### `text` (default)

Writes the final response as plain text to stdout, followed by a newline. No JSON wrapping. Suitable for piping into other commands.

### `json`

Writes a single JSON object to stdout on completion:

```json
{ "type": "result", "result": "<response text>", "session_id": "<uuid>", "subtype": "success" }
```

On error, `result` is empty and `subtype` is `"error"`.

### `stream-json`

Writes newline-delimited JSON events to stdout during execution:

**Streaming events (one per text delta):**

```json
{
  "type": "stream_event",
  "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } },
  "session_id": "<uuid>",
  "uuid": "<uuid>"
}
```

**Final result (same as `json` format):**

```json
{ "type": "result", "result": "<full response>", "session_id": "<uuid>", "subtype": "success" }
```

## Exit Codes

| Code | Meaning                  |
| ---- | ------------------------ |
| 0    | Success (or interrupted) |
| 1    | Error during execution   |

Interrupted executions (e.g., abort signal) are treated as success (exit code 0) with whatever partial response was produced.

## Architecture

```
createHeadlessRunner(options)
  └── run(prompt)
        ├── subscribes to InteractiveSession events
        ├── writes formatted output to process.stdout
        └── resolves with exit code (0 or 1)
```

The runner subscribes to `InteractiveSession` events (`text_delta`, `complete`, `interrupted`, `error`) and cleans up all listeners after the execution completes.

## ITransportAdapter

This package implements the `ITransportAdapter` interface from `@robota-sdk/agent-sdk`.

### `createHeadlessTransport(options)`

Factory that returns an `ITransportAdapter` with `name: 'headless'`.

**Options:**

| Field          | Type                                | Description              |
| -------------- | ----------------------------------- | ------------------------ |
| `outputFormat` | `'text' \| 'json' \| 'stream-json'` | Output format for stdout |
| `prompt`       | `string`                            | Prompt to execute        |

**Extra method:**

- `getExitCode(): number` — Returns the exit code after execution completes (0 = success, 1 = error).

**Lifecycle:**

1. `attach(session)` — Stores the `InteractiveSession` reference
2. `start()` — Runs the prompt against the session, writes formatted output to stdout
3. `stop()` — No-op (single-shot execution; cleanup happens in `start`)

## Dependencies

| Package                 | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `@robota-sdk/agent-sdk` | `InteractiveSession`, `IExecutionResult` |

## File Structure

```
src/
├── headless-runner.ts    ← createHeadlessRunner factory + format handlers
├── index.ts              ← Public re-exports
└── __tests__/            ← Unit tests
```
