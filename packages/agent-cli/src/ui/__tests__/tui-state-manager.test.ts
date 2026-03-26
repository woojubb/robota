/**
 * Unit tests for TuiStateManager — pure TypeScript, no React.
 * Tests event → state transitions that must survive any refactoring.
 */

import { describe, it, expect, vi } from 'vitest';
import { TuiStateManager } from '../tui-state-manager.js';
import type { IToolState, IExecutionResult } from '@robota-sdk/agent-sdk';

function makeResult(overrides?: Partial<IExecutionResult>): IExecutionResult {
  return {
    response: 'test response',
    history: [],
    toolSummaries: [],
    contextState: { usedPercentage: 10, usedTokens: 1000, maxTokens: 200000 },
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
      makeResult({ contextState: { usedPercentage: 50, usedTokens: 5000, maxTokens: 10000 } }),
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
    expect(mgr.history[0]!.content).toBe('new1');
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

    await new Promise((r) => setTimeout(r, 150));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not crash when onChange is null', () => {
    const mgr = new TuiStateManager();
    expect(() => mgr.onTextDelta('hi')).not.toThrow();
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
