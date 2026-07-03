/**
 * Capability: tool-only decision agent (router/orchestrator/classifier pattern).
 *
 * The tool call IS the answer: `allowToolOnlyCompletion: true` skips the extra
 * summary model call, and the app reads the decision from its own executor.
 *
 * Run: ANTHROPIC_API_KEY=... pnpm dev
 */
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY.');
  process.exit(1);
}

let decision: string | undefined;
const routeTool = createZodFunctionTool(
  'route',
  'Choose the team that should handle the ticket',
  z.object({ team: z.enum(['billing', 'bugs', 'sales']) }),
  async (args) => {
    decision = args.team; // typed as 'billing' | 'bugs' | 'sales' (SDK-009 inference)
    return `routed to ${args.team}`;
  },
);

const router = new Robota({
  name: 'TicketRouter',
  aiProviders: [new AnthropicProvider({ apiKey })],
  defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5', maxTokens: 200 },
  tools: [routeTool],
  retainHistory: false, // each ticket is independent
});

const tickets = ['I was charged twice this month.', 'The app crashes when I open settings.'];
for (const ticket of tickets) {
  decision = undefined;
  await router.run(`Ticket: "${ticket}"`, { allowToolOnlyCompletion: true });
  console.log(`"${ticket}" -> ${decision ?? 'NO DECISION'}`);
}
await router.destroy();
