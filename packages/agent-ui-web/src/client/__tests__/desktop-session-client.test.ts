import { describe, expect, it, vi } from 'vitest';

import { createDesktopSessionClient } from '../desktop-session-client.js';

describe('desktop session client', () => {
  function setup() {
    const sent: string[] = [];
    let receive = (_frame: string): void => {};
    let closed = (): void => {};
    const bridge = {
      listen(onFrame: (frame: string) => void, onClose: () => void, onReady: () => void) {
        receive = onFrame;
        closed = onClose;
        onReady();
        return () => {};
      },
      send(frame: string) {
        sent.push(frame);
        return true;
      },
      close: vi.fn(),
    };
    const onMessage = vi.fn();
    const onStatusChange = vi.fn();
    const client = createDesktopSessionClient(bridge, { onMessage, onStatusChange });
    return {
      client,
      sent,
      onMessage,
      onStatusChange,
      bridge,
      receive: (frame: string) => receive(frame),
      closed: () => closed(),
    };
  }

  it('requests history on connection, validates the reply, and closes on disconnect', () => {
    const s = setup();
    s.client.connect();
    expect(s.sent).toEqual([JSON.stringify({ type: 'get-messages' })]);
    s.receive(JSON.stringify({ type: 'error', message: 'synthetic error' }));
    expect(s.onMessage).toHaveBeenCalledWith({ type: 'error', message: 'synthetic error' });
    s.client.disconnect();
    expect(s.bridge.close).toHaveBeenCalledOnce();
    s.receive(JSON.stringify({ type: 'error', message: 'late' }));
    expect(s.onMessage).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the bridge is revoked or sends an owner operation', () => {
    const s = setup();
    s.client.connect();
    s.receive(JSON.stringify({ type: 'unlock', secret: 'synthetic' }));
    expect(s.bridge.close).toHaveBeenCalledOnce();
    expect(s.onStatusChange).toHaveBeenLastCalledWith('error');
    s.client.send({ type: 'get-messages' });
    expect(s.sent).toHaveLength(1);
  });

  it('does not deliver messages after the main side revokes the channel', () => {
    const s = setup();
    s.client.connect();
    s.closed();
    expect(s.onStatusChange).toHaveBeenLastCalledWith('disconnected');
    s.receive(JSON.stringify({ type: 'error', message: 'late' }));
    expect(s.onMessage).not.toHaveBeenCalled();
  });

  it('waits for the port before requesting session history', () => {
    const sent: string[] = [];
    let ready = (): void => {};
    const client = createDesktopSessionClient(
      {
        listen: (_onFrame, _onClose, onReady) => {
          ready = onReady;
          return () => {};
        },
        send: (frame) => {
          sent.push(frame);
          return true;
        },
        close: () => {},
      },
      { onMessage: vi.fn(), onStatusChange: vi.fn() },
    );
    client.connect();
    expect(sent).toHaveLength(0);
    ready();
    expect(sent).toEqual(['{"type":"get-messages"}']);
    client.disconnect();
  });
});
