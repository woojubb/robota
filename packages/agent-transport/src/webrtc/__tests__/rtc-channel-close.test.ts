/**
 * Closing a channel right after a send must not lose that send. The implementation resets the
 * channel's stream as soon as it is told to close, and a message sent just before can then never
 * reach the peer; so the channel reads closed at once and its stream is reset only after a grace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RtcPeer } from '../rtc-peer.js';

import { fakeDataChannel } from './fake-datachannel.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RtcChannel close', () => {
  it('reads closed at once and resets the stream only after what was sent had time to leave', () => {
    const nativeClose = vi.fn();
    const fake = fakeDataChannel({ channel: { close: nativeClose } });
    const channel = new RtcPeer({ loadDataChannel: () => fake.module }).createDataChannel('x');
    const states: string[] = [];
    channel.onStateChange((state) => states.push(state));

    channel.send('the last word');
    channel.close();
    expect(channel.readyState).toBe('closed');
    expect(states).toEqual(['closed']);
    expect(nativeClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(nativeClose).toHaveBeenCalledTimes(1);
    channel.close();
    vi.advanceTimersByTime(1_000);
    expect(nativeClose).toHaveBeenCalledTimes(1);
  });

  it('hands out nothing that arrives after this side closed it', () => {
    const fake = fakeDataChannel();
    const channel = new RtcPeer({ loadDataChannel: () => fake.module }).createDataChannel('x');
    const received: string[] = [];
    channel.onMessage((text) => received.push(text));

    fake.connections[0]!.channelMessage!('before');
    channel.close();
    fake.connections[0]!.channelMessage!('after');
    expect(received).toEqual(['before']);
  });
});
