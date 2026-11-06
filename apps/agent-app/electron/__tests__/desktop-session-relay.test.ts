import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { openDesktopSessionRelay } from '../desktop-session-relay.js';

class FakePort extends EventEmitter {
  sent: unknown[] = [];
  start = vi.fn();
  close = vi.fn();
  postMessage(value: unknown): void {
    this.sent.push(value);
  }
  receive(value: unknown, ports: unknown[] = []): void {
    this.emit('message', { data: value, ports });
  }
}

function setup() {
  const mainFrame = { postMessage: vi.fn() };
  const sender = Object.assign(new EventEmitter(), {
    mainFrame,
    isDestroyed: () => false,
    postMessage: vi.fn(),
  });
  const port = new FakePort();
  const transferred = new FakePort();
  const send = vi.fn();
  let deliver = (_message: unknown): void => {};
  const session = {
    send,
    onMessage: (listener: (message: unknown) => void) => {
      deliver = listener;
      return vi.fn();
    },
  };
  const controller = new AbortController();
  let current = true;
  const options = {
    sender,
    source: { sender, senderFrame: mainFrame },
    session,
    signal: controller.signal,
    isCurrent: () => current,
    createChannel: () => ({ port1: port, port2: transferred }),
  } as unknown as Parameters<typeof openDesktopSessionRelay>[0];
  return {
    sender,
    mainFrame,
    port,
    transferred,
    send,
    options,
    controller,
    deliver: (value: unknown) => deliver(value),
    stale: () => {
      current = false;
    },
  };
}

describe('desktop session relay', () => {
  it('forwards validated messages in both directions and revokes late messages', () => {
    const s = setup();
    const relay = openDesktopSessionRelay(s.options);
    expect(s.mainFrame.postMessage).toHaveBeenCalledOnce();
    s.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"get-messages"}' });
    expect(s.send).toHaveBeenCalledWith({ type: 'get-messages' });
    expect(s.port.sent).toContainEqual({ kind: 'ack', seq: 1 });
    s.deliver({ type: 'error', message: 'synthetic' });
    expect(s.port.sent).toContainEqual({
      kind: 'frame',
      seq: 1,
      frame: '{"type":"error","message":"synthetic"}',
    });
    relay.dispose();
    s.port.receive({ kind: 'frame', seq: 2, frame: '{"type":"get-messages"}' });
    s.deliver({ type: 'error', message: 'late' });
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.port.close).toHaveBeenCalledOnce();
  });

  it('refuses a foreign frame, duplicate relay, and unexpected transferred capabilities', () => {
    const s = setup();
    expect(() =>
      openDesktopSessionRelay({
        ...s.options,
        source: { ...s.options.source, sender: {} as typeof s.options.source.sender },
      }),
    ).toThrow();
    expect(() =>
      openDesktopSessionRelay({
        ...s.options,
        source: { ...s.options.source, senderFrame: {} as typeof s.options.source.senderFrame },
      }),
    ).toThrow();
    const relay = openDesktopSessionRelay(s.options);
    expect(() => openDesktopSessionRelay(s.options)).toThrow();
    s.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"get-messages"}' }, [{}]);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.port.close).toHaveBeenCalledOnce();
    relay.dispose();
  });

  it('bounds unacknowledged output and closes on forged acknowledgements', () => {
    const s = setup();
    openDesktopSessionRelay(s.options);
    for (let index = 0; index < 32; index++) s.deliver({ type: 'error', message: `${index}` });
    expect(s.port.sent).toHaveLength(32);
    s.deliver({ type: 'error', message: 'overflow' });
    expect(s.port.close).toHaveBeenCalledOnce();
    const s2 = setup();
    openDesktopSessionRelay(s2.options);
    s2.port.receive({ kind: 'ack', seq: 4 });
    expect(s2.port.close).toHaveBeenCalledOnce();
  });

  it('accepts more output after the renderer acknowledges a frame', () => {
    const s = setup();
    openDesktopSessionRelay(s.options);
    for (let index = 0; index < 32; index++) s.deliver({ type: 'error', message: `${index}` });
    s.port.receive({ kind: 'ack', seq: 1 });
    s.deliver({ type: 'error', message: 'next' });
    expect(s.port.sent).toHaveLength(33);
    expect(s.port.close).not.toHaveBeenCalled();
  });

  it('closes when UTF-8 bytes exceed the frame bound', () => {
    const s = setup();
    openDesktopSessionRelay(s.options);
    s.port.receive({
      kind: 'frame',
      seq: 1,
      frame: JSON.stringify({ type: 'submit', prompt: '€'.repeat(1400000) }),
    });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.port.close).toHaveBeenCalledOnce();
  });

  it('refuses owner operations and out-of-date runtime generations', () => {
    const s = setup();
    openDesktopSessionRelay(s.options);
    s.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"unlock"}' });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.port.close).toHaveBeenCalledOnce();
    const s2 = setup();
    openDesktopSessionRelay(s2.options);
    s2.stale();
    s2.deliver({ type: 'error', message: 'late' });
    expect(s2.port.sent).toHaveLength(0);
    expect(s2.port.close).toHaveBeenCalledOnce();
  });

  it('revokes immediately when the owner aborts the admission', () => {
    const s = setup();
    openDesktopSessionRelay(s.options);
    s.controller.abort();
    expect(s.port.close).toHaveBeenCalledOnce();
    s.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"get-messages"}' });
    expect(s.send).not.toHaveBeenCalled();
  });

  it('closes the port even when the session unsubscribe fails', () => {
    const s = setup();
    const session = {
      ...s.options.session,
      onMessage: () => () => { throw new Error('synthetic unsubscribe failure'); },
    };
    openDesktopSessionRelay({ ...s.options, session });
    expect(() => s.controller.abort()).not.toThrow();
    expect(s.port.close).toHaveBeenCalledOnce();
  });

  it('revokes on navigation and refuses malformed and replayed frames', () => {
    const s = setup();
    openDesktopSessionRelay(s.options);
    s.sender.emit('did-start-navigation', { isMainFrame: false });
    expect(s.port.close).not.toHaveBeenCalled();
    s.sender.emit('did-start-navigation', { isMainFrame: true });
    s.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"get-messages"}' });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.port.close).toHaveBeenCalledOnce();
    const s2 = setup();
    openDesktopSessionRelay(s2.options);
    s2.port.receive({ kind: 'frame', seq: 1, frame: '{' });
    expect(s2.port.close).toHaveBeenCalledOnce();
    const s3 = setup();
    openDesktopSessionRelay(s3.options);
    s3.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"get-messages"}' });
    s3.port.receive({ kind: 'frame', seq: 1, frame: '{"type":"get-messages"}' });
    expect(s3.send).toHaveBeenCalledOnce();
    expect(s3.port.close).toHaveBeenCalledOnce();
  });
});
