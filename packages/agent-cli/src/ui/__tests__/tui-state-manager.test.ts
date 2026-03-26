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
    messages: [],
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
    mgr.addMessage({ role: 'user', content: 'hello' } as never);
    mgr.addMessage({ role: 'assistant', content: 'world' } as never);
    expect(mgr.messages).toHaveLength(2);
  });

  it('addMessage windows to MAX_RENDERED_MESSAGES', () => {
    const mgr = new TuiStateManager();
    for (let i = 0; i < 110; i++) {
      mgr.addMessage({ role: 'user', content: `msg ${i}` } as never);
    }
    expect(mgr.messages).toHaveLength(100);
    expect(mgr.messages[0]!.content).toBe('msg 10');
  });

  it('syncMessages replaces all messages', () => {
    const mgr = new TuiStateManager();
    mgr.addMessage({ role: 'user', content: 'old' } as never);
    mgr.syncMessages([
      { role: 'user', content: 'new1' } as never,
      { role: 'assistant', content: 'new2' } as never,
    ]);
    expect(mgr.messages).toHaveLength(2);
    expect(mgr.messages[0]!.content).toBe('new1');
  });

  // ── onChange notification ──────────────────────────────────────

  it('calls onChange on every state change', () => {
    const mgr = new TuiStateManager();
    const onChange = vi.fn();
    mgr.onChange = onChange;

    mgr.onTextDelta('hi');
    mgr.onToolStart({ toolName: 'Read', firstArg: '', isRunning: true });
    mgr.onThinking(true);
    mgr.addMessage({ role: 'user', content: 'test' } as never);
    mgr.setAborting(true);
    mgr.setPendingPrompt('queued');
    mgr.setContextState({ percentage: 50, usedTokens: 5000, maxTokens: 10000 });

    expect(onChange).toHaveBeenCalledTimes(7);
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
});
