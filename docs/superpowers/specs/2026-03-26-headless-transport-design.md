# Headless Transport Design

## Goal

Non-interactive execution of InteractiveSession via stdin/stdout. New package `@robota-sdk/agent-transport-headless` following the transport adapter pattern.

## Package

`packages/agent-transport-headless` — same pattern as transport-http, transport-ws, transport-mcp.

```
agent-transport-http      → HTTP/SSE
agent-transport-ws        → WebSocket
agent-transport-mcp       → MCP protocol
agent-transport-headless  → stdin/stdout (non-interactive)
```

## CLI Flags

| Flag                     | Type   | Default | Description                   |
| ------------------------ | ------ | ------- | ----------------------------- |
| `--output-format`        | string | `text`  | `text`, `json`, `stream-json` |
| `--system-prompt`        | string | —       | Replace system prompt         |
| `--append-system-prompt` | string | —       | Append to system prompt       |

Exit codes: 0 = success, 1 = error.

Stdin pipe: `-p` flag + no positional args → read prompt from stdin.

## Output Formats

### `--output-format text` (default)

Plain text response to stdout. Current behavior unchanged.

### `--output-format json`

```json
{
  "type": "result",
  "result": "final response text",
  "session_id": "uuid",
  "subtype": "success"
}
```

On error:

```json
{
  "type": "result",
  "result": "",
  "session_id": "uuid",
  "subtype": "error"
}
```

### `--output-format stream-json`

Newline-delimited JSON. Each line is a separate JSON object.

Streaming events (Claude Code compatible field names):

```
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}},"session_id":"uuid","uuid":"event-uuid"}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}},"session_id":"uuid","uuid":"event-uuid"}
```

Final event (always last line):

```
{"type":"result","result":"Hello world","session_id":"uuid","subtype":"success"}
```

Only `text_delta` events are streamed. Tool execution events (`tool_start`, `tool_end`, `thinking`) are NOT exposed — matches Claude Code behavior.

## Public API

### `createHeadlessRunner(options)`

```typescript
import { createHeadlessRunner } from '@robota-sdk/agent-transport-headless';

const runner = createHeadlessRunner({
  session: interactiveSession,
  outputFormat: 'json', // 'text' | 'json' | 'stream-json'
});

const exitCode = await runner.run(prompt);
process.exit(exitCode);
```

### Options

```typescript
interface IHeadlessRunnerOptions {
  session: InteractiveSession;
  outputFormat: 'text' | 'json' | 'stream-json';
}
```

### Return

`runner.run(prompt)` returns `Promise<number>` — exit code (0 or 1).

## CLI Integration

`cli.ts` changes:

```typescript
import { createHeadlessRunner } from '@robota-sdk/agent-transport-headless';

if (args.printMode) {
  // Read prompt from args or stdin
  let prompt = args.positional.join(' ').trim();
  if (!prompt && !process.stdin.isTTY) {
    prompt = await readStdin();
  }
  if (!prompt) {
    process.stderr.write('Print mode requires a prompt.\n');
    process.exit(1);
  }

  const runner = createHeadlessRunner({
    session: new InteractiveSession({ cwd, provider, ... }),
    outputFormat: args.outputFormat ?? 'text',
  });

  const exitCode = await runner.run(prompt);
  process.exit(exitCode);
}
```

Current inline print mode code in `cli.ts` is replaced entirely by this.

## System Prompt

`--system-prompt` and `--append-system-prompt` are passed to InteractiveSession construction, not to the transport. The transport only handles output formatting.

## Files

### New package

- `packages/agent-transport-headless/package.json`
- `packages/agent-transport-headless/src/index.ts`
- `packages/agent-transport-headless/src/headless-runner.ts`
- `packages/agent-transport-headless/docs/SPEC.md`

### Modified files

- `packages/agent-cli/src/utils/cli-args.ts` — add `--output-format`, `--system-prompt`, `--append-system-prompt`
- `packages/agent-cli/src/cli.ts` — replace inline print mode with `createHeadlessRunner`, add stdin pipe
- `packages/agent-cli/package.json` — add `agent-transport-headless` dependency

## Dependencies

- `@robota-sdk/agent-sdk` (InteractiveSession)
- No other dependencies

## Out of Scope

- `--bare` mode (CLI-BL-017)
- `--allowedTools` (CLI-BL-017)
- `--json-schema` / structured output (CLI-BL-017)
- `--no-session-persistence` (CLI-BL-017)
