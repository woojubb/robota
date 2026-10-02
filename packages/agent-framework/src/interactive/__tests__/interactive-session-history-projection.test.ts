import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import { GOAL_SIGNAL_TOOL_NAME } from '../../goal/index.js';
import { projectHistoryForDisplay } from '../interactive-session-history-projection.js';
import {
  applyToolStart,
  applyToolEnd,
  pushToolSummaryToHistory,
} from '../interactive-session-streaming.js';

import type { IHistoryEntry, IToolCall, TUniversalMessagePart } from '@robota-sdk/agent-core';
import type { IHistoryDisplaySegment } from '@robota-sdk/agent-interface-session';

/**
 * #3288 §2: the server-side history-to-display projector — turns stored chat history (assistant
 * `toolCalls` and their paired `role: 'tool'` results) into the same chronological display shapes a
 * live stream produces, for a reload/reconnect/session-resume replay.
 */

function toolCall(id: string, name: string, args: Record<string, unknown>): IToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function toolSegments(
  segments: readonly IHistoryDisplaySegment[],
): Extract<IHistoryDisplaySegment, { type: 'tool' }>[] {
  return segments.filter(
    (s): s is Extract<IHistoryDisplaySegment, { type: 'tool' }> => s.type === 'tool',
  );
}

describe('projectHistoryForDisplay: pairing by id', () => {
  it.each([false, true])(
    'keeps separate occurrences of reused call IDs (new turn: %s)',
    (newTurn) => {
      const state = {
        history: [] as IHistoryEntry[],
        activeTools: [] as import('../types.js').IToolState[],
      };
      for (const [index, success] of [true, false].entries()) {
        if (index === 0 || newTurn)
          state.history.push(messageToHistoryEntry(createUserMessage(`turn-${index}`)));
        applyToolStart(state, { toolName: 'Save', executionId: 'reused' });
        applyToolEnd(state, {
          toolName: 'Save',
          executionId: 'reused',
          success,
          toolResultData: `outcome-${index}`,
        });
        pushToolSummaryToHistory(state);
        state.activeTools = [];
      }
      const tools = toolSegments(projectHistoryForDisplay(state.history));
      expect(tools.map(({ tool }) => [tool.executionId, tool.result, tool.toolResultData])).toEqual(
        [
          ['reused', 'success', 'outcome-0'],
          ['reused', 'error', 'outcome-1'],
        ],
      );
    },
  );

  it('restores all actual streamed calls after the active display cache trims old calls', () => {
    const history: IHistoryEntry[] = [messageToHistoryEntry(createUserMessage('observe'))];
    const state = { history, activeTools: [] as import('../types.js').IToolState[] };
    const parts: TUniversalMessagePart[] = [
      { type: 'image_inline', mimeType: 'image/png', data: 'aW1hZ2U=' },
    ];
    for (let index = 0; index < 100; index++) {
      applyToolStart(state, {
        toolName: 'fixture__observe',
        executionId: `call-${index}`,
        toolArgs: { text: String(index) },
      });
      applyToolEnd(state, {
        toolName: 'fixture__observe',
        executionId: `call-${index}`,
        success: index !== 7,
        toolResultData: `observed-${index}`,
        toolResultParts: index === 0 ? parts : undefined,
      });
    }
    pushToolSummaryToHistory(state);
    history.push(messageToHistoryEntry(createAssistantMessage('done')));
    expect(state.activeTools).toHaveLength(50);
    const before = JSON.stringify(history);
    const tools = toolSegments(projectHistoryForDisplay(history));
    expect(tools.map(({ tool }) => tool.executionId)).toEqual(
      Array.from({ length: 100 }, (_, index) => `call-${index}`),
    );
    expect(tools[0]?.tool.toolResultParts).toEqual(parts);
    expect(tools[7]?.tool.result).toBe('error');
    expect(tools[99]?.tool.toolResultData).toBe('observed-99');
    expect(JSON.stringify(history)).toBe(before);
  });

  it('preserves start order and denied status when same-named calls finish in reverse order', () => {
    const state = {
      history: [] as IHistoryEntry[],
      activeTools: [] as import('../types.js').IToolState[],
    };
    applyToolStart(state, {
      toolName: 'same',
      executionId: 'a',
      commandName: 'inspect',
      internal: true,
    });
    applyToolStart(state, { toolName: 'same', executionId: 'b' });
    applyToolEnd(state, { toolName: 'same', executionId: 'b', success: false, denied: true });
    applyToolEnd(state, { toolName: 'same', executionId: 'a', success: true, toolResultData: 'A' });
    const tools = toolSegments(projectHistoryForDisplay(state.history));
    expect(tools.map(({ tool }) => tool.executionId)).toEqual(['a', 'b']);
    expect(tools[0]?.tool).toMatchObject({
      toolResultData: 'A',
      commandName: 'inspect',
      internal: true,
    });
    expect(tools[1]?.tool.result).toBe('denied');
  });

  it('renders an interrupted start as terminal and uses legacy summaries without duplicate chat calls', () => {
    const state = {
      history: [] as IHistoryEntry[],
      activeTools: [] as import('../types.js').IToolState[],
    };
    applyToolStart(state, { toolName: 'same', executionId: 'interrupted' });
    state.history.push({
      id: 'legacy',
      timestamp: new Date(),
      category: 'event',
      type: 'tool-summary',
      data: {
        tools: [
          {
            toolName: 'same',
            executionId: 'legacy',
            isRunning: false,
            result: 'success',
            toolResultData: 'old observation',
          },
          { toolName: 'same', executionId: 'chat', isRunning: false, result: 'error' },
        ],
      },
    });
    state.history.push(
      messageToHistoryEntry(
        createAssistantMessage(null, { toolCalls: [toolCall('chat', 'same', {})] }),
      ),
    );
    state.history.push(
      messageToHistoryEntry(
        createToolMessage('chat observation', { toolCallId: 'chat', metadata: { success: true } }),
      ),
    );
    const tools = toolSegments(projectHistoryForDisplay(state.history));
    expect(tools.map(({ tool }) => tool.executionId)).toEqual(['interrupted', 'legacy', 'chat']);
    expect(tools[0]?.tool).toMatchObject({ isRunning: false, result: 'error' });
    expect(tools[1]?.tool.toolResultData).toBe('old observation');
    expect(tools[2]?.tool).toMatchObject({ result: 'success', toolResultData: 'chat observation' });
  });

  it('retains mixed observations with the call and resource identities after replay', () => {
    const parts: TUniversalMessagePart[] = [
      { type: 'text', text: 'observed revision 7' },
      { type: 'image_inline', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
      { type: 'resource_link', uri: 'fixture:receipt/7', name: 'receipt' },
    ];
    const history = [
      messageToHistoryEntry(
        createAssistantMessage(null, {
          toolCalls: [toolCall('observed-7', 'fixture__observe', {})],
        }),
      ),
      messageToHistoryEntry(
        createToolMessage('{"revision":7}', {
          toolCallId: 'observed-7',
          name: 'fixture__observe',
          metadata: { success: true },
          parts,
        }),
      ),
    ];
    expect(toolSegments(projectHistoryForDisplay(history))[0]?.tool).toMatchObject({
      executionId: 'observed-7',
      toolName: 'fixture__observe',
      toolResultParts: parts,
    });
  });

  it('pairs two parallel same-named calls by their own id, never by position or name', () => {
    const assistant = createAssistantMessage(null, {
      toolCalls: [
        toolCall('call-a', 'Read', { filePath: 'a.ts' }),
        toolCall('call-b', 'Read', { filePath: 'b.ts' }),
      ],
    });
    // The results are recorded in the REVERSED order relative to the calls — a name-based or
    // position-based pairing would swap them; an id-based pairing must not.
    const resultB = createToolMessage('RESULT_FOR_B', { toolCallId: 'call-b', name: 'Read' });
    const resultA = createToolMessage('RESULT_FOR_A', { toolCallId: 'call-a', name: 'Read' });

    const history: IHistoryEntry[] = [
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(resultB),
      messageToHistoryEntry(resultA),
    ];

    const tools = toolSegments(projectHistoryForDisplay(history));
    expect(tools).toHaveLength(2);
    // Segment order follows the CALL order (call-a, then call-b) — the result order in history must
    // not reorder them.
    expect(tools[0]?.tool.executionId).toBe('call-a');
    expect(tools[0]?.tool.toolResultData).toBe('RESULT_FOR_A');
    expect(tools[1]?.tool.executionId).toBe('call-b');
    expect(tools[1]?.tool.toolResultData).toBe('RESULT_FOR_B');
  });
});

describe('projectHistoryForDisplay: MUST-1 parity — a historical diff never reads the file system', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('an Edit call whose file exists on disk still gets NO context lines — args only', () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'history-projection-')));
    const filePath = join(tmpDir, 'real.md');
    // If the projector read this file, ITS content — not the call's own args — would leak into the
    // diff as context lines. The file may have changed since the historical call ran; reading it now
    // would show TODAY's content as if it were part of that old diff, which is simply wrong.
    writeFileSync(filePath, 'REAL_DISK_LINE_1\nold line\nREAL_DISK_LINE_2\n', 'utf8');

    const assistant = createAssistantMessage(null, {
      toolCalls: [
        toolCall('call-edit', 'Edit', { filePath, oldString: 'old line', newString: 'new line' }),
      ],
    });
    const result = createToolMessage(JSON.stringify({ success: true, startLine: 2 }), {
      toolCallId: 'call-edit',
      name: 'Edit',
    });
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(result),
    ];

    const tools = toolSegments(projectHistoryForDisplay(history, { cwd: tmpDir }));
    expect(tools).toHaveLength(1);
    const { diffLines } = tools[0]!.tool;
    expect(diffLines?.some((l) => l.type === 'context')).toBe(false);
    const text = (diffLines ?? []).map((l) => l.text).join('\n');
    expect(text).not.toContain('REAL_DISK_LINE');
    // The diff still reflects the call's OWN arguments, unaffected by not reading the file.
    expect(text).toContain('old line');
    expect(text).toContain('new line');
  });
});

describe('projectHistoryForDisplay: caps apply', () => {
  it('caps a large historical Edit the same way a live one is capped', () => {
    const bigOld = Array.from({ length: 520 }, (_, i) => `old ${i}`).join('\n');
    const bigNew = Array.from({ length: 520 }, (_, i) => `new ${i}`).join('\n');
    const assistant = createAssistantMessage(null, {
      toolCalls: [
        toolCall('call-big', 'Edit', {
          filePath: '/tmp/big.md',
          oldString: bigOld,
          newString: bigNew,
        }),
      ],
    });
    const result = createToolMessage(JSON.stringify({ success: true }), {
      toolCallId: 'call-big',
      name: 'Edit',
    });
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(result),
    ];

    const tools = toolSegments(projectHistoryForDisplay(history));
    const diffLines = tools[0]?.tool.diffLines ?? [];
    const removeLines = diffLines.filter((l) => l.type === 'remove');
    const addLines = diffLines.filter((l) => l.type === 'add');
    expect(removeLines.length).toBe(500);
    expect(addLines.length).toBe(500);
    expect(
      diffLines.some((l) => l.type === 'hunk' && /more removed lines truncated/.test(l.text)),
    ).toBe(true);
  });

  it('caps a large historical Write the same way a live one is capped', () => {
    const bigContent = Array.from({ length: 520 }, (_, i) => `line ${i}`).join('\n');
    const assistant = createAssistantMessage(null, {
      toolCalls: [
        toolCall('call-write', 'Write', { filePath: '/tmp/big-write.md', content: bigContent }),
      ],
    });
    const result = createToolMessage(JSON.stringify({ success: true }), {
      toolCallId: 'call-write',
      name: 'Write',
    });
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(result),
    ];

    const tools = toolSegments(projectHistoryForDisplay(history));
    const diffLines = tools[0]?.tool.diffLines ?? [];
    const addLines = diffLines.filter((l) => l.type === 'add');
    expect(addLines.length).toBe(500);
    expect(diffLines.at(-1)?.text).toMatch(/more lines truncated/);
  });
});

describe('projectHistoryForDisplay: an unresolved call (interrupted before any result)', () => {
  it('renders as a failed call instead of a perpetual spinner', () => {
    const assistant = createAssistantMessage(null, {
      toolCalls: [toolCall('call-orphan', 'Bash', { command: 'pnpm test' })],
      state: 'interrupted',
    });
    const history: IHistoryEntry[] = [messageToHistoryEntry(assistant)];

    const tools = toolSegments(projectHistoryForDisplay(history));
    expect(tools).toHaveLength(1);
    expect(tools[0]?.tool.isRunning).toBe(false);
    expect(tools[0]?.tool.result).toBe('error');
    expect(tools[0]?.tool.toolResultData).toBeUndefined();
  });
});

describe('projectHistoryForDisplay: commandName/internal classification (parity with live)', () => {
  it('flags the goal-signal tool as internal, and a registered command tool with its commandName', () => {
    const assistant = createAssistantMessage(null, {
      toolCalls: [
        toolCall('call-goal', GOAL_SIGNAL_TOOL_NAME, { status: 'in_progress' }),
        toolCall('call-cmd', 'agent', { task: 'do the thing' }),
      ],
    });
    const goalResult = createToolMessage(JSON.stringify({ success: true }), {
      toolCallId: 'call-goal',
      name: GOAL_SIGNAL_TOOL_NAME,
    });
    const cmdResult = createToolMessage(JSON.stringify({ success: true }), {
      toolCallId: 'call-cmd',
      name: 'agent',
    });
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(goalResult),
      messageToHistoryEntry(cmdResult),
    ];

    const tools = toolSegments(
      projectHistoryForDisplay(history, { modelCommandToolNames: new Map([['agent', 'agent']]) }),
    );
    expect(tools[0]?.tool.internal).toBe(true);
    expect(tools[1]?.tool.commandName).toBe('agent');
    expect(tools[1]?.tool.internal).toBeUndefined();
  });
});

describe('projectHistoryForDisplay: chronological order and role filtering', () => {
  it('keeps user/assistant text and tool calls in order, and drops system entries', () => {
    const user = createUserMessage('please edit the file');
    const assistant = createAssistantMessage('Sure, editing now.', {
      toolCalls: [
        toolCall('call-1', 'Edit', { filePath: '/tmp/x.md', oldString: 'a', newString: 'b' }),
      ],
    });
    const result = createToolMessage(JSON.stringify({ success: true }), {
      toolCallId: 'call-1',
      name: 'Edit',
    });
    const history: IHistoryEntry[] = [
      {
        id: 'sys-1',
        timestamp: new Date(),
        category: 'chat',
        type: 'system',
        data: {
          role: 'system',
          content: 'be helpful',
          id: 's',
          timestamp: new Date(),
          state: 'complete',
        },
      },
      messageToHistoryEntry(user),
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(result),
      // A non-chat entry (e.g. the separate tool-start/tool-end event trail) must be ignored — only
      // `category: 'chat'` entries carry a message.
      { id: 'evt-1', timestamp: new Date(), category: 'event', type: 'tool-start', data: {} },
    ];

    const segments = projectHistoryForDisplay(history);
    expect(segments).toEqual([
      { type: 'text', role: 'user', content: 'please edit the file' },
      { type: 'text', role: 'assistant', content: 'Sure, editing now.' },
      { type: 'tool', tool: expect.objectContaining({ toolName: 'Edit', isRunning: false }) },
    ]);
  });

  it('emits no text segment for an assistant message with no content (tool-calls only)', () => {
    const assistant = createAssistantMessage(null, {
      toolCalls: [toolCall('call-1', 'Bash', { command: 'ls' })],
    });
    const result = createToolMessage(JSON.stringify({ success: true, output: 'a.ts' }), {
      toolCallId: 'call-1',
      name: 'Bash',
    });
    const history: IHistoryEntry[] = [
      messageToHistoryEntry(assistant),
      messageToHistoryEntry(result),
    ];

    const segments = projectHistoryForDisplay(history);
    expect(segments.filter((s) => s.type === 'text')).toHaveLength(0);
    expect(segments).toHaveLength(1);
  });
});
