import { expect, it, vi } from 'vitest';
import { callProviderWithIdleTimeout } from './execution-provider-call.js';
import type { TUniversalMessage } from '../interfaces/messages.js';

it.each(['resolve', 'reject'] as const)('joins opted-in provider cleanup after abort and preserves cancellation on late %s', async (outcome) => {
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<TUniversalMessage>((resolve, reject) => {
    release = () => outcome === 'reject'
      ? reject(new Error('late provider error'))
      : resolve({ id: 'late', role: 'assistant', content: 'late', state: 'complete', timestamp: new Date() });
  });
  let completed = false;
  const work = callProviderWithIdleTimeout(async () => held, [], { signal: controller.signal }, undefined, true)
    .catch((error: unknown) => error)
    .finally(() => { completed = true; });
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(completed).toBe(false);
  release();
  expect(await work).toMatchObject({ name: 'AbortError' });
});

it('preserves prompt cancellation by default when the provider ignores abort', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const provider = new Promise<TUniversalMessage>((_resolve, reject) => { release = () => reject(new Error('late')); });
  const work = callProviderWithIdleTimeout(async () => provider, [], { signal: controller.signal }, undefined);
  controller.abort();
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  release();
});

it('does not lose a synchronous provider-triggered cancellation', async () => {
  const controller = new AbortController();
  const chat = vi.fn(async (): Promise<TUniversalMessage> => {
    controller.abort();
    return { id: 'late', role: 'assistant', content: 'late', state: 'complete', timestamp: new Date() };
  });
  await expect(callProviderWithIdleTimeout(chat, [], { signal: controller.signal }, undefined, true))
    .rejects.toMatchObject({ name: 'AbortError' });
});

it('joins provider settlement after an idle timeout without replacing that error', async () => {
  let release!: () => void;
  let observeAbort!: () => void;
  const aborted = new Promise<void>((resolve) => { observeAbort = resolve; });
  const held = new Promise<TUniversalMessage>((_resolve, reject) => { release = () => reject(new Error('late')); });
  let completed = false;
  const work = callProviderWithIdleTimeout(async (_messages, options) => {
    options.signal?.addEventListener('abort', observeAbort, { once: true });
    return held;
  }, [], {}, 10, true).catch((error: unknown) => error).finally(() => { completed = true; });
  await aborted;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(completed).toBe(false);
  release();
  expect(await work).toMatchObject({ message: 'Provider call idle timeout after 10ms' });
});
