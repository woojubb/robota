import { describe, expect, it } from 'vitest';

import { isAbortError } from '../interactive-session-execution.js';

/**
 * CORE-027, the interactive path.
 *
 * This was the THIRD copy of the substring heuristic and the one users actually meet:
 * `interactive-session-prompt.ts:121` calls it and, when it says yes, builds an INTERRUPTED result —
 * so a real provider failure whose message happened to contain "abort" was presented to the user as
 * their own cancellation, with the failure discarded.
 *
 * Fixing only `agent-core` would have left this alive. The Task said so; the first attempt at the
 * fix shipped without it anyway, which is why the assertions here are about this specific export
 * rather than about the shared helper it now delegates to.
 */
describe('isAbortError on the interactive path (CORE-027)', () => {
  describe('a real failure is not the user cancelling', () => {
    for (const message of [
      'the upstream aborted the stream after a policy check',
      'AbortController is not supported by this runtime',
      'HTTP 502: <html>request aborted by proxy</html>',
    ]) {
      it(JSON.stringify(message), () => {
        expect(isAbortError(new Error(message))).toBe(false);
      });
    }
  });

  it('still recognises a real abort — the DOMException the old code tested for', () => {
    expect(isAbortError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
  });

  it('recognises what AbortSignal.throwIfAborted() raises', () => {
    const controller = new AbortController();
    controller.abort();
    let raised: unknown;
    try {
      controller.signal.throwIfAborted();
    } catch (error) {
      raised = error;
    }
    expect(isAbortError(raised)).toBe(true);
  });

  it('recognises a plain Error whose NAME is AbortError', () => {
    const error = new Error('cancelled');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });
});
