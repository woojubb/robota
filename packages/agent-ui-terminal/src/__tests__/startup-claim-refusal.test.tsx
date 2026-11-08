/**
 * A terminal start whose resumed session the store will not claim: the run ends with the
 * store's words and an error, not with Ink's error screen. The App builds its first channel while it
 * renders, where a throw is a stack trace instead of the one line that names the process holding the
 * session; any other failure of that call is still Ink's.
 *
 * The real App over a real store, with the writer marker of another process or of this store itself.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { SESSION_STILL_CLOSING_MESSAGE } from '@robota-sdk/agent-framework';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework/node';
import { render } from 'ink';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.js';

import type { ITuiAppChannelPort } from '../tui-app-channel-port.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

const HELD_ID = 'session_held_elsewhere';

/** What Ink wrote, as the terminal would have shown it. */
class RecordingStdout extends EventEmitter {
  readonly columns = 100;
  readonly frames: string[] = [];
  readonly write = (frame: string): boolean => {
    this.frames.push(frame);
    return true;
  };
}

class QuietStdin extends EventEmitter {
  readonly isTTY = true;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): null {
    return null;
  }
}

function cliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: () => ({}),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

/** A live process other than this one: the one that started this test worker. */
function liveOther() {
  const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
  const startTime = readProcessStartTime(process.ppid);
  return { ...here, pid: process.ppid, ...(startTime === undefined ? {} : { startTime }) };
}

describe('starting the terminal UI on a session the store will not claim', () => {
  let directory: string;
  let store: IInteractiveSessionStore;
  let stdout: RecordingStdout;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'agent-startup-claim-refusal-')));
    store = createNodeHostSessionStore(directory, { sealing: 'plain' });
    store.save({
      id: HELD_ID,
      cwd: directory,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      messages: [],
    });
    stdout = new RecordingStdout();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function start(createChannel: (resumeSessionId?: string) => ITuiAppChannelPort) {
    return render(
      <App
        cwd={directory}
        createChannel={createChannel}
        resumeSessionId={HELD_ID}
        sessionStore={store}
        cliAdapter={cliAdapter(join(directory, 'settings.json'))}
      />,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: new RecordingStdout() as unknown as NodeJS.WriteStream,
        stdin: new QuietStdin() as unknown as NodeJS.ReadStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
  }

  /** The channel factory the composition root gives the App: its first call claims the resumed record. */
  function claimingFactory() {
    return vi.fn((resumeSessionId?: string): ITuiAppChannelPort => {
      store.claim(resumeSessionId ?? 'unreachable');
      throw new Error('the claim was granted, which this test arranges not to happen');
    });
  }

  it("ends in the store's words, naming the process that holds the session, with no stack", async () => {
    leaveProcessMarker(join(directory, 'claims'), HELD_ID, liveOther());
    const createChannel = claimingFactory();

    const instance = start(createChannel);
    const ended = await instance.waitUntilExit().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(ended).toBeInstanceOf(Error);
    expect((ended as Error).message).toContain(
      `Session ${HELD_ID} is open in another process (pid ${process.ppid}`,
    );
    expect((ended as Error).message).toContain('which writes it; close it there first.');
    const shown = stdout.frames.join('');
    expect(shown).not.toContain('ERROR');
    expect(shown).not.toMatch(/\.tsx?:\d+/);
    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it('says "still closing" for a session this process still holds, as every other surface does', async () => {
    const held = store.claim(HELD_ID);

    const instance = start(claimingFactory());
    const ended = await instance.waitUntilExit().then(
      () => undefined,
      (error: unknown) => error,
    );
    held.release();

    expect(ended).toBeInstanceOf(Error);
    expect((ended as Error).message).toBe(SESSION_STILL_CLOSING_MESSAGE);
    expect(stdout.frames.join('')).not.toContain('ERROR');
  });

  it('leaves any other failure of the first channel to Ink, as before', async () => {
    const failure = new Error('the provider could not be built');

    const instance = start(
      vi.fn(() => {
        throw failure;
      }),
    );
    const ended = await instance.waitUntilExit().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(ended).toBe(failure);
    expect(stdout.frames.join('')).toContain('ERROR');
    expect(stdout.frames.join('')).toContain('the provider could not be built');
  });
});
