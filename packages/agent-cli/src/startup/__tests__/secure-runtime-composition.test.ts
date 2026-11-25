/**
 * What the CLI supplies to the secure-runtime start: the part of argv before `--`, the option names
 * that say a launch is supervised or serves, the secure decision and keyring of its own state root,
 * and the registration of the returned holder as the product's sealing. The agreement rule itself is
 * the local host's.
 */
import { SUPERVISED_SPAWNER_PAIR_FLAG } from '@robota-sdk/agent-local-host';
import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import {
  overrideProductSecureMode,
  productKeyHolder,
  productSecureMode,
} from '../../product/session-sealing.js';
import { startSecureRuntimeOrExit } from '../secure-runtime-composition.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestProductRuntimes();
});

function exitSpy(): { readonly stderr: string[] } {
  const stderr: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit');
  });
  return { stderr };
}

describe('the options the start reads', () => {
  it('stop at the first `--`, so a prompt that spells a flag is text', () => {
    const exits = exitSpy();
    const runtime = createTestProductRuntime();

    expect(
      startSecureRuntimeOrExit(
        runtime,
        ['node', 'cli', '-p', '--', SUPERVISED_SPAWNER_PAIR_FLAG, '--serve'],
        undefined,
      ),
    ).toBeUndefined();
    expect(exits.stderr).toEqual([]);
  });

  it('name a supervised launch and a serve by this CLI own option names', () => {
    const exits = exitSpy();
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, true);

    for (const argv of [
      ['node', 'cli', '--serve'],
      ['node', 'cli', '--supervised-session-id', 'a'],
      ['node', 'cli', '--supervised-session-id=a'],
    ]) {
      expect(() => startSecureRuntimeOrExit(runtime, argv, undefined)).toThrow('exit');
    }
    expect(exits.stderr).toHaveLength(3);
    for (const message of exits.stderr) expect(message).toMatch(/only with the pair/u);
  });

  it('leave a secure process that is not a runtime alone', () => {
    const exits = exitSpy();
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, true);

    expect(
      startSecureRuntimeOrExit(runtime, ['node', 'cli', '-p', 'hi'], undefined),
    ).toBeUndefined();
    expect(exits.stderr).toEqual([]);
  });
});

describe('the key holder of a secure runtime', () => {
  it('is registered as the sealing of the runtime it was made for', () => {
    exitSpy();
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, true);
    const identity = createRuntimeIdentity();

    const started = startSecureRuntimeOrExit(
      runtime,
      ['node', 'cli', '--serve', '--supervised-session-id', 'a', SUPERVISED_SPAWNER_PAIR_FLAG],
      identity,
    );

    expect(productSecureMode(runtime)).toBe(true);
    expect(started?.identity).toBe(identity);
    expect(started?.holder).toBeDefined();
    expect(productKeyHolder(runtime)).toBe(started?.holder);
  });

  it('is not made for a plain runtime, which has no spawner to answer', () => {
    exitSpy();
    const runtime = createTestProductRuntime();

    expect(
      startSecureRuntimeOrExit(runtime, ['node', 'cli', '--serve'], undefined),
    ).toBeUndefined();
    expect(productKeyHolder(runtime)).toBeUndefined();
  });
});
