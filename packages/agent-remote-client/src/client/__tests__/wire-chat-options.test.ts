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

  it('the three unserializable members are the ONLY ones marked local', () => {
    // If a serializable option ever appears here, it is being dropped on the wire again — which is
    // the defect, restated. A function or an AbortSignal genuinely cannot cross; nothing else.
    const local = Object.entries(CHAT_OPTION_WIRE_DISPOSITION)
      .filter(([, d]) => d.kind === 'local')
      .map(([field]) => field)
      .sort();

    expect(local).toEqual(['onProviderNativeRawPayload', 'onTextDelta', 'signal']);
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
