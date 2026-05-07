/**
 * Unit tests for TuiStateManager — pure TypeScript, no React.
 * Tests event → state transitions that must survive any refactoring.
 */

import { describe, it, expect, vi } from 'vitest';
import { TuiStateManager } from '../tui-state-manager.js';
import { trimBackgroundPreview } from '../background-task-view-model.js';
import type { IToolState, IExecutionResult, IBackgroundTaskState } from '@robota-sdk/agent-sdk';

function makeResult(overrides?: Partial<IExecutionResult>): IExecutionResult {
  return {
    response: 'test response',
    history: [],
    toolSummaries: [],
    contextState: {
      usedPercentage: 10,
      remainingPercentage: 90,
      usedTokens: 1000,
      maxTokens: 200000,
    },
    ...overrides,
  };
}

function makeBackgroundTask(
  overrides: Partial<IBackgroundTaskState> & Pick<IBackgroundTaskState, 'id' | 'status'>,
): IBackgroundTaskState {
  return {
    kind: 'agent',
    label: 'Explore',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/workspace',
    updatedAt: '2026-05-01T00:00:00.000Z',
    unread: false,
    promptPreview: 'Find files',
    ...overrides,
  };
}

describe('TuiStateManager', () => {
  // ── Streaming text ────────────────────────────────────────────

  it('accumulates streaming text on text_delta', () => {
    const mgr = new TuiStateManager();
    mgr.onTextDelta('Hello');
    mgr.onTextDelta(' world');
    expect(mgr.streamingText).toBe('Hello world');
  });

  it('clears streaming text on thinking=true', () => {
    const mgr = new TuiStateManager();
    mgr.onTextDelta('old text');
    mgr.onThinking(true);
    expect(mgr.streamingText).toBe('');
  });

  it('clears streaming text on complete', () => {
    const mgr = new TuiStateManager();
    mgr.onTextDelta('streaming');
    mgr.onComplete(makeResult());
    expect(mgr.streamingText).toBe('');
  });

  it('clears streaming text on interrupted', () => {
    const mgr = new TuiStateManager();
    mgr.onTextDelta('partial');
    mgr.onInterrupted();
    expect(mgr.streamingText).toBe('');
  });

  // ── Tool state ────────────────────────────────────────────────

  it('adds tool on tool_start', () => {
    const mgr = new TuiStateManager();
    const tool: IToolState = { toolName: 'Read', firstArg: 'file.ts', isRunning: true };
    mgr.onToolStart(tool);
    expect(mgr.activeTools).toHaveLength(1);
    expect(mgr.activeTools[0]!.toolName).toBe('Read');
  });

  it('updates tool on tool_end', () => {
    const mgr = new TuiStateManager();
    mgr.onToolStart({ toolName: 'Read', firstArg: 'file.ts', isRunning: true });
    mgr.onToolEnd({ toolName: 'Read', firstArg: 'file.ts', isRunning: false, result: 'success' });
    expect(mgr.activeTools[0]!.isRunning).toBe(false);
    expect(mgr.activeTools[0]!.result).toBe('success');
  });

  it('clears tools on thinking=true (next execution start)', () => {
    const mgr = new TuiStateManager();
    mgr.onToolStart({ toolName: 'Read', firstArg: '', isRunning: true });
    mgr.onThinking(true);
    expect(mgr.activeTools).toEqual([]);
  });

  it('clears tools on complete (tool summary now in messages)', () => {
    const mgr = new TuiStateManager();
    mgr.onToolStart({ toolName: 'Read', firstArg: '', isRunning: true });
    mgr.onComplete(makeResult());
    expect(mgr.activeTools).toEqual([]);
  });

  it('clears tools on interrupted (tool summary now in messages)', () => {
    const mgr = new TuiStateManager();
    mgr.onToolStart({ toolName: 'Read', firstArg: '', isRunning: true });
    mgr.onInterrupted();
    expect(mgr.activeTools).toEqual([]);
  });

  it('clears rendered history, streaming text, and active tools on explicit history clear', () => {
    const mgr = new TuiStateManager();
    mgr.addEntry({
      id: 'old',
      timestamp: new Date('2026-05-03T00:00:00.000Z'),
      category: 'chat',
      type: 'user',
      data: { role: 'user', content: 'old message' },
    });
    mgr.onTextDelta('partial');
    mgr.onToolStart({ toolName: 'Read', firstArg: 'file.ts', isRunning: true });

    mgr.clearHistory();

    expect(mgr.history).toEqual([]);
    expect(mgr.streamingText).toBe('');
    expect(mgr.activeTools).toEqual([]);
  });

  // ── Thinking state ────────────────────────────────────────────

  it('sets isThinking on thinking event', () => {
    const mgr = new TuiStateManager();
    mgr.onThinking(true);
    expect(mgr.isThinking).toBe(true);
    mgr.onThinking(false);
    expect(mgr.isThinking).toBe(false);
  });

  it('clears isAborting on thinking=false', () => {
    const mgr = new TuiStateManager();
    mgr.setAborting(true);
    expect(mgr.isAborting).toBe(true);
    mgr.onThinking(false);
    expect(mgr.isAborting).toBe(false);
  });

  // ── Context state ─────────────────────────────────────────────

  it('updates context on complete', () => {
    const mgr = new TuiStateManager();
    mgr.onComplete(
      makeResult({
        contextState: {
          usedPercentage: 50,
          remainingPercentage: 50,
          usedTokens: 5000,
          maxTokens: 10000,
        },
      }),
    );
    expect(mgr.contextState.percentage).toBe(50);
    expect(mgr.contextState.usedTokens).toBe(5000);
  });

  // ── Messages ──────────────────────────────────────────────────

  it('addMessage appends to messages', () => {
    const mgr = new TuiStateManager();
    mgr.addEntry({ role: 'user', content: 'hello' } as never);
    mgr.addEntry({ role: 'assistant', content: 'world' } as never);
    expect(mgr.history).toHaveLength(2);
  });

  it('addEntry windows to MAX_RENDERED_MESSAGES', () => {
    const mgr = new TuiStateManager();
    for (let i = 0; i < 110; i++) {
      mgr.addEntry({
        id: `${i}`,
        timestamp: new Date(),
        category: 'chat',
        type: 'user',
        data: { content: `msg ${i}` },
      } as never);
    }
    expect(mgr.history).toHaveLength(100);
  });

  it('syncMessages replaces all messages', () => {
    const mgr = new TuiStateManager();
    mgr.addEntry({ role: 'user', content: 'old' } as never);
    mgr.syncHistory([
      { role: 'user', content: 'new1' } as never,
      { role: 'assistant', content: 'new2' } as never,
    ]);
    expect(mgr.history).toHaveLength(2);
    expect((mgr.history[0]! as unknown as { content: string }).content).toBe('new1');
  });

  // ── onChange notification ──────────────────────────────────────

  it('calls onChange on every non-debounced state change', () => {
    const mgr = new TuiStateManager();
    const onChange = vi.fn();
    mgr.onChange = onChange;

    mgr.onTextDelta('hi'); // debounced — does NOT call onChange immediately
    mgr.onToolStart({ toolName: 'Read', firstArg: '', isRunning: true });
    mgr.onThinking(true); // flushes debounce timer
    mgr.addEntry({ role: 'user', content: 'test' } as never);
    mgr.setAborting(true);
    mgr.setPendingPrompt('queued');
    mgr.setContextState({ percentage: 50, usedTokens: 5000, maxTokens: 10000 });

    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('onTextDelta debounces notify calls', async () => {
    const mgr = new TuiStateManager();
    const onChange = vi.fn();
    mgr.onChange = onChange;

    mgr.onTextDelta('a');
    mgr.onTextDelta('b');
    mgr.onTextDelta('c');

    expect(onChange).toHaveBeenCalledTimes(0);
    expect(mgr.streamingText).toBe('abc');

    await new Promise((r) => setTimeout(r, 400));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not crash when onChange is null', () => {
    const mgr = new TuiStateManager();
    expect(() => mgr.onTextDelta('hi')).not.toThrow();
  });

  it('projects background task lifecycle events into view models', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_created',
      task: {
        id: 'agent_1',
        kind: 'agent',
        label: 'Explore',
        status: 'queued',
        mode: 'background',
        parentSessionId: 'session_parent',
        depth: 1,
        cwd: '/workspace',
        updatedAt: '2026-04-30T00:00:00.000Z',
        unread: false,
        promptPreview: 'Find files',
      },
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_started',
      task: {
        id: 'agent_1',
        kind: 'agent',
        label: 'Explore',
        status: 'running',
        mode: 'background',
        parentSessionId: 'session_parent',
        depth: 1,
        cwd: '/workspace',
        updatedAt: '2026-04-30T00:00:01.000Z',
        unread: false,
        promptPreview: 'Find files',
      },
    });

    expect(mgr.backgroundTasks).toHaveLength(1);
    expect(mgr.backgroundTasks[0]!.id).toBe('agent_1');
    expect(mgr.backgroundTasks[0]!.status).toBe('running');
    expect(mgr.backgroundTasks[0]!.preview).toBe('Find files');
  });

  it('updates and closes background task projections', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_completed',
      task: {
        id: 'agent_1',
        kind: 'agent',
        label: 'Explore',
        status: 'completed',
        mode: 'background',
        parentSessionId: 'session_parent',
        depth: 1,
        cwd: '/workspace',
        updatedAt: '2026-04-30T00:00:01.000Z',
        unread: true,
        result: { taskId: 'agent_1', kind: 'agent', output: 'Done' },
      },
    });

    expect(mgr.backgroundTasks[0]!.status).toBe('completed');
    expect(mgr.backgroundTasks[0]!.unread).toBe(true);
    expect(mgr.backgroundTasks[0]!.resultPreview).toBe('Done');

    mgr.onBackgroundTaskEvent({ type: 'background_task_closed', taskId: 'agent_1' });

    expect(mgr.backgroundTasks).toEqual([]);
  });

  it('projects timeout reason and last activity for background tasks', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_failed',
      task: makeBackgroundTask({
        id: 'agent_timeout',
        status: 'failed',
        lastActivityAt: '2026-05-01T00:00:10.000Z',
        timeoutReason: 'idle',
        error: {
          category: 'timeout',
          message: 'Background agent idle timeout',
          recoverable: true,
        },
      }),
    });

    expect(mgr.backgroundTasks[0]!.statusLabel).toBe('timed out');
    expect(mgr.backgroundTasks[0]!.timeoutReason).toBe('idle');
    expect(mgr.backgroundTasks[0]!.lastActivityAt).toBe('2026-05-01T00:00:10.000Z');
  });

  it('normalizes background task previews into one trimmed line', () => {
    expect(trimBackgroundPreview('\n\n  The analysis\n\n reveals   details  ')).toBe(
      'The analysis reveals details',
    );
  });

  it('accumulates background text deltas and tool action previews', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_started',
      task: {
        id: 'agent_1',
        kind: 'agent',
        label: 'Explore',
        status: 'running',
        mode: 'background',
        parentSessionId: 'session_parent',
        depth: 1,
        cwd: '/workspace',
        updatedAt: '2026-05-01T00:00:00.000Z',
        unread: false,
        promptPreview: 'Find files',
      },
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_tool_start',
      taskId: 'agent_1',
      toolName: 'Read',
      firstArg: 'file.ts',
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_text_delta',
      taskId: 'agent_1',
      delta: '\n\npartial ',
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_text_delta',
      taskId: 'agent_1',
      delta: 'answer\n\n',
    });

    expect(mgr.backgroundTasks[0]!.currentAction).toBe('file.ts');
    expect(mgr.backgroundTasks[0]!.resultPreview).toBe('partial answer');
  });

  it('hides clean completed background tasks at the next user turn boundary', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_completed',
      task: makeBackgroundTask({
        id: 'agent_1',
        status: 'completed',
        unread: true,
        result: { taskId: 'agent_1', kind: 'agent', output: 'Done' },
      }),
    });

    expect(mgr.backgroundTasks).toHaveLength(1);

    mgr.onUserTurnAccepted();

    expect(mgr.backgroundTasks).toEqual([]);
  });

  it('keeps active and actionable terminal background tasks visible at turn boundaries', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_started',
      task: makeBackgroundTask({ id: 'agent_running', status: 'running' }),
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_failed',
      task: makeBackgroundTask({
        id: 'agent_failed',
        status: 'failed',
        unread: true,
        error: { category: 'runner', message: 'failed', recoverable: true },
      }),
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_cancelled',
      task: makeBackgroundTask({
        id: 'agent_cancelled',
        status: 'cancelled',
        unread: true,
        error: { category: 'runner', message: 'cancelled', recoverable: true },
      }),
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_completed',
      task: makeBackgroundTask({
        id: 'agent_worktree',
        status: 'completed',
        unread: true,
        worktreePath: '/workspace/.robota/worktrees/agent_worktree',
        branchName: 'robota/agent_worktree',
        result: { taskId: 'agent_worktree', kind: 'agent', output: 'Dirty worktree' },
      }),
    });
    mgr.onBackgroundTaskEvent({
      type: 'background_task_completed',
      task: makeBackgroundTask({
        id: 'process_nonzero',
        kind: 'process',
        status: 'completed',
        unread: true,
        commandPreview: 'pnpm test',
        result: { taskId: 'process_nonzero', kind: 'process', output: 'failed', exitCode: 1 },
      }),
    });

    mgr.onUserTurnAccepted();

    expect(mgr.backgroundTasks.map((task) => task.id)).toEqual([
      'agent_running',
      'agent_failed',
      'agent_cancelled',
      'agent_worktree',
      'process_nonzero',
    ]);
  });

  it('clears hidden completed task presentation state when the runtime closes it', () => {
    const mgr = new TuiStateManager();

    mgr.onBackgroundTaskEvent({
      type: 'background_task_completed',
      task: makeBackgroundTask({
        id: 'agent_1',
        status: 'completed',
        unread: true,
        result: { taskId: 'agent_1', kind: 'agent', output: 'Done' },
      }),
    });
    mgr.onUserTurnAccepted();

    mgr.onBackgroundTaskEvent({ type: 'background_task_closed', taskId: 'agent_1' });

    expect(mgr.backgroundTasks).toEqual([]);
  });

  // ── Display order: Tool → Robota ──────────────────────────────

  it('streaming state is cleared on complete (tools moved to messages)', () => {
    const mgr = new TuiStateManager();
    mgr.onThinking(true);
    mgr.onTextDelta('streaming response');
    mgr.onToolStart({ toolName: 'Read', firstArg: 'f.ts', isRunning: true });
    mgr.onToolEnd({ toolName: 'Read', firstArg: 'f.ts', isRunning: false, result: 'success' });

    expect(mgr.streamingText).toBe('streaming response');
    expect(mgr.activeTools).toHaveLength(1);

    mgr.onComplete(makeResult());

    // After complete: streaming cleared, tools cleared
    expect(mgr.streamingText).toBe('');
    expect(mgr.activeTools).toEqual([]);
    // Tool info is now in InteractiveSession's messages (not managed here)
  });

  it('streaming state is cleared on abort (tools moved to messages)', () => {
    const mgr = new TuiStateManager();
    mgr.onThinking(true);
    mgr.onTextDelta('partial');
    mgr.onToolStart({ toolName: 'Bash', firstArg: 'ls', isRunning: true });

    mgr.onInterrupted();

    expect(mgr.streamingText).toBe('');
    expect(mgr.activeTools).toEqual([]);
  });

  // ── Full lifecycle: streaming → completion message order ──────

  it('during streaming: tools and text visible in StreamingIndicator state', () => {
    const mgr = new TuiStateManager();

    // Execution starts
    mgr.onThinking(true);

    // Tools arrive
    mgr.onToolStart({ toolName: 'Read', firstArg: 'file.ts', isRunning: true });
    mgr.onToolEnd({ toolName: 'Read', firstArg: 'file.ts', isRunning: false, result: 'success' });
    mgr.onToolStart({ toolName: 'Edit', firstArg: 'file.ts', isRunning: true });

    // Streaming text arrives
    mgr.onTextDelta('Here is the ');
    mgr.onTextDelta('result');

    // During streaming: both active
    expect(mgr.activeTools).toHaveLength(2);
    expect(mgr.streamingText).toBe('Here is the result');
    expect(mgr.isThinking).toBe(true);
  });

  it('after completion: streaming cleared, messages synced from session', () => {
    const mgr = new TuiStateManager();

    mgr.onThinking(true);
    mgr.onToolStart({ toolName: 'Read', firstArg: 'f.ts', isRunning: true });
    mgr.onToolEnd({ toolName: 'Read', firstArg: 'f.ts', isRunning: false, result: 'success' });
    mgr.onTextDelta('response text');

    // Complete event fires, then thinking ends
    mgr.onComplete(makeResult());
    mgr.onThinking(false);

    // StreamingIndicator state: cleared
    expect(mgr.streamingText).toBe('');
    expect(mgr.activeTools).toEqual([]);
    expect(mgr.isThinking).toBe(false);

    // Simulate InteractiveSession history entries being synced
    mgr.syncHistory([
      { id: '1', timestamp: new Date(), category: 'chat', type: 'user' } as never,
      { id: '2', timestamp: new Date(), category: 'event', type: 'tool-summary' } as never,
      { id: '3', timestamp: new Date(), category: 'chat', type: 'assistant' } as never,
    ]);

    // MessageList now has correct order: user → tool-summary → assistant
    expect(mgr.history).toHaveLength(3);
    expect(mgr.history[0]!.type).toBe('user');
    expect(mgr.history[1]!.type).toBe('tool-summary');
    expect(mgr.history[2]!.type).toBe('assistant');
  });

  it('after abort: streaming cleared, messages synced with tool → robota → system', () => {
    const mgr = new TuiStateManager();

    mgr.onThinking(true);
    mgr.onToolStart({ toolName: 'Bash', firstArg: 'ls', isRunning: true });
    mgr.onTextDelta('partial answer');

    mgr.onInterrupted();

    expect(mgr.streamingText).toBe('');
    expect(mgr.activeTools).toEqual([]);

    // Simulate InteractiveSession history entries synced after abort
    mgr.syncHistory([
      { id: '1', timestamp: new Date(), category: 'chat', type: 'user' } as never,
      { id: '2', timestamp: new Date(), category: 'event', type: 'tool-summary' } as never,
      { id: '3', timestamp: new Date(), category: 'chat', type: 'assistant' } as never,
      { id: '4', timestamp: new Date(), category: 'chat', type: 'system' } as never,
    ]);

    // Order: user → tool-summary → assistant → system
    expect(mgr.history).toHaveLength(4);
    expect(mgr.history[0]!.type).toBe('user');
    expect(mgr.history[1]!.type).toBe('tool-summary');
    expect(mgr.history[2]!.type).toBe('assistant');
    expect(mgr.history[3]!.type).toBe('system');
  });

  it('next execution clears previous tools from StreamingIndicator', () => {
    const mgr = new TuiStateManager();

    // First execution
    mgr.onThinking(true);
    mgr.onToolStart({ toolName: 'Read', firstArg: '', isRunning: true });
    mgr.onComplete(makeResult());
    expect(mgr.activeTools).toEqual([]);

    // Second execution starts
    mgr.onThinking(true);
    // Previous tools should not reappear
    expect(mgr.activeTools).toEqual([]);

    // New tools for second execution
    mgr.onToolStart({ toolName: 'Write', firstArg: 'new.ts', isRunning: true });
    expect(mgr.activeTools).toHaveLength(1);
    expect(mgr.activeTools[0]!.toolName).toBe('Write');
  });
});
