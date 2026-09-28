import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const scripted = vi.hoisted(() => ({
  chatOptions: [] as Array<{ tools?: Array<{ name: string }> } | undefined>,
}));

vi.mock('@robota-sdk/agent-provider-anthropic', async () => {
  const { createScriptedProvider } = await import('@robota-sdk/agent-core/testing');
  return {
    AnthropicProvider: vi.fn(() => {
      const double = createScriptedProvider([{ text: 'Hello from Robota' }]);
      scripted.chatOptions = double.chatOptions as typeof scripted.chatOptions;
      return double.provider;
    }),
  };
});

const { POST } = await import('../route');

function chat(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'starter-chat-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("replies with the agent's text", async () => {
    const response = await POST(chat({ message: 'hi' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: 'Hello from Robota' });
  });

  it('offers the model only tools that act on nothing outside the conversation', async () => {
    await POST(chat({ message: 'hi' }));
    const offered = (scripted.chatOptions[0]?.tools ?? []).map((tool) => tool.name);
    // An allowlist, so a built-in tool added later fails here until someone decides about it.
    const harmless = ['AskUserQuestion', 'report_goal_status', 'report_loop_decision'];
    expect(offered.filter((name) => !harmless.includes(name))).toEqual([]);
  });

  it('refuses a request without a message', async () => {
    const response = await POST(chat({}));
    expect(response.status).toBe(400);
  });
});
