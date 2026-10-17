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

/** Like `InteractiveSession`: it has no id until its background initialization finishes, and says when through `whenInitialized`. */
function startingSession(initialization: Promise<void>) {
  const fake = createFakeSession();
  const snapshot = fake.session.getStatusSnapshot.bind(fake.session);
  let ready = false;
  void initialization.then(
    () => (ready = true),
    () => undefined,
  );
  fake.session.getStatusSnapshot = () => {
    if (!ready) throw new Error('InteractiveSession not initialized.');
    return snapshot();
  };
  return Object.assign(fake.session, { whenInitialized: () => initialization });
}

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

describe('session/new for a session that is still starting', () => {
  async function startWith(session: ReturnType<typeof startingSession>) {
    const fixture = await startTransport(session);
    open.push(fixture);
    const agent = fixture.editor.connection.agent;
    await agent.request('initialize', { protocolVersion: 1 });
    return { agent, fixture };
  }

  it('answers once the session can name itself, not before', async () => {
    let finish!: () => void;
    const { agent } = await startWith(
      startingSession(new Promise<void>((resolve) => (finish = resolve))),
    );
    let settled = false;
    const created = agent
      .request('session/new', { cwd: WORKSPACE, mcpServers: [] })
      .finally(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    finish();
    await expect(created).resolves.toEqual({ sessionId: SESSION_ID });
  });

  it('refuses a second session/new while the first is waiting, and serves the first', async () => {
    let finish!: () => void;
    const { agent } = await startWith(
      startingSession(new Promise<void>((resolve) => (finish = resolve))),
    );
    const first = agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32602 });
    finish();
    await expect(first).resolves.toEqual({ sessionId: SESSION_ID });
  });

  it('replies with a fixed error and keeps the cause local when the session failed to start', async () => {
    const { agent, fixture } = await startWith(
      startingSession(Promise.reject(new Error('no provider at /home/me/.robota'))),
    );
    const failure = await agent
      .request('session/new', { cwd: WORKSPACE, mcpServers: [] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: -32603, message: 'The session could not be started' });
    expect(JSON.stringify(failure)).not.toContain('.robota');
    expect(fixture.deliveryErrors).toHaveLength(1);
    expect(fixture.deliveryErrors[0]).toMatchObject({ context: 'session/new' });
    expect(fixture.deliveryErrors[0]!.error.message).toContain('no provider');
  });
});
