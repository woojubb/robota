import express from 'express';
import { Robota, createFunctionTool } from '@robota-sdk/agent-core';
import type { TToolParameters } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const app = express();
app.use(express.json());

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const calculatorTool = createFunctionTool(
  'calculate',
  'Perform basic arithmetic: add, subtract, multiply, divide',
  {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['add', 'subtract', 'multiply', 'divide'],
        description: 'The arithmetic operation',
      },
      a: { type: 'number', description: 'First operand' },
      b: { type: 'number', description: 'Second operand' },
    },
    required: ['operation', 'a', 'b'],
  },
  async (params: TToolParameters) => {
    const operation = String(params['operation']);
    const a = Number(params['a']);
    const b = Number(params['b']);

    if (Number.isNaN(a) || Number.isNaN(b)) {
      throw new Error('a and b must be numbers');
    }

    switch (operation) {
      case 'add':
        return { result: a + b };
      case 'subtract':
        return { result: a - b };
      case 'multiply':
        return { result: a * b };
      case 'divide':
        if (b === 0) throw new Error('Division by zero');
        return { result: a / b };
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
);

const currentTimeTool = createFunctionTool(
  'get_current_time',
  'Return the current UTC date and time',
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async () => ({ utc: new Date().toISOString() }),
);

const agentConfig = {
  name: 'ToolAgent',
  aiProviders: [new AnthropicProvider({ apiKey })],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    systemMessage:
      'You are a helpful assistant. Use the provided tools when needed and give clear, concise answers.',
  },
  tools: [calculatorTool, currentTimeTool],
} as const;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/chat', (req, res) => {
  const { message } = req.body as { message?: unknown };

  if (typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: '"message" must be a non-empty string' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: Record<string, unknown>): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  (async () => {
    // Create a new Robota instance per request so conversation history
    // does not bleed between users.
    const robota = new Robota(agentConfig);
    try {
      for await (const chunk of robota.runStream(message.trim())) {
        send({ type: 'text_delta', text: chunk });
      }
      send({ type: 'done' });
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      await robota.destroy();
      res.end();
    }
  })().catch((error: unknown) => {
    console.error('Unhandled error in /api/chat:', error);
    res.end();
  });
});

const PORT = process.env.PORT ?? '3001';
app.listen(Number(PORT), () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('POST /api/chat  — SSE stream (tool-use enabled)');
});
