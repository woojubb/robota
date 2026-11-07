import { describe, expect, it, vi } from 'vitest';

import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { buildCreateSessionOptions } from '../create-session-projection.js';

import type { IFrameworkHost } from '../../host/framework-host.js';
import type { ICreateSessionProjectionDeps } from '../create-session-projection.js';
import type { IInitOptions } from '../interactive-session-options.js';

/**
 * How the session log learns the process is ending is the host's to say. A host that says it gets the
 * flush registered on the first buffered write; a host that says nothing gets a log that simply is not
 * flushed at exit, and the session still logs.
 */
const DEPS: ICreateSessionProjectionDeps = {
  mergedConfig: { provider: { name: 'test', model: 'test-model' } } as never,
  cwd: '/exit-flush',
  context: {} as ICreateSessionProjectionDeps['context'],
  projectInfo: {} as ICreateSessionProjectionDeps['projectInfo'],
  sessionId: 'session-exit-flush',
  contextCapacityHint: undefined,
  contributionSources: [],
  skillRoots: [],
};

function logOneStreamedWord(host: IFrameworkHost): string[] {
  const appended: string[] = [];
  const built = buildCreateSessionOptions(
    {
      host,
      cwd: '/exit-flush',
      provider: {} as never,
      sessionLogSink: { append: (_sessionId: string, text: string) => appended.push(text) },
    } as unknown as IInitOptions,
    DEPS,
  );
  built.sessionLogger?.log('session-exit-flush', 'text_delta', { delta: 'word' } as never);
  // Everything still buffered is what an exit would lose.
  expect(appended).toEqual([]);
  (built.sessionLogger as unknown as { flush(): void }).flush();
  return appended;
}

describe('the session log’s exit flush', () => {
  it('is registered through the host, once, when the log first buffers a streamed line', () => {
    const registerExitFlush = vi.fn();
    const appended = logOneStreamedWord(createTestFrameworkHost({ registerExitFlush }));
    expect(registerExitFlush).toHaveBeenCalledTimes(1);
    expect(registerExitFlush).toHaveBeenCalledWith(expect.any(Function));
    expect(appended.join('')).toContain('"event":"text_delta"');
  });

  it('is not registered by a host with no way to say its process ends, and the log still works', () => {
    const appended = logOneStreamedWord(createTestFrameworkHost({ registerExitFlush: undefined }));
    expect(appended.join('')).toContain('"event":"text_delta"');
  });
});
