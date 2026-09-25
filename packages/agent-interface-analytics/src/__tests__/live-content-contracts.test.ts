import { describe, expectTypeOf, it } from 'vitest';

import type {
  ILivePromptContentBatch,
  ILivePromptContentToolRef,
  ILivePromptContentItem,
  ILivePromptContentPolicy,
  ILivePromptTraceBatch,
} from '../index.js';

/** Every property name reachable from `T`, through nested objects and arrays. */
type TDeepKeys<T> = T extends readonly (infer U)[]
  ? TDeepKeys<U>
  : T extends object
    ? { [K in keyof T]-?: K | TDeepKeys<T[K]> }[keyof T]
    : never;

describe('live content contracts', () => {
  it('keeps the live prompt trace batch free of any text-bearing field', () => {
    expectTypeOf<
      Extract<TDeepKeys<ILivePromptTraceBatch>, 'text' | 'body' | 'content' | 'items' | 'prompt' | 'response'>
    >().toEqualTypeOf<never>();
  });

  it('carries text only in the separate content batch, joined by the root identifiers', () => {
    expectTypeOf<ILivePromptContentItem['text']>().toEqualTypeOf<string>();
    expectTypeOf<ILivePromptContentItem['kind']>().toEqualTypeOf<
      'user-prompt' | 'assistant-response' | 'tool-arguments' | 'tool-output'
    >();
    expectTypeOf<ILivePromptContentBatch['root']>().toHaveProperty('traceId');
    expectTypeOf<ILivePromptContentBatch['root']>().toHaveProperty('spanId');
    expectTypeOf<ILivePromptContentPolicy>().toHaveProperty('maxBytes');
    // `partial` (interrupted) and `truncated` (size cut) are independent facts.
    expectTypeOf<ILivePromptContentItem['partial']>().toEqualTypeOf<true | undefined>();
    expectTypeOf<ILivePromptContentItem['truncated']>().toEqualTypeOf<boolean>();
  });

  it('adds tool content additively: optional gates, a per-item tool reference, per-kind omissions', () => {
    expectTypeOf<ILivePromptContentPolicy['toolArguments']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ILivePromptContentPolicy['toolOutput']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ILivePromptContentItem['tool']>().toEqualTypeOf<ILivePromptContentToolRef | undefined>();
    expectTypeOf<ILivePromptContentToolRef['outcome']>().toEqualTypeOf<'success' | 'failure' | 'denied'>();
    expectTypeOf<ILivePromptContentToolRef['spanId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<ILivePromptContentBatch['omitted']>['tool-output']>()
      .toEqualTypeOf<number | undefined>();
    // A PR1-shaped policy and batch stay valid.
    expectTypeOf<{ userPrompts: true; assistantResponses: false; maxBytes: 2048 }>()
      .toMatchTypeOf<ILivePromptContentPolicy>();
  });
});
