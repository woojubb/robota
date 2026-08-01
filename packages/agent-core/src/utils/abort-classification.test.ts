import { describe, expect, it } from 'vitest';

import { isAbortFailure } from './abort-classification';

/**
 * CORE-027. The classification that stood at three call sites was
 *
 *   error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('abort')
 *
 * and `execution-service.ts` returned `success: true, interrupted: true` when it said yes. The
 * cases below that must answer FALSE are all real provider-failure wordings; each one of them was
 * previously reported to the caller as a successfully interrupted run.
 */
describe('isAbortFailure (CORE-027)', () => {
  describe('a real failure is not an abort because its prose contains the word', () => {
    for (const message of [
      'the upstream aborted the stream after a policy check',
      'AbortController is not supported by this runtime',
      'HTTP 502: <html>request aborted by proxy</html>',
      'model refused: the user asked how to abort a deployment',
    ]) {
      it(JSON.stringify(message), () => {
        expect(isAbortFailure(new Error(message))).toBe(false);
      });
    }
  });

  it('an aborted SIGNAL is an abort, whatever the error says', () => {
    const controller = new AbortController();
    controller.abort();
    // The error text deliberately says nothing about aborting — the signal is the fact.
    expect(isAbortFailure(new Error('socket hang up'), controller.signal)).toBe(true);
  });

  it('a signal that is NOT aborted does not make a failure one', () => {
    const controller = new AbortController();
    expect(isAbortFailure(new Error('request aborted'), controller.signal)).toBe(false);
  });

  it("the platform's own abort error is an abort, by NAME not by message", () => {
    const error = new Error('The operation was cancelled.');
    error.name = 'AbortError';
    expect(isAbortFailure(error)).toBe(true);
  });

  it('what AbortSignal.throwIfAborted() raises is recognised', () => {
    const controller = new AbortController();
    controller.abort();
    let raised: unknown;
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      raised = error;
    }
    // Recognised on the error alone, with no signal handed in.
    expect(isAbortFailure(raised)).toBe(true);
  });

  it('a wrapped abort is recognised through one level of cause', () => {
    const inner = new Error('aborted');
    inner.name = 'AbortError';
    expect(isAbortFailure(new Error('provider call failed', { cause: inner }))).toBe(true);
  });

  it('a non-error rejection is not an abort', () => {
    expect(isAbortFailure('abort')).toBe(false);
    expect(isAbortFailure(undefined)).toBe(false);
    expect(isAbortFailure(null)).toBe(false);
    // A bare tag is not an error: an error carries a message.
    expect(isAbortFailure({ name: 'AbortError' })).toBe(false);
  });

  /**
   * The classification does not depend on `instanceof Error`, for two independent reasons — only one
   * of which was raised in review of #1593.
   *
   * The review's claim was that `DOMException` does not extend `Error`. Measured on this runtime, it
   * does (`new DOMException('x','AbortError') instanceof Error === true`, Node 22.14, and WebIDL has
   * put `Error.prototype` in its chain since 2021), so the claim does not hold here — the
   * `DOMException` case below passed before this change and still passes.
   *
   * It is fixed anyway, because `agent-core` ships a browser build and because `instanceof` also
   * fails CROSS-REALM: an abort thrown in a worker or a `vm` context is an ordinary error that this
   * realm's `Error` does not recognise. That case is the one no `instanceof` spelling can cover, and
   * it is asserted below.
   */
  describe('recognises an abort that instanceof cannot reach', () => {
    it('a DOMException abort', () => {
      expect(isAbortFailure(new DOMException('The operation was aborted.', 'AbortError'))).toBe(
        true,
      );
    });

    it('a CROSS-REALM error, which fails instanceof against this realm', async () => {
      const vm = await import('node:vm');
      const foreign: unknown = vm.runInNewContext(
        "(() => { const e = new Error('aborted'); e.name = 'AbortError'; return e; })()",
      );
      // The premise of the test: this really is unreachable by instanceof here.
      expect(foreign instanceof Error).toBe(false);
      expect(isAbortFailure(foreign)).toBe(true);
    });
  });
});
