import { describe, expect, it } from 'vitest';
import { observeProviderNativeRawPayloadStream } from './native-payload-observer';
import type { IProviderNativeRawPayloadEvent } from '@robota-sdk/agent-core';

async function* asyncIterableFrom<T extends object>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe('observeProviderNativeRawPayloadStream', () => {
  it('emits ordered stream_event payloads and yields original chunks unchanged', async () => {
    const chunks = [{ id: 'chunk-1' }, { id: 'chunk-2' }];
    const events: IProviderNativeRawPayloadEvent[] = [];
    const yielded: object[] = [];

    for await (const chunk of observeProviderNativeRawPayloadStream(asyncIterableFrom(chunks), {
      provider: 'provider',
      apiSurface: 'chat-completions',
      onProviderNativeRawPayload: (event) => events.push(event),
    })) {
      yielded.push(chunk);
    }

    expect(yielded).toEqual(chunks);
    expect(events).toEqual([
      expect.objectContaining({
        provider: 'provider',
        apiSurface: 'chat-completions',
        payloadKind: 'stream_event',
        sequence: 0,
        payload: chunks[0],
      }),
      expect.objectContaining({
        provider: 'provider',
        apiSurface: 'chat-completions',
        payloadKind: 'stream_event',
        sequence: 1,
        payload: chunks[1],
      }),
    ]);
  });
});
