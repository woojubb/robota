import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
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

  // Anyone who can reach this route can talk to the agent, so the session loads no project
  // instruction files and has none of the built-in tools that run commands, read or change files,
  // reach the network or send files. Add your own tools with `additionalTools` and approve them by
  // name with `allowedTools`.
  const session = runtime.createSession({
    bare: true,
    deniedTools: [
      'Shell',
      'Bash',
      'BackgroundProcess',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'peer_send_file',
    ],
  });
  try {
    const turn = await session.submit(userMessage);
    const result = await turn.completed;
    return NextResponse.json({ reply: result.response });
  } finally {
    await session.shutdown();
  }
}
