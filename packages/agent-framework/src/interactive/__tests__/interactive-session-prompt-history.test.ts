/**
 * SCREEN-1993 TC-02 — the session-side prompt-history append: what is recorded, for whom, and how a
 * failed append is reported.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { createPromptHistoryRecorder } from '../interactive-session-prompt-history.js';

import type {
  IPromptHistoryEntry,
  IPromptHistoryWriter,
} from '@robota-sdk/agent-interface-session';
import type { IAIProvider } from '@robota-sdk/agent-core';

function recordingWriter(): IPromptHistoryWriter & { readonly entries: IPromptHistoryEntry[] } {
  const entries: IPromptHistoryEntry[] = [];
  return {
    entries,
    append(entry) {
      entries.push(entry);
    },
  };
}

function recorder(writer: IPromptHistoryWriter, notify = vi.fn()) {
  return {
    record: createPromptHistoryRecorder({
      writer,
      project: '/repo',
      getSessionId: () => 'session_1',
      notify,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }),
    notify,
  };
}

/** The session's working directory: private to this run, never a fixed name under /tmp. */
const PROJECT_DIR = mkdtempSync(join(tmpdir(), 'robota-prompt-history-'));
afterAll(() => rmSync(PROJECT_DIR, { recursive: true, force: true }));

describe('createPromptHistoryRecorder (SCREEN-1993 TC-02)', () => {
  it("records the owner's typed text, trimmed, and nothing for a wake, a peer or a remote driver", () => {
    const writer = recordingWriter();
    const { record } = recorder(writer);
    record({
      input: 'expanded',
      rawInput: '  deploy staging  ',
      turnSource: 'user',
      driverId: undefined,
    });
    record({ input: 'plain', rawInput: undefined, turnSource: 'user', driverId: 'owner' });
    record({ input: 'wake', rawInput: undefined, turnSource: 'agent-wakeup', driverId: 'agent' });
    record({ input: 'peer', rawInput: undefined, turnSource: 'peer', driverId: 'peer:session_b' });
    record({ input: 'remote', rawInput: undefined, turnSource: 'user', driverId: 'device-42' });
    record({ input: '   ', rawInput: undefined, turnSource: 'user', driverId: undefined });
    expect(writer.entries).toEqual([
      {
        at: '2026-01-01T00:00:00.000Z',
        sessionId: 'session_1',
        project: '/repo',
        text: 'deploy staging',
      },
      { at: '2026-01-01T00:00:00.000Z', sessionId: 'session_1', project: '/repo', text: 'plain' },
    ]);
  });

  it('suppresses an immediate consecutive duplicate but records it again after another prompt', () => {
    const writer = recordingWriter();
    const { record } = recorder(writer);
    const user = (input: string) =>
      record({ input, rawInput: undefined, turnSource: 'user', driverId: undefined });
    user('again');
    user('again ');
    user('other');
    user('again');
    expect(writer.entries.map((entry) => entry.text)).toEqual(['again', 'other', 'again']);
  });

  it('reports a failed append once per session and keeps recording afterwards', () => {
    let failures = 0;
    const writer: IPromptHistoryWriter = {
      append() {
        failures += 1;
        throw new Error('EACCES: permission denied');
      },
    };
    const { record, notify } = recorder(writer);
    const user = (input: string) =>
      record({ input, rawInput: undefined, turnSource: 'user', driverId: undefined });
    expect(() => user('one')).not.toThrow();
    user('two');
    expect(failures).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toBe(
      'Prompt history could not be written: EACCES: permission denied',
    );
  });
});

describe('InteractiveSession wires the recorder into the turn (SCREEN-1993 TC-02)', () => {
  function provider(): IAIProvider {
    return {
      name: 'mock',
      version: 'test',
      chat: vi.fn().mockResolvedValue({
        role: 'assistant',
        content: 'ok',
        timestamp: new Date('2026-01-01T00:00:01.000Z'),
      }),
      generateResponse: vi.fn(),
    } as unknown as IAIProvider;
  }

  it('appends the typed prompt of a completed owner turn with the session id and project', async () => {
    const writer = recordingWriter();
    const session = new InteractiveSession({
      cwd: PROJECT_DIR,
      provider: provider(),
      bare: true,
      promptHistory: { writer, project: PROJECT_DIR },
    });
    await session.submit('what changed in the release notes?');
    expect(writer.entries).toHaveLength(1);
    expect(writer.entries[0]).toMatchObject({
      sessionId: session.sessionId,
      project: PROJECT_DIR,
      text: 'what changed in the release notes?',
    });
    expect(Number.isNaN(Date.parse(writer.entries[0]!.at))).toBe(false);
  });

  it('a throwing writer leaves one visible notice in history and the turn still completes', async () => {
    const writer: IPromptHistoryWriter = {
      append() {
        throw new Error('disk full');
      },
    };
    const session = new InteractiveSession({
      cwd: PROJECT_DIR,
      provider: provider(),
      bare: true,
      promptHistory: { writer, project: PROJECT_DIR },
    });
    await session.submit('first');
    await session.submit('second');
    const notices = session
      .getFullHistory()
      .filter((entry) => entry.type === 'system')
      .map((entry) => String((entry.data as { content?: string }).content ?? ''))
      .filter((content) => content.includes('Prompt history could not be written'));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('disk full');
  });

  it('writes nothing when no writer is supplied', async () => {
    const session = new InteractiveSession({
      cwd: PROJECT_DIR,
      provider: provider(),
      bare: true,
    });
    await session.submit('hello');
    expect(session.getFullHistory().some((entry) => entry.type === 'system')).toBe(false);
  });
});
