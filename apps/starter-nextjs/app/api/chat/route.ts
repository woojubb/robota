import { NextRequest, NextResponse } from 'next/server';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  }

  const body = (await request.json()) as { message?: unknown };
  const userMessage = typeof body.message === 'string' ? body.message : null;
  if (!userMessage) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const runtime = createAgentRuntime({
    cwd: process.cwd(),
    provider: new AnthropicProvider({ apiKey }),
  });

  const session = runtime.createSession({ permissionMode: 'bypassPermissions' });
  const response = await session.submit(userMessage);

  return NextResponse.json({ reply: response });
}
