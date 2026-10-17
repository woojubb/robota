import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeSession,
  SESSION_ID,
  startTransport,
  textPrompt,
  WORKSPACE,
} from './acp-test-harness.js';

const open: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.stop();
});

async function start(overrides: Parameters<typeof startTransport>[1] = {}) {
  const fake = createFakeSession();
  const fixture = await startTransport(fake.session, overrides);
  open.push(fixture);
  return { fake, fixture, agent: fixture.editor.connection.agent };
}

describe('initialize', () => {
  it.each([1, 99])('answers protocol version 1 for a requested version %i', async (requested) => {
    const { agent } = await start();
    const reply = await agent.request('initialize', { protocolVersion: requested });
    expect(reply.protocolVersion).toBe(1);
    expect(reply.agentCapabilities).toEqual({
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: true },
    });
    expect(reply.agentInfo).toEqual({ name: 'robota', version: '1.2.3' });
  });

  it('serves only the methods it implements', async () => {
    const { agent } = await start();
    await agent.request('initialize', { protocolVersion: 1 });
    await expect(
      agent.request('session/load', { sessionId: SESSION_ID, cwd: WORKSPACE, mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32601 });
    await expect(agent.request('authenticate', { methodId: 'x' })).rejects.toMatchObject({
      code: -32601,
    });
  });
});

describe('session/new', () => {
  it('returns the attached session id', async () => {
    const { agent } = await start();
    await agent.request('initialize', { protocolVersion: 1 });
    await expect(agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] })).resolves.toEqual(
      { sessionId: SESSION_ID },
    );
  });

  it('accepts the served directory spelled with a trailing separator or a dot segment', async () => {
    const { agent } = await start();
    await agent.request('initialize', { protocolVersion: 1 });
    await expect(
      agent.request('session/new', { cwd: `${WORKSPACE}/./`, mcpServers: [] }),
    ).resolves.toMatchObject({ sessionId: SESSION_ID });
  });

  it.each([
    ['another directory', { cwd: '/elsewhere', mcpServers: [] }],
    ['a relative directory', { cwd: 'workspace', mcpServers: [] }],
    [
      'editor-supplied MCP servers',
      { cwd: WORKSPACE, mcpServers: [{ name: 'x', command: 'x', args: [], env: [] }] },
    ],
    ['extra workspace roots', { cwd: WORKSPACE, mcpServers: [], additionalDirectories: ['/etc'] }],
  ])('refuses %s as invalid params, before asking trust', async (_label, params) => {
    const admitWorkspace = vi.fn(() => ({ admitted: true as const }));
    const { agent } = await start({ admitWorkspace });
    await agent.request('initialize', { protocolVersion: 1 });
    await expect(agent.request('session/new', params)).rejects.toMatchObject({ code: -32602 });
    expect(admitWorkspace).not.toHaveBeenCalled();
  });

  it('refuses an unadmitted workspace with the host message, and admits a later retry', async () => {
    let admitted = false;
    const message = 'Workspace is not trusted.\nGrant access with: robota trust --yes';
    const { agent } = await start({
      admitWorkspace: () => (admitted ? { admitted: true } : { admitted: false, message }),
    });
    await agent.request('initialize', { protocolVersion: 1 });
    const refusal = await agent
      .request('session/new', { cwd: WORKSPACE, mcpServers: [] })
      .catch((error: unknown) => error);
    // -32000 is ACP's authentication-required code, which an editor turns into a sign-in prompt.
    expect(refusal).toMatchObject({ code: -32001, data: { reason: 'workspace-not-trusted' } });
    expect((refusal as Error).message).toContain('Grant access with: robota trust --yes');
    admitted = true;
    await expect(agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] })).resolves.toEqual(
      { sessionId: SESSION_ID },
    );
  });

  it('serves one session per connection', async () => {
    const { agent } = await start();
    await agent.request('initialize', { protocolVersion: 1 });
    await agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
    const second = await agent
      .request('session/new', { cwd: WORKSPACE, mcpServers: [] })
      .catch((error: unknown) => error);
    expect(second).toMatchObject({ code: -32602 });
    expect((second as Error).message).toContain('one session per connection');
  });

  it('refuses a prompt before a session exists or for another session', async () => {
    const { agent, fake } = await start();
    await agent.request('initialize', { protocolVersion: 1 });
    await expect(
      agent.request('session/prompt', { sessionId: SESSION_ID, prompt: textPrompt('hi') }),
    ).rejects.toMatchObject({ code: -32602 });
    await agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
    await expect(
      agent.request('session/prompt', { sessionId: 'other', prompt: textPrompt('hi') }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(fake.submit).not.toHaveBeenCalled();
  });
});
