import express from 'express';
import { z } from 'zod';
import { createQuery } from '@robota-sdk/agent-framework';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const app = express();
app.use(express.json());

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

// Custom function tools are created once and registered per request via `additionalTools`.
const calculatorTool = createZodFunctionTool(
  'calculate',
  'Perform basic arithmetic: add, subtract, multiply, divide',
  z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  async (params) => {
    const { operation, a, b } = params as { operation: string; a: number; b: number };
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

const currentTimeTool = createZodFunctionTool(
  'get_current_time',
  'Return the current UTC date and time',
  z.object({}),
  async () => ({ utc: new Date().toISOString() }),
);

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

  // A fresh query per request so conversation history does not bleed between users.
  const query = createQuery({
    provider: new AnthropicProvider({ apiKey }),
    additionalTools: [calculatorTool, currentTimeTool],
    onTextDelta: (delta) => send({ type: 'text_delta', text: delta }),
  });

  query(message.trim())
    .then(() => {
      send({ type: 'done' });
    })
    .catch((error: unknown) => {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      res.end();
    });
});

const PORT = process.env.PORT ?? '3001';
app.listen(Number(PORT), () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('POST /api/chat  — SSE stream (tool-use enabled)');
});
