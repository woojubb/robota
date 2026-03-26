# @robota-sdk/agent-transport-headless

Headless transport adapter for non-interactive `InteractiveSession` execution. Used by `@robota-sdk/agent-cli` print mode (`-p`) to run one-shot prompts with structured output.

## Installation

```bash
npm install @robota-sdk/agent-transport-headless
```

## Usage

The headless runner is invoked via the CLI's print mode flag (`-p`). Three output formats are supported:

### Text (default)

Plain text output, suitable for piping:

```bash
robota -p "Explain this error"
robota -p "List all TypeScript files" | head -20
```

### JSON

Single JSON object with result and session metadata:

```bash
robota -p "Summarize the project" --output-format json
```

Output:

```json
{ "type": "result", "result": "...", "session_id": "abc-123", "subtype": "success" }
```

### Stream JSON

Newline-delimited JSON with real-time `content_block_delta` events, followed by a final result:

```bash
robota -p "Write a function" --output-format stream-json
```

Each line is a JSON object:

```json
{
  "type": "stream_event",
  "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } },
  "session_id": "abc-123",
  "uuid": "..."
}
```

### Stdin Pipe

When no positional argument follows `-p`, input is read from stdin:

```bash
echo "Explain this code" | robota -p
cat error.log | robota -p "What went wrong?"
git diff | robota -p "Review this diff" --output-format json
```

### System Prompt Flags

```bash
robota -p "query" --system-prompt "You are a code reviewer"
robota -p "query" --append-system-prompt "Focus on security issues"
```

## API

```typescript
import { createHeadlessRunner } from '@robota-sdk/agent-transport-headless';

const runner = createHeadlessRunner({
  session, // InteractiveSession from @robota-sdk/agent-sdk
  outputFormat, // 'text' | 'json' | 'stream-json'
});

const exitCode = await runner.run(prompt);
process.exit(exitCode);
```

## ITransportAdapter

The headless transport implements the `ITransportAdapter` interface from `@robota-sdk/agent-sdk`:

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport-headless';
import type { ITransportAdapter } from '@robota-sdk/agent-sdk';

const transport: ITransportAdapter = createHeadlessTransport({
  outputFormat: 'json',
  prompt: 'List all files',
});

transport.attach(interactiveSession);
await transport.start(); // Runs the prompt and writes output
const exitCode = transport.getExitCode();
```

## Exit Codes

| Code | Meaning |
| ---- | ------- |
| 0    | Success |
| 1    | Error   |

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full specification.

## License

MIT
