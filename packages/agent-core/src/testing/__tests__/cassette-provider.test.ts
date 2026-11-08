/**
 * Record-replay cassette provider machinery. Validated deterministically with a scripted
 * underlying provider — no network, no API key. Proves record→replay round-trip, staleness
 * detection, exhaustion, and workspace-path rewrite.
 */
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createReplayProvider, createRecordingProvider, createScriptedProvider } from '../index.js';

import type { TUniversalMessage } from '../../index.js';

let dir: string;
let cassette: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-cassette-')));
  cassette = join(dir, 'goal.cassette.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function userMessage(content: string): TUniversalMessage {
  return { id: `u-${content}`, role: 'user', content, state: 'complete', timestamp: new Date() };
}

describe('cassette provider', () => {
  it('records a real provider then replays it deterministically (round-trip)', async () => {
    const underlying = createScriptedProvider([{ text: 'first' }, { text: 'second' }]);
    const recorder = createRecordingProvider({
      provider: underlying.provider,
      cassettePath: cassette,
    });

    const a = await recorder.chat([userMessage('alpha')]);
    const b = await recorder.chat([userMessage('beta')]);
    expect(a.content).toBe('first');
    expect(b.content).toBe('second');

    const replay = createReplayProvider({ cassettePath: cassette });
    const ra = await replay.chat([userMessage('alpha')]);
    const rb = await replay.chat([userMessage('beta')]);
    expect(ra.content).toBe('first');
    expect(rb.content).toBe('second');
  });

  it('fails clearly when the request diverges from the recording (staleness)', async () => {
    const underlying = createScriptedProvider([{ text: 'only' }]);
    const recorder = createRecordingProvider({
      provider: underlying.provider,
      cassettePath: cassette,
    });
    await recorder.chat([userMessage('original prompt')]);

    const replay = createReplayProvider({ cassettePath: cassette });
    await expect(replay.chat([userMessage('a CHANGED prompt')])).rejects.toThrow(/stale/i);
  });

  it('fails clearly when replayed past the recording (exhaustion)', async () => {
    const underlying = createScriptedProvider([{ text: 'one' }]);
    const recorder = createRecordingProvider({
      provider: underlying.provider,
      cassettePath: cassette,
    });
    await recorder.chat([userMessage('q')]);

    const replay = createReplayProvider({ cassettePath: cassette });
    await replay.chat([userMessage('q')]);
    await expect(replay.chat([userMessage('q')])).rejects.toThrow(/exhausted/i);
  });

  it('normalizes the workspace path so an unchanged flow matches across record/replay cwds', async () => {
    const recordCwd = '/tmp/record-workspace-AAA';
    const replayCwd = '/tmp/replay-workspace-BBB';
    // The model references the (record-time) absolute workspace path in its response.
    const underlying = createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { command: `echo x > ${recordCwd}/out.txt` } }] },
    ]);
    const recorder = createRecordingProvider({
      provider: underlying.provider,
      cassettePath: cassette,
      recordCwd,
    });
    // Request also references the record cwd (as a goal prompt would).
    await recorder.chat([userMessage(`work in ${recordCwd}`)]);

    const replay = createReplayProvider({ cassettePath: cassette, rewriteCwd: replayCwd });
    // The replay request references the REPLAY cwd; staleness must still match (cwd scrubbed)...
    const response = await replay.chat([userMessage(`work in ${replayCwd}`)]);
    // ...and the recorded tool-call path is rewritten into the replay workspace.
    const toolCalls = 'toolCalls' in response ? response.toolCalls : undefined;
    const toolArgs = toolCalls?.[0]?.function.arguments ?? '';
    expect(toolArgs).toContain(replayCwd);
    expect(toolArgs).not.toContain(recordCwd);
  });
});

/**
 * A Windows workspace path carries backslashes, which JSON text spells doubled. These cases write the
 * paths as plain strings, so they hold on every host and not only where the path is native.
 */
describe('cassette provider with a Windows workspace path', () => {
  const posixCwd = '/tmp/record-workspace-AAA';
  const windowsCwd = 'C:\\Users\\runner\\work';
  const otherWindowsCwd = 'D:\\a\\replay\\work';

  function toolCallArguments(response: TUniversalMessage): Record<string, string> {
    const toolCalls = 'toolCalls' in response ? response.toolCalls : undefined;
    return JSON.parse(toolCalls?.[0]?.function.arguments ?? '{}') as Record<string, string>;
  }

  /** Records one tool call and one text answer that both name `recordCwd`, then replays them into `rewriteCwd`. */
  async function replayInto(
    recordCwd: string,
    rewriteCwd: string,
    separator: string,
  ): Promise<[TUniversalMessage, TUniversalMessage]> {
    const underlying = createScriptedProvider([
      {
        toolCalls: [
          {
            name: 'Bash',
            args: { command: `echo x > ${recordCwd}${separator}out.txt`, cwd: recordCwd },
          },
        ],
      },
      { text: `wrote ${recordCwd}${separator}out.txt` },
    ]);
    const recorder = createRecordingProvider({
      provider: underlying.provider,
      cassettePath: cassette,
      recordCwd,
    });
    await recorder.chat([userMessage(`work in ${recordCwd}`)]);
    await recorder.chat([userMessage(`finish in ${recordCwd}`)]);

    const replay = createReplayProvider({ cassettePath: cassette, rewriteCwd });
    return [
      await replay.chat([userMessage(`work in ${rewriteCwd}`)]),
      await replay.chat([userMessage(`finish in ${rewriteCwd}`)]),
    ];
  }

  it('replays a recording made on POSIX into a Windows workspace', async () => {
    const [toolTurn, textTurn] = await replayInto(posixCwd, windowsCwd, '/');

    expect(toolCallArguments(toolTurn)).toEqual({
      command: `echo x > ${windowsCwd}/out.txt`,
      cwd: windowsCwd,
    });
    expect(textTurn.content).toBe(`wrote ${windowsCwd}/out.txt`);
  });

  it('replays a recording made in a Windows workspace into another path', async () => {
    const [toolTurn, textTurn] = await replayInto(windowsCwd, posixCwd, '\\');

    expect(toolCallArguments(toolTurn)).toEqual({
      command: `echo x > ${posixCwd}\\out.txt`,
      cwd: posixCwd,
    });
    expect(textTurn.content).toBe(`wrote ${posixCwd}\\out.txt`);
  });

  it('replays a recording made in one Windows workspace into another', async () => {
    const [toolTurn, textTurn] = await replayInto(windowsCwd, otherWindowsCwd, '\\');

    expect(toolCallArguments(toolTurn)).toEqual({
      command: `echo x > ${otherWindowsCwd}\\out.txt`,
      cwd: otherWindowsCwd,
    });
    expect(textTurn.content).toBe(`wrote ${otherWindowsCwd}\\out.txt`);
  });

  it('still matches the next request, which carries the replayed tool call back', async () => {
    const underlying = createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { cwd: windowsCwd } }] },
      { text: 'done' },
    ]);
    const recorder = createRecordingProvider({
      provider: underlying.provider,
      cassettePath: cassette,
      recordCwd: windowsCwd,
    });
    const followUp = (assistant: TUniversalMessage, cwd: string): TUniversalMessage[] => [
      userMessage(`work in ${cwd}`),
      assistant,
      {
        id: 'tool-1',
        role: 'tool',
        content: `ran in ${cwd}`,
        toolCallId: 'call-1',
        state: 'complete',
        timestamp: new Date(),
      },
    ];
    const recordedAssistant = await recorder.chat([userMessage(`work in ${windowsCwd}`)]);
    await recorder.chat(followUp(recordedAssistant, windowsCwd));

    const replay = createReplayProvider({ cassettePath: cassette, rewriteCwd: otherWindowsCwd });
    const replayedAssistant = await replay.chat([userMessage(`work in ${otherWindowsCwd}`)]);

    await expect(replay.chat(followUp(replayedAssistant, otherWindowsCwd))).resolves.toMatchObject({
      content: 'done',
    });
  });
});
