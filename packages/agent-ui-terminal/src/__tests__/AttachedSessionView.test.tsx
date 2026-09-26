import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import { ScreenReaderProvider } from '../screen-reader-context.js';
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

  it('drops a half-typed secret when its question is settled elsewhere, and keeps it masked while others wait', async () => {
    for (const next of [
      { type: 'prompt_resolved', event: { id: 'a1', answererDriverId: 'owner' } },
      { type: 'permission_request', event: { id: 'p9', toolName: 'Bash', toolArgs: {} } },
    ] as const) {
      const link = connection();
      const view = render(
        <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
      );
      try {
        await tick();
        link.push({
          type: 'ask_request',
          event: { id: 'a1', request: { id: 'r', title: 'API key', allowFreeText: true, masked: true } },
        });
        await tick();
        await type(view.stdin, 'sk-secret');
        expect(view.lastFrame()).not.toContain('sk-secret');
        link.push(next);
        await tick();
        expect(view.lastFrame()).not.toContain('sk-secret');
        view.stdin.write('\r');
        await tick();
        // Never an ordinary prompt; a waiting question does not take over the one being answered.
        expect(JSON.stringify(link.sent.filter((message) => message.type === 'submit'))).not.toContain('sk-secret');
        if (next.type === 'prompt_resolved') expect(JSON.stringify(link.sent)).not.toContain('sk-secret');
        else expect(link.sent).toContainEqual({ type: 'ask-response', id: 'a1', response: { type: 'answer', values: [], text: 'sk-secret' } });
      } finally {
        view.unmount();
      }
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
      for (const command of ['/exit', '/quit', '/exit now', '/quit --force']) {
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
  it('shows the keys for what is on screen: sending, answering a permission, answering a question', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      expect(view.lastFrame()).toContain('Enter send');
      link.push({ type: 'permission_request', event: { id: 'p1', toolName: 'Bash', toolArgs: {} } });
      await tick();
      expect(view.lastFrame()).toContain('y allow · n deny · a allow for this session');
      view.stdin.write('n');
      await tick();
      link.push({ type: 'ask_request', event: { id: 'a1', request: { id: 'r', title: 'Pick', options: [{ value: 'x', label: 'X' }] } } });
      await tick();
      expect(view.lastFrame()).toContain('number or text, Enter answers · Esc cancels');
    } finally {
      view.unmount();
    }
  });

  it('keeps later questions waiting until the one on screen is settled', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      link.push({ type: 'permission_request', event: { id: 'p1', toolName: 'Bash', toolArgs: {} } });
      link.push({ type: 'permission_request', event: { id: 'p2', toolName: 'Write', toolArgs: {} } });
      link.push({ type: 'permission_request', event: { id: 'p3', toolName: 'Edit', toolArgs: {} } });
      await tick();
      expect(view.lastFrame()).toContain('Allow Bash');
      expect(view.lastFrame()).toMatch(/2 more questions? waiting/);
      link.push({ type: 'prompt_resolved', event: { id: 'p2', answererDriverId: 'owner' } });
      await tick();
      view.stdin.write('y');
      await tick();
      expect(view.lastFrame()).toContain('Allow Edit');
      view.stdin.write('n');
      await tick();
      expect(link.sent.filter((message) => message.type === 'permission-response')).toEqual([
        { type: 'permission-response', id: 'p1', result: true },
        { type: 'permission-response', id: 'p3', result: false },
      ]);
    } finally {
      view.unmount();
    }
  });

  it('keeps a pasted secret exactly as copied, without the trailing line break', async () => {
    for (const pasted of ['sk-secret\n', 'sk-secret\r\n', 'sk-\rsecret\r']) {
      const link = connection();
      const view = render(
        <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
      );
      try {
        await tick();
        link.push({
          type: 'ask_request',
          event: { id: 'a1', request: { id: 'r', title: 'API key', allowFreeText: true, masked: true } },
        });
        await tick();
        view.stdin.write(pasted);
        await tick();
        view.stdin.write('\r');
        await tick();
        expect(link.sent).toContainEqual({
          type: 'ask-response', id: 'a1', response: { type: 'answer', values: [], text: 'sk-secret' },
        });
      } finally {
        view.unmount();
      }
    }
  });

  it('treats line breaks in pasted text as spaces instead of sending', async () => {
    const link = connection();
    const view = render(
      <AttachedSessionView connection={link} mode="drive" sessionLabel="s" driverId="attach:1" onDetach={vi.fn()} />,
    );
    try {
      await tick();
      view.stdin.write('first line\rsecond line\nthird');
      await tick();
      expect(link.sent.some((message) => message.type === 'submit')).toBe(false);
      expect(view.lastFrame()).toContain('first line second line third');
      view.stdin.write('\r');
      await tick();
      expect(link.sent).toContainEqual({ type: 'submit', prompt: 'first line second line third' });
    } finally {
      view.unmount();
    }
  });

  it('labels everything in words for a screen reader', async () => {
    const link = connection();
    const view = render(
      <ScreenReaderProvider enabled>
        <AttachedSessionView connection={link} mode="drive" sessionLabel="Morning" driverId="attach:1" onDetach={vi.fn()} />
      </ScreenReaderProvider>,
    );
    try {
      await tick();
      expect(view.lastFrame()).toContain('Attached to Morning. Drive mode: you can send prompts and answer its questions.');
      link.push({ type: 'user_message', content: 'hi', driverId: 'attach:2' });
      link.push({ type: 'tool_start', state: { toolName: 'Bash', firstArg: 'ls', isRunning: true } });
      link.push({ type: 'complete', result: { response: 'done' } as never });
      link.push({ type: 'permission_request', event: { id: 'p1', toolName: 'Bash', toolArgs: {} } });
      await tick();
      const frame = view.lastFrame() ?? '';
      expect(frame).toContain('Prompt from attach:2: hi');
      expect(frame).toContain('Tool started: Bash ls');
      expect(frame).toContain('Reply: done');
      expect(frame).toContain('Permission needed: allow Bash? Type y to allow, n to deny, a to allow for this session.');
      expect(frame).not.toMatch(/[›⏺]/u);
    } finally {
      view.unmount();
    }
  });
});
