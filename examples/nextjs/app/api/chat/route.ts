import { NextRequest } from 'next/server';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as { message?: unknown };
  const userMessage = typeof body.message === 'string' ? body.message : null;

  if (!userMessage) {
    return Response.json({ error: '"message" is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const agentRuntime = createAgentRuntime({
          cwd: process.cwd(),
          provider: new AnthropicProvider({ apiKey }),
        });

        const session = agentRuntime.createSession({
          permissionMode: 'bypassPermissions',
          bare: true,
        });

        session.on('text_delta', (delta: string) => {
          send({ type: 'text_delta', text: delta });
        });

        session.on('complete', () => {
          send({ type: 'done' });
          controller.close();
        });

        session.on('interrupted', () => {
          send({ type: 'done' });
          controller.close();
        });

        session.on('error', (error: Error) => {
          send({ type: 'error', message: error.message });
          controller.close();
        });

        await session.submit(userMessage);
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
