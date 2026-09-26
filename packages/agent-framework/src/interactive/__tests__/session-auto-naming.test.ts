/**
 * #3189 — the session names itself once, after its first turn that ran, with the provider it uses
 * then. A failed turn or a failed title generation leaves the next turn to try again.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { SessionAutoNaming } from '../session-auto-naming.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionEvents,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

interface IFakeProvider extends IAIProvider {
  chat: ReturnType<typeof vi.fn>;
}

function fakeProvider(title: string | Promise<string>): IFakeProvider {
  return {
    name: 'fake',
    chat: vi.fn(async () => ({ role: 'assistant', content: await title })),
  } as unknown as IFakeProvider;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function runtimeSession(initial: IAIProvider): Record<string, unknown> {
  let provider = initial;
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'session_auto_name',
    getModelId: () => 'test-model',
    getProviderId: () => 'fake',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
    injectMessage: vi.fn(),
    getProvider: () => provider,
    swapProvider: (next: IAIProvider) => {
      provider = next;
    },
  };
}

async function runTurn(session: InteractiveSession, input: string): Promise<void> {
  const handle = await session.submit(input);
  await handle.completed;
}

describe('InteractiveSession auto-naming (#3189)', () => {
  it('names the session after its first turn', async () => {
    const provider = fakeProvider('refactor-auth-middleware');
    const renamed = vi.fn();
    const session = new InteractiveSession({
      session: runtimeSession(provider) as never,
      cwd: '/tmp',
      autoName: true,
    });
    session.on('session_renamed', renamed);

    await runTurn(session, 'Refactor the auth middleware');

    await vi.waitFor(() => expect(session.getName()).toBe('refactor-auth-middleware'));
    expect(renamed).toHaveBeenCalledWith({ name: 'refactor-auth-middleware' });
    expect(provider.chat).toHaveBeenCalledTimes(1);
    // Naming never enables hosted tools: the title call disables tool use.
    expect(provider.chat.mock.calls[0]?.[1]).toMatchObject({ toolChoice: 'none' });

    await runTurn(session, 'Now the tests');
    await Promise.resolve();
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it('does not name a session unless the host turns it on', async () => {
    const provider = fakeProvider('never-used');
    const session = new InteractiveSession({
      session: runtimeSession(provider) as never,
      cwd: '/tmp',
    });

    await runTurn(session, 'Hello');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.chat).not.toHaveBeenCalled();
    expect(session.getName()).toBeUndefined();
  });

  it('keeps a name the session already has', async () => {
    const provider = fakeProvider('generated-title');
    const session = new InteractiveSession({
      session: runtimeSession(provider) as never,
      cwd: '/tmp',
      sessionName: 'given-name',
      autoName: true,
    });

    await runTurn(session, 'Hello');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.chat).not.toHaveBeenCalled();
    expect(session.getName()).toBe('given-name');
  });

  it('lets a rename made while the title is generated win', async () => {
    const title = deferred<string>();
    const provider = fakeProvider(title.promise);
    const renamed = vi.fn();
    const session = new InteractiveSession({
      session: runtimeSession(provider) as never,
      cwd: '/tmp',
      autoName: true,
    });
    session.on('session_renamed', renamed);

    await runTurn(session, 'Hello');
    await vi.waitFor(() => expect(provider.chat).toHaveBeenCalledTimes(1));
    session.setName('chosen-by-user');
    title.resolve('generated-title');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.getName()).toBe('chosen-by-user');
    expect(renamed).not.toHaveBeenCalled();
  });

  it('uses the provider the session switched to before the turn ended', async () => {
    const first = fakeProvider('from-first');
    const second = fakeProvider('from-second');
    const runtime = runtimeSession(first);
    const session = new InteractiveSession({
      session: runtime as never,
      cwd: '/tmp',
      provider: first,
      autoName: true,
    });

    (runtime['swapProvider'] as (next: IAIProvider) => void)(second);
    await runTurn(session, 'Hello');

    await vi.waitFor(() => expect(session.getName()).toBe('from-second'));
    expect(first.chat).not.toHaveBeenCalled();
  });
});

describe('SessionAutoNaming', () => {
  function bus(): {
    on: <E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]) => void;
    emit: (event: TInteractiveEventName, ...args: unknown[]) => void;
  } {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    return {
      on: (event, handler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler as never]);
      },
      emit: (event, ...args) => {
        for (const handler of handlers.get(event) ?? []) handler(...args);
      },
    };
  }

  it('does not take a remote-control notice for the first message', async () => {
    const events = bus();
    const provider = fakeProvider('real-title');
    let name: string | undefined;
    new SessionAutoNaming({
      on: events.on,
      getName: () => name,
      setName: (next) => {
        name = next;
      },
      emitRenamed: () => {},
      getProvider: () => provider,
    });

    events.emit('user_message', '[remote-control] queued input from remote:1 was cancelled.');
    events.emit('interrupted', {});
    events.emit('turn_source', 'user');
    events.emit('user_message', 'Fix the flaky test');
    events.emit('complete', {});

    await vi.waitFor(() => expect(name).toBe('real-title'));
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(provider.chat.mock.calls[0])).toContain('Fix the flaky test');
    expect(JSON.stringify(provider.chat.mock.calls[0])).not.toContain('remote-control');
  });

  function namingFor(provider: IAIProvider): {
    events: ReturnType<typeof bus>;
    name: () => string | undefined;
    renamed: ReturnType<typeof vi.fn>;
  } {
    const events = bus();
    const renamed = vi.fn();
    let name: string | undefined;
    new SessionAutoNaming({
      on: events.on,
      getName: () => name,
      setName: (next) => {
        name = next;
      },
      emitRenamed: renamed,
      getProvider: () => provider,
    });
    return { events, name: () => name, renamed };
  }

  function turn(events: ReturnType<typeof bus>, message: string, end: 'complete' | 'error'): void {
    events.emit('turn_source', 'user');
    events.emit('user_message', message);
    events.emit(end, end === 'error' ? new Error('turn failed') : {});
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('does not spend its attempt on a turn that failed: the next turn names the session', async () => {
    const provider = fakeProvider('second-title');
    const { events, name } = namingFor(provider);

    turn(events, 'First', 'error');
    await settle();
    expect(provider.chat).not.toHaveBeenCalled();

    turn(events, 'Second', 'complete');

    await vi.waitFor(() => expect(name()).toBe('second-title'));
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(provider.chat.mock.calls[0])).toContain('Second');
    expect(JSON.stringify(provider.chat.mock.calls[0])).not.toContain('First');
  });

  it('names from a turn that completed after a background error was reported during it', async () => {
    const provider = fakeProvider('the-title');
    const { events, name } = namingFor(provider);

    events.emit('turn_source', 'user');
    events.emit('user_message', 'Fix the build');
    events.emit('error', new Error('background failure'));
    events.emit('complete', {});

    await vi.waitFor(() => expect(name()).toBe('the-title'));
  });

  it('retries a failed title generation on the next turn, then never renames', async () => {
    const provider = fakeProvider('retried-title');
    provider.chat.mockRejectedValueOnce(new Error('provider down'));
    const { events, name, renamed } = namingFor(provider);

    turn(events, 'First', 'complete');
    await settle();
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(name()).toBeUndefined();

    turn(events, 'Second', 'complete');
    await vi.waitFor(() => expect(name()).toBe('retried-title'));
    expect(provider.chat).toHaveBeenCalledTimes(2);

    turn(events, 'Third', 'complete');
    await settle();
    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(renamed).toHaveBeenCalledTimes(1);
  });

  it('starts one generation at a time: a turn ending while a title is generated does not start another', async () => {
    const title = deferred<string>();
    const provider = fakeProvider(title.promise);
    const { events, name } = namingFor(provider);

    turn(events, 'First', 'complete');
    turn(events, 'Second', 'complete');
    title.resolve('first-title');

    await vi.waitFor(() => expect(name()).toBe('first-title'));
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});
