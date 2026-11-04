/**
 * Every product entry decides its children's session from the one secure-mode predicate, beside
 * where it installs its environment: own sessions exactly when secure mode is on for the state root.
 */

import { withChildSession } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { installProductChildSessions } from '../process-environment.js';
import { overrideProductSecureMode } from '../session-sealing.js';

afterEach(() => {
  resetChildSessionsForTesting();
});

describe('installProductChildSessions', () => {
  it('leaves children in the terminal session while secure mode is off', () => {
    installProductChildSessions(createTestProductRuntime());
    const options = { stdio: 'pipe' as const };

    expect(withChildSession(options)).toBe(options);
  });

  it.skipIf(process.platform === 'win32')(
    'gives children their own session once secure mode is on',
    () => {
      const runtime = createTestProductRuntime();
      overrideProductSecureMode(runtime, true);

      installProductChildSessions(runtime);

      expect(withChildSession({ stdio: 'pipe' as const })).toEqual({
        stdio: 'pipe',
        detached: true,
      });
    },
  );
});
