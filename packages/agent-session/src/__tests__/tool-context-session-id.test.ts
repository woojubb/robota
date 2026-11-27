/**
 * A tool the model calls inside a session receives that session's own id, so what it saves can name
 * the conversation it came from. A child session runs the same path and so carries its own id, not
 * its parent's.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { Session } from '../session.js';

import type { IToolExecutionContext } from '@robota-sdk/agent-core';

const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((created) => created.shutdown()));
});

function sessionReading(seen: Array<string | undefined>, sessionId: string): Session {
  const created = new Session({
    hookTypeExecutors: [],
    cwd: '/tmp',
    sessionId,
    systemMessage: 'Fixture',
    model: 'test-model',
    provider: createScriptedProvider([
      { toolCalls: [{ name: 'Probe', args: {} }] },
      { text: 'done' },
    ]).provider,
    autoCompactThreshold: false,
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    permissions: { allow: ['Probe'], deny: [] },
    tools: [
      new FunctionTool(
        {
          name: 'Probe',
          description: 'Records the session id its context carries',
          parameters: { type: 'object', properties: {} },
        },
        async (_parameters, context?: IToolExecutionContext) => {
          seen.push(context?.sessionId);
          return 'ok';
        },
      ),
    ],
  });
  sessions.push(created);
  return created;
}

describe('tool context session id in a session', () => {
  it('is the id the session stores', async () => {
    const seen: Array<string | undefined> = [];
    const created = sessionReading(seen, 'stored-session-id');
    await created.run('go');
    expect(seen).toEqual(['stored-session-id']);
    expect(created.getSessionId()).toBe('stored-session-id');
  });

  it('is each session its own, so a child session never reports its parent', async () => {
    const parent: Array<string | undefined> = [];
    const child: Array<string | undefined> = [];
    await sessionReading(parent, 'parent-session').run('go');
    await sessionReading(child, 'child-session').run('go');
    expect(parent).toEqual(['parent-session']);
    expect(child).toEqual(['child-session']);
  });
});
