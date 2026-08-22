import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createAgentRuntime,
  createRestrictedWorkspaceProjectAccess,
  createStatelessRuntime,
} from '../../index.js';
import {
  createTrustedProjectAccessFixture,
  createTrustedProjectSessionStoreFixture,
} from '../../testing/trusted-project-state-fixture.js';

import type { InteractiveSession } from '../../index.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-transport';

function createMemoryStore(): IInteractiveSessionStore {
  const records = new Map<string, IInteractiveSessionRecord>();
  return {
    save(record): void {
      records.set(record.id, record);
    },
    load(id): IInteractiveSessionRecord | undefined {
      return records.get(id);
    },
    list(): IInteractiveSessionRecord[] {
      return [...records.values()];
    },
    delete(id): void {
      records.delete(id);
    },
  };
}

async function completeTurn(session: InteractiveSession, prompt: string): Promise<string> {
  const handle = await session.submit(prompt);
  return (await handle.completed).response;
}

describe('ARCH-023 agent runtime session-store inheritance', () => {
  const sessions: InteractiveSession[] = [];
  const scratchDirs: string[] = [];

  function scratchDir(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'arch-023-runtime-'));
    scratchDirs.push(cwd);
    return cwd;
  }

  function track(session: InteractiveSession): InteractiveSession {
    sessions.push(session);
    return session;
  }

  afterEach(async () => {
    for (const session of sessions.splice(0).reverse()) await session.shutdown();
    for (const cwd of scratchDirs.splice(0)) rmSync(cwd, { recursive: true, force: true });
  });

  it('reports and propagates the initial Restricted project-access decision', () => {
    const cwd = scratchDir();
    const projectAccess = createRestrictedWorkspaceProjectAccess('untrusted', cwd);
    const scripted = createScriptedProvider([]);
    const runtime = createAgentRuntime({ cwd, provider: scripted.provider, projectAccess });

    expect(runtime.projectAccess).toBe(projectAccess);
    expect(runtime.createSession({ bare: true }).getProjectAccess()).toBe(projectAccess);
  });

  it('refuses trusted project access minted for a different runtime root', async () => {
    const trustedRoot = scratchDir();
    const runtimeRoot = scratchDir();
    const projectAccess = await createTrustedProjectAccessFixture(trustedRoot);
    const scripted = createScriptedProvider([]);

    expect(() =>
      createAgentRuntime({ cwd: runtimeRoot, provider: scripted.provider, projectAccess }),
    ).toThrow('Trusted project access does not cover the requested working directory.');
  });

  it('inherits the runtime default store and resumes through it', async () => {
    const cwd = scratchDir();
    const projectStore = await createTrustedProjectSessionStoreFixture(cwd);
    const firstProvider = createScriptedProvider([{ text: 'stored context' }]);
    const firstRuntime = createAgentRuntime({
      cwd,
      provider: firstProvider.provider,
      sessionStore: projectStore,
    });
    const first = track(firstRuntime.createSession({ bare: true }));

    await expect(completeTurn(first, 'remember ARCH-023')).resolves.toBe('stored context');
    const sessionId = first.getSession().getSessionId();
    await first.shutdown();

    expect(existsSync(join(cwd, '.robota', 'sessions', `${sessionId}.json`))).toBe(true);

    const secondProvider = createScriptedProvider([{ text: 'restored context' }]);
    const secondRuntime = createAgentRuntime({
      cwd,
      provider: secondProvider.provider,
      sessionStore: projectStore,
    });
    const second = track(secondRuntime.createSession({ bare: true, resumeSessionId: sessionId }));

    await expect(completeTurn(second, 'recall ARCH-023')).resolves.toBe('restored context');
    const requestContents = (secondProvider.requests[0] ?? []).map((message) => message.content);
    expect(requestContents).toContain('remember ARCH-023');
    expect(requestContents).toContain('stored context');
    expect(second.getSession().getSessionId()).toBe(sessionId);
  });

  it('uses an explicit per-session store instead of the runtime default', async () => {
    const cwd = scratchDir();
    const scripted = createScriptedProvider([{ text: 'custom store' }]);
    const runtimeStore = createMemoryStore();
    const runtime = createAgentRuntime({
      cwd,
      provider: scripted.provider,
      sessionStore: runtimeStore,
    });
    const customStore = createMemoryStore();
    const session = track(runtime.createSession({ bare: true, sessionStore: customStore }));

    await completeTurn(session, 'use custom store');
    const sessionId = session.getSession().getSessionId();
    await session.shutdown();

    expect(customStore.load(sessionId)).toBeDefined();
    expect(runtimeStore.load(sessionId)).toBeUndefined();
  });

  it('allows explicit undefined to disable a runtime default store', async () => {
    const cwd = scratchDir();
    const scripted = createScriptedProvider([{ text: 'not persisted' }]);
    const runtimeStore = createMemoryStore();
    const runtime = createAgentRuntime({
      cwd,
      provider: scripted.provider,
      sessionStore: runtimeStore,
    });
    const session = track(runtime.createSession({ bare: true, sessionStore: undefined }));

    await completeTurn(session, 'disable persistence');
    await session.shutdown();

    expect(runtimeStore.list()).toEqual([]);
    expect(existsSync(join(cwd, '.robota', 'sessions'))).toBe(false);
  });

  it('keeps omitted persistence disabled for stateless sessions', async () => {
    const cwd = scratchDir();
    const scripted = createScriptedProvider([{ text: 'stateless' }]);
    const runtime = createStatelessRuntime({ cwd, provider: scripted.provider });
    const session = track(runtime.createSession({}));

    await completeTurn(session, 'stay stateless');
    await session.shutdown();

    expect(runtime.sessionStore).toBeUndefined();
    expect(existsSync(join(cwd, '.robota', 'sessions'))).toBe(false);
  });

  it('allows a stateless runtime session to opt into a custom store', async () => {
    const cwd = scratchDir();
    const scripted = createScriptedProvider([{ text: 'opted in' }]);
    const runtime = createStatelessRuntime({ cwd, provider: scripted.provider });
    const customStore = createMemoryStore();
    const session = track(runtime.createSession({ sessionStore: customStore }));

    await completeTurn(session, 'enable persistence');
    const sessionId = session.getSession().getSessionId();
    await session.shutdown();

    expect(customStore.load(sessionId)).toBeDefined();
  });
});
