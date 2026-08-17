/**
 * The `IChatOptions` → wire projection for the remote seam (CORE-044).
 *
 * The remote client used to send `{ messages, provider, model, tools }` and nothing else, so every
 * per-call option a caller set — `toolChoice`, `maxTokens`, `temperature`, `effort`,
 * `responseFormat` — was silently discarded between the agent and the model. Nothing failed; the
 * model simply behaved as though the caller had asked for nothing.
 *
 * Two things prevent that from recurring, and they are the reason this projection is its own module
 * rather than an inline object literal at the call site:
 *
 * 1. The options travel as ONE object under `options`, not as parallel top-level fields. Adding an
 *    option is then a change to this file, not a change to the client body, the server destructure
 *    and both of their tests.
 * 2. `CHAT_OPTION_WIRE_DISPOSITION` below is keyed by `keyof Required<IChatOptions>`, so adding a
 *    member to that interface without deciding what happens to it here is a COMPILE error. A
 *    dropped option has to be dropped on purpose, in writing.
 */

import type { IChatOptions } from '@robota-sdk/agent-core';

/** The `IChatOptions` members that survive serialization, as sent under the request's `options`. */
export type TWireChatOptions = Pick<
  IChatOptions,
  | 'maxTokens'
  | 'temperature'
  | 'effort'
  | 'toolChoice'
  | 'responseFormat'
  | 'nativeWebTools'
  | 'openai'
  | 'anthropic'
  | 'google'
>;

/**
 * Where each `IChatOptions` member goes on the remote seam.
 *
 * `wire` — serialized under `options`.
 * `top-level` — carried by its own field in the request body, because the server routes on it.
 * `local` — cannot cross a wire, and what the client does about it instead.
 */
export const CHAT_OPTION_WIRE_DISPOSITION: Record<
  keyof Required<IChatOptions>,
  { kind: 'wire' | 'top-level' | 'local'; note: string }
> = {
  maxTokens: { kind: 'wire', note: 'forwarded into provider.chat by the server handler' },
  temperature: { kind: 'wire', note: 'forwarded into provider.chat by the server handler' },
  effort: { kind: 'wire', note: 'forwarded into provider.chat by the server handler' },
  toolChoice: { kind: 'wire', note: 'CORE-017 forcing directive; forwarded by the server handler' },
  responseFormat: { kind: 'wire', note: 'CORE-015 structured output; forwarded by the server' },
  nativeWebTools: {
    kind: 'wire',
    note: 'provider-native hosted web tools; forwarded by the server',
  },
  openai: { kind: 'wire', note: 'provider-specific block; forwarded verbatim' },
  anthropic: { kind: 'wire', note: 'provider-specific block; forwarded verbatim' },
  google: { kind: 'wire', note: 'provider-specific block; forwarded verbatim' },
  model: { kind: 'top-level', note: 'the server selects the provider call with it' },
  tools: { kind: 'top-level', note: 'sent as its own field; the server forwards it into chat' },
  signal: {
    kind: 'local',
    note: 'an AbortSignal cannot be serialized; it is threaded into fetch so the HTTP request is what gets cancelled',
  },
  onTextDelta: {
    kind: 'local',
    note: 'a function cannot cross a wire; live deltas arrive instead as SSE `delta` frames from /api/v1/remote/chat/stream, which `executeChatStream` hands to this callback (CORE-046)',
  },
  onProviderNativeRawPayload: {
    kind: 'local',
    note: 'a function cannot cross a wire, and the payload it captures is the SERVER-side provider SDK object, which is not the caller`s to observe',
  },
};

/**
 * Project a caller's chat options onto the subset that can cross the wire.
 *
 * Absent members are omitted rather than sent as `undefined`, so the server can tell "the caller did
 * not ask" from "the caller asked for nothing" — the distinction `toolChoice` and `temperature` both
 * depend on.
 */
export function toWireChatOptions(options?: IChatOptions): TWireChatOptions | undefined {
  if (!options) return undefined;
  const wire: TWireChatOptions = {
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.effort !== undefined && { effort: options.effort }),
    ...(options.toolChoice !== undefined && { toolChoice: options.toolChoice }),
    ...(options.responseFormat !== undefined && { responseFormat: options.responseFormat }),
    ...(options.nativeWebTools !== undefined && { nativeWebTools: options.nativeWebTools }),
    ...(options.openai !== undefined && { openai: options.openai }),
    ...(options.anthropic !== undefined && { anthropic: options.anthropic }),
    ...(options.google !== undefined && { google: options.google }),
  };
  return Object.keys(wire).length > 0 ? wire : undefined;
}
