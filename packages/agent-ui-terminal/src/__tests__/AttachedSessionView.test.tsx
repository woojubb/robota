import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import AttachedSessionView, {
  type IAttachedSessionConnection,
} from '../AttachedSessionView.js';

import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';

function connection(): IAttachedSessionConnection & {
  sent: TClientMessage[];
  push: (message: TServerMessage) => void;
  close: () => void;
} {
  const listeners = new Set<(message: TServerMessage) => void>();
  const closers = new Set<() => void>();
  const sent: TClientMessage[] = [];
  return {
    sent,
    send: (message) => { sent.push(message); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: (listener) => {
      closers.add(listener);
      return () => closers.delete(listener);
    },
    push: (message) => { for (const listener of listeners) listener(message); },
    close: () => { for (const closer of closers) closer(); },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

async function type(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  for (const character of text) {
    stdin.write(character);
    await tick();
  }
}

describe('attached session view', () => {
  it('asks for a snapshot, renders it, then follows live events', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="Morning review" driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      expect(link.sent.map((message) => message.type)).toEqual([
        'get-messages', 'get-context', 'get-executing', 'get-pending',
      ]);
      link.push({
        type: 'messages',
        messages: [
          { role: 'user', content: 'earlier question' },
          { role: 'assistant', content: 'earlier answer' },
        ] as never,
      });
      await tick();
      expect(view.lastFrame()).toContain('earlier question');
      expect(view.lastFrame()).toContain('earlier answer');
      expect(view.lastFrame()).toContain('Morning review');
      link.push({ type: 'user_message', content: 'from another terminal', driverId: 'attach:2' });
      link.push({ type: 'text_delta', delta: 'streamed ' });
      link.push({ type: 'text_delta', delta: 'reply' });
      await tick();
      expect(view.lastFrame()).toContain('from another terminal');
      expect(view.lastFrame()).toContain('attach:2');
      expect(view.lastFrame()).toContain('streamed reply');
      link.push({ type: 'complete', result: { response: 'streamed reply' } as never });
      link.push({ type: 'tool_start', state: { toolName: 'Bash', firstArg: 'ls', isRunning: true } });
      await tick();
      expect(view.lastFrame()).toContain('Bash');
    } finally {
      view.unmount();
    }
  });

  it('answers a permission prompt from a drive terminal and dismisses it when resolved elsewhere', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      link.push({ type: 'permission_request', event: { id: 'p1', toolName: 'Bash', toolArgs: { command: 'rm x' } } });
      await tick();
      expect(view.lastFrame()).toContain('Allow Bash');
      view.stdin.write('y');
      await tick();
      expect(link.sent).toContainEqual({ type: 'permission-response', id: 'p1', result: true });

      link.push({ type: 'permission_request', event: { id: 'p2', toolName: 'Write', toolArgs: {} } });
      await tick();
      expect(view.lastFrame()).toContain('Allow Write');
      link.push({ type: 'prompt_resolved', event: { id: 'p2', answererDriverId: 'owner' } });
      await tick();
      expect(view.lastFrame()).not.toContain('Allow Write');
      view.stdin.write('y');
      await tick();
      expect(link.sent.filter((message) => message.type === 'permission-response')).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  it('answers a question with a numbered option', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      link.push({
        type: 'ask_request',
        event: {
          id: 'a1',
          request: { id: 'r', title: 'Pick a framework', options: [
            { value: 'react', label: 'React' }, { value: 'vue', label: 'Vue' },
          ] },
        },
      });
      await tick();
      expect(view.lastFrame()).toContain('Pick a framework');
      await type(view.stdin, '2');
      view.stdin.write('\r');
      await tick();
      expect(link.sent).toContainEqual({ type: 'ask-response', id: 'a1', response: { type: 'answer', values: ['vue'] } });
    } finally {
      view.unmount();
    }
  });

  it('submits prompts and commands, and treats /exit as detach without sending it', async () => {
    const link = connection();
    const onDetach = vi.fn();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={onDetach} />,
    );
    try {
      await tick();
      await type(view.stdin, 'hello');
      view.stdin.write('\r');
      await tick();
      expect(link.sent).toContainEqual({ type: 'submit', prompt: 'hello' });
      await type(view.stdin, '/model list');
      view.stdin.write('\r');
      await tick();
      expect(link.sent).toContainEqual({ type: 'command', name: 'model', args: 'list' });
      for (const command of ['/exit', '/quit']) {
        await type(view.stdin, command);
        view.stdin.write('\r');
        await tick();
      }
      expect(onDetach).toHaveBeenCalledWith('user');
      expect(link.sent.some((message) => message.type === 'command' && ['exit', 'quit'].includes(message.name))).toBe(false);
      expect(link.sent.some((message) => message.type === 'abort')).toBe(false);
    } finally {
      view.unmount();
    }
  });

  it('detaches on Ctrl-C and Ctrl-] without aborting the session', async () => {
    for (const key of ['\x03', '\x1d']) {
      const link = connection();
      const onDetach = vi.fn();
      const view = render(
        <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={onDetach} />,
      );
      try {
        await tick();
        link.push({ type: 'thinking', isThinking: true });
        await tick();
        view.stdin.write(key);
        await tick();
        expect(onDetach).toHaveBeenCalledExactlyOnceWith('user');
        expect(link.sent.some((message) => message.type === 'abort')).toBe(false);
      } finally {
        view.unmount();
      }
    }
  });

  it('labels observe mode read-only and sends nothing but snapshot reads', async () => {
    const link = connection();
    const onDetach = vi.fn();
    const view = render(
      <AttachedSessionView connection={link} mode="observe" sessionLabel="s" driverId="attach:1" onDetach={onDetach} />,
    );
    try {
      await tick();
      expect(view.lastFrame()).toMatch(/read only/i);
      await type(view.stdin, 'hello');
      view.stdin.write('\r');
      await tick();
      expect(link.sent.every((message) => message.type.startsWith('get-'))).toBe(true);
      link.push({ type: 'prompt_resolved', event: { id: 'p1', answererDriverId: 'owner' } });
      await tick();
      view.stdin.write('q');
      await tick();
      expect(onDetach).toHaveBeenCalledExactlyOnceWith('user');
    } finally {
      view.unmount();
    }
  });

  it('reports a closed connection instead of pretending to be attached', async () => {
    const link = connection();
    const onDetach = vi.fn();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={onDetach} />,
    );
    try {
      await tick();
      link.close();
      await tick();
      expect(onDetach).toHaveBeenCalledExactlyOnceWith('closed');
    } finally {
      view.unmount();
    }
  });

  it('never lets session text move the cursor or repaint the terminal', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="observe" sessionLabel={'evil\x1b[2Jname'} driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      link.push({ type: 'user_message', content: 'hi\x1b[1Ahidden', driverId: 'attach:2' });
      await tick();
      expect(view.lastFrame()).not.toContain('\x1b[2J');
      expect(view.lastFrame()).not.toContain('\x1b[1A');
    } finally {
      view.unmount();
    }
  });
});
