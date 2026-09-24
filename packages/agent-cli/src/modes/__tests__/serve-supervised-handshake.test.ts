import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  acknowledgeSupervisedStartup,
  type ISupervisedReadinessChannel,
} from '../serve-mode.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

function channel(): {
  readonly events: EventEmitter;
  readonly sent: { kind: string; id: string }[];
  readonly port: ISupervisedReadinessChannel;
} {
  const events = new EventEmitter();
  const sent: { kind: string; id: string }[] = [];
  return {
    events,
    sent,
    port: {
      send: (message, done) => { sent.push(message); done(null); },
      onMessage: (listener) => { events.on('message', listener); },
      offMessage: (listener) => { events.off('message', listener); },
      onDisconnect: (listener) => { events.on('disconnect', listener); },
      offDisconnect: (listener) => { events.off('disconnect', listener); },
    },
  };
}

describe('supervised serve readiness', () => {
  it('does not acknowledge launch after runtime shutdown has begun', async () => {
    const parent = channel();
    const abort = new AbortController();
    const result = acknowledgeSupervisedStartup(ID, abort.signal, parent.port);
    expect(parent.sent).toEqual([{ kind: 'ready', id: ID }]);
    abort.abort();
    parent.events.emit('message', { kind: 'ack', id: ID });
    await expect(result).rejects.toThrow(/stopped during readiness/i);
    expect(parent.sent).toEqual([{ kind: 'ready', id: ID }]);
  });

  it('acknowledges a live runtime exactly once', async () => {
    const parent = channel();
    const result = acknowledgeSupervisedStartup(ID, new AbortController().signal, parent.port);
    parent.events.emit('message', { kind: 'ack', id: ID });
    await expect(result).resolves.toBeUndefined();
    expect(parent.sent).toEqual([
      { kind: 'ready', id: ID },
      { kind: 'acknowledged', id: ID },
    ]);
  });
});
