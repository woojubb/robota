// @vitest-environment jsdom
/**
 * #3288 §2 (history replay): a reload, reconnect or session resume has no live stream to rebuild tool
 * rows from — only the `messages` frame's `display` projection (built server-side, tested in
 * `agent-framework`'s `interactive-session-history-projection.test.ts`). `useSessionClient` must turn
 * THAT into the same `TConversationEntry[]` shapes ('tools' rows with diffs, a 'changed-files' row per
 * turn) a live turn's `finishTurn` produces — reusing the SAME components, not a parallel rendering.
 *
 * On `develop` (before this file's change), `case 'messages'` only ever read `msg.messages` and built
 * bare `{role, content}` text bubbles — it had no `display` branch at all, so every test below that
 * asserts a `'tools'`/`'changed-files'` entry would fail (the array would contain only `'user'` /
 * `'assistant'` text entries).
 */

import { renderHook } from '../../testing/product-provider.js';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { IDiffLine, IToolState } from '@robota-sdk/agent-interface-session';
import type { TServerMessage } from '@robota-sdk/agent-transport';

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    return { connect: () => {}, disconnect: () => {}, send: () => {} };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return {
    result,
    deliver: (msg) => {
      act(() => onMessage?.(msg));
    },
  };
}

const editDiffLines: IDiffLine[] = [
  { type: 'hunk', text: '@@ -1,1 +1,1 @@', lineNumber: 1 },
  { type: 'remove', text: 'old line', lineNumber: 1 },
  { type: 'add', text: 'new line', lineNumber: 1 },
];

function editToolState(overrides: Partial<IToolState> = {}): IToolState {
  return {
    toolName: 'Edit',
    firstArg: '/workspace/src/file.ts',
    isRunning: false,
    result: 'success',
    diffFile: 'src/file.ts',
    diffLines: editDiffLines,
    executionId: 'call-1',
    ...overrides,
  };
}

describe('#3288 §2: a messages frame with display rebuilds tool rows, diffs and Changed files', () => {
  it('renders a denied tool as failed in both live and restored views', () => {
    const state = editToolState({ result: 'denied' });
    const live = setup();
    live.deliver({ type: 'tool_start', state: { ...state, isRunning: true } });
    live.deliver({ type: 'tool_end', state });
    expect(live.result.current.activeTools[0]?.status).toBe('error');
    const restored = setup();
    restored.deliver({ type: 'messages', messages: [], display: [{ type: 'tool', tool: state }] });
    expect(restored.result.current.messages[0]).toMatchObject({
      role: 'tools',
      tools: [expect.objectContaining({ status: 'error', result: 'denied' })],
    });
  });

  it('preserves mixed observations through both live settlement and replay', () => {
    const parts = [{ type: 'resource_link' as const, uri: 'fixture:receipt/7', name: 'receipt' }];
    const state: IToolState = {
      toolName: 'fixture__observe',
      firstArg: '',
      executionId: 'call-7',
      isRunning: false,
      result: 'success',
      toolResultParts: parts,
    };
    const live = setup();
    live.deliver({ type: 'tool_start', state: { ...state, isRunning: true } });
    live.deliver({ type: 'tool_end', state });
    expect(live.result.current.activeTools[0]).toMatchObject({
      executionId: 'call-7',
      toolResultParts: parts,
    });
    const replay = setup();
    replay.deliver({ type: 'messages', messages: [], display: [{ type: 'tool', tool: state }] });
    expect(replay.result.current.messages[0]).toMatchObject({
      role: 'tools',
      tools: [expect.objectContaining({ executionId: 'call-7', toolResultParts: parts })],
    });
  });

  it('a finished Edit call becomes a tools row carrying the SAME diff a live tool_end would', () => {
    const { result, deliver } = setup();
    deliver({
      type: 'messages',
      messages: [],
      display: [
        { type: 'text', role: 'user', content: 'please fix the bug' },
        { type: 'text', role: 'assistant', content: 'Done.' },
        { type: 'tool', tool: editToolState() },
      ],
    });

    const roles = result.current.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tools', 'changed-files']);

    const toolsEntry = result.current.messages.find((m) => m.role === 'tools');
    expect(toolsEntry).toMatchObject({
      role: 'tools',
      tools: [
        expect.objectContaining({
          name: 'Edit',
          status: 'done',
          diffFile: 'src/file.ts',
          diffLines: editDiffLines,
        }),
      ],
    });

    const changedFilesEntry = result.current.messages.find((m) => m.role === 'changed-files');
    expect(changedFilesEntry).toMatchObject({
      role: 'changed-files',
      files: [{ path: 'src/file.ts', added: 1, removed: 1 }],
    });
  });

  it('a failed call renders with status "error", and Shell output survives in toolResultData', () => {
    const { result, deliver } = setup();
    const shellResult = JSON.stringify({ success: false, error: 'command failed', exitCode: 1 });
    deliver({
      type: 'messages',
      messages: [],
      display: [
        { type: 'text', role: 'user', content: 'run the tests' },
        {
          type: 'tool',
          tool: {
            toolName: 'Bash',
            firstArg: 'pnpm test',
            isRunning: false,
            result: 'error',
            toolResultData: shellResult,
          },
        },
      ],
    });

    const toolsEntry = result.current.messages.find((m) => m.role === 'tools');
    expect(toolsEntry).toMatchObject({
      role: 'tools',
      tools: [
        expect.objectContaining({ name: 'Bash', status: 'error', toolResultData: shellResult }),
      ],
    });
  });

  it('carries commandName/internal through unchanged, for the same hiding/labeling the live path uses', () => {
    const { result, deliver } = setup();
    deliver({
      type: 'messages',
      messages: [],
      display: [
        { type: 'text', role: 'user', content: 'go' },
        {
          type: 'tool',
          tool: {
            toolName: 'report_goal_status',
            firstArg: '',
            isRunning: false,
            result: 'success',
            internal: true,
          },
        },
        {
          type: 'tool',
          tool: {
            toolName: 'agent',
            firstArg: 'do the thing',
            isRunning: false,
            result: 'success',
            commandName: 'agent',
          },
        },
      ],
    });

    const toolsEntry = result.current.messages.find((m) => m.role === 'tools');
    expect(toolsEntry).toMatchObject({
      tools: [
        expect.objectContaining({ name: 'report_goal_status', internal: true }),
        expect.objectContaining({ name: 'agent', commandName: 'agent' }),
      ],
    });
  });

  it('gives each turn its OWN Changed files row, not one merged across the whole history', () => {
    const { result, deliver } = setup();
    deliver({
      type: 'messages',
      messages: [],
      display: [
        { type: 'text', role: 'user', content: 'edit file one' },
        { type: 'tool', tool: editToolState({ executionId: 'call-1', diffFile: 'one.ts' }) },
        { type: 'text', role: 'user', content: 'edit file two' },
        { type: 'tool', tool: editToolState({ executionId: 'call-2', diffFile: 'two.ts' }) },
      ],
    });

    const changedFilesEntries = result.current.messages.filter((m) => m.role === 'changed-files');
    expect(changedFilesEntries).toHaveLength(2);
    expect(changedFilesEntries[0]).toMatchObject({ files: [{ path: 'one.ts' }] });
    expect(changedFilesEntries[1]).toMatchObject({ files: [{ path: 'two.ts' }] });
  });

  it('falls back to text-only bubbles when the host has no display projection yet (back-compat)', () => {
    const { result, deliver } = setup();
    deliver({
      type: 'messages',
      messages: [
        { role: 'user', content: 'hi', id: 'm1', timestamp: new Date(), state: 'complete' },
        { role: 'assistant', content: 'hello', id: 'm2', timestamp: new Date(), state: 'complete' },
      ],
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'hi' }),
      expect.objectContaining({ role: 'assistant', content: 'hello' }),
    ]);
  });
});
