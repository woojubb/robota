import { describe, expect, it } from 'vitest';

import { CHAT_OPTION_WIRE_DISPOSITION, toWireChatOptions } from '../wire-chat-options';

/**
 * CORE-044 — the remote seam's `IChatOptions` audit.
 *
 * The client sent `{ messages, provider, model, tools }` and nothing else, so `toolChoice`,
 * `maxTokens`, `temperature`, `effort` and `responseFormat` were discarded between the agent and the
 * model. The mechanism was not the missing lines: it was that **nothing enumerated the contract**, so
 * each member had to be noticed by a reader.
 *
 * `CHAT_OPTION_WIRE_DISPOSITION` is keyed by `keyof Required<IChatOptions>`, which makes adding a
 * member without deciding its fate a COMPILE error. These cases assert the decisions are real —
 * that "local" ones name what happens instead, and that "wire" ones actually reach the body.
 */
describe('IChatOptions wire disposition (CORE-044)', () => {
  it('every option states where it goes, and a local-only one says what happens instead', () => {
    for (const [field, disposition] of Object.entries(CHAT_OPTION_WIRE_DISPOSITION)) {
      expect(disposition.note, `IChatOptions.${field} must explain its disposition`).toMatch(/\S/);
      expect(disposition.note, `IChatOptions.${field} must not be parked`).not.toMatch(
        /TODO|UNTHREADED|later/i,
      );
    }
  });

  it('the local callbacks, abort signal, adapter-bound resolution, trusted trace context and local model-fallback controls are the ONLY local members', () => {
    // If a serializable option ever appears here, it is being dropped on the wire again — which is
    // the defect, restated. A function or an AbortSignal genuinely cannot cross; the trace context
    // could, but it is trusted only for origins the local host listed, and a server was never one.
    // The run id and the context-window constraint steer a model-fallback choice made locally; the
    // server answers on the model it is sent, so there is nothing for them to steer there.
    const local = Object.entries(CHAT_OPTION_WIRE_DISPOSITION)
      .filter(([, d]) => d.kind === 'local')
      .map(([field]) => field)
      .sort();

    expect(local).toEqual([
      'effortResolution',
      'executionId',
      'onModelEffortOutcome',
      'onModelFallback',
      'onProviderNativeRawPayload',
      'onTextDelta',
      'outboundTraceContext',
      'preserveContextWindow',
      'signal',
    ]);
    expect(
      toWireChatOptions({
        outboundTraceContext: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          allowedOrigins: ['https://api.example.com'],
        },
      }),
    ).toBeUndefined();
  });

  it('projects the serializable options and drops the ones that cannot cross', () => {
    const controller = new AbortController();
    const wire = toWireChatOptions({
      model: 'gpt-4',
      maxTokens: 256,
      temperature: 0.4,
      effort: 'high',
      toolChoice: 'required',
      signal: controller.signal,
      onTextDelta: () => undefined,
    });

    expect(wire).toEqual({
      maxTokens: 256,
      temperature: 0.4,
      effort: 'high',
      toolChoice: 'required',
    });
    // `model` is carried by its own top-level field, so it must not be duplicated into `options`.
    expect(wire && 'model' in wire).toBe(false);
  });

  it('sends no options object at all when the caller set none', () => {
    // The distinction matters at the far end: an absent `options` and an empty one would otherwise
    // both have to be treated as "the caller asked for nothing".
    expect(toWireChatOptions(undefined)).toBeUndefined();
    expect(toWireChatOptions({ model: 'gpt-4' })).toBeUndefined();
  });
});
