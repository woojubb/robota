import type { TProviderNativeRawPayloadCallback } from '@robota-sdk/agent-core';

export interface IObserveProviderNativeRawPayloadStreamOptions {
  provider: string;
  apiSurface?: string;
  onProviderNativeRawPayload?: TProviderNativeRawPayloadCallback;
  initialSequence?: number;
}

export async function* observeProviderNativeRawPayloadStream<TPayload extends object>(
  stream: AsyncIterable<TPayload>,
  options: IObserveProviderNativeRawPayloadStreamOptions,
): AsyncIterable<TPayload> {
  let sequence = options.initialSequence ?? 0;
  for await (const payload of stream) {
    options.onProviderNativeRawPayload?.({
      provider: options.provider,
      ...(options.apiSurface !== undefined && { apiSurface: options.apiSurface }),
      payloadKind: 'stream_event',
      sequence,
      payload,
    });
    sequence++;
    yield payload;
  }
}
