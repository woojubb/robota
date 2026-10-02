import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// Separate process and package. The host explicitly supplies its disposable state artifact.
const statePath = process.argv[2];
const input = createInterface({ input: process.stdin });
const tools = [
  {
    name: 'observe',
    description:
      'Read the setting and its revision before deciding whether to change it. Returns an opaque revision and current value.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'change',
    description:
      'Change a setting only from an observed revision. Returns the new revision; stale observations fail without modifying state.',
    inputSchema: {
      type: 'object',
      properties: { revision: { type: 'string' }, value: { type: 'string' } },
      required: ['revision', 'value'],
    },
  },
];
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') {
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'state-fixture', version: '1.0.0' },
    };
  } else if (request.method === 'tools/list') {
    result = { tools };
  } else if (request.method === 'tools/call') {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const args = request.params.arguments ?? {};
    if (request.params.name === 'change') {
      if (args.revision !== state.revision) {
        result = {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Stale revision; observe current state before choosing another action.',
            },
          ],
        };
      } else {
        state.value = args.value;
        state.revision = `revision-${state.effects + 1}`;
        state.effects += 1;
        state.calls.push('change');
        writeFileSync(statePath, JSON.stringify(state));
      }
    } else if (request.params.name === 'observe') {
      state.calls.push('observe');
      writeFileSync(statePath, JSON.stringify(state));
    } else {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown tool' } })}\n`,
      );
      return;
    }
    result ??= {
      content: [
        { type: 'text', text: JSON.stringify({ value: state.value, revision: state.revision }) },
      ],
      structuredContent: { value: state.value, revision: state.revision },
    };
  } else if (request.method === 'ping') {
    result = {};
  } else {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method unavailable' } })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
