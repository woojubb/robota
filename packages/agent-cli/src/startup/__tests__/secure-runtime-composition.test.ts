/**
 * What the CLI supplies to the secure-runtime start: the part of argv before `--`, the option names
 * that say a launch is supervised or serves, the secure decision and keyring of its own state root,
 * and the registration of the returned holder as the product's sealing. The agreement rule itself is
 * the local host's. Every process that runs as its own starts on a locked holder; the terminal's is
 * the one a person can unlock.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactLockedError } from '@robota-sdk/agent-core';
import { SUPERVISED_SPAWNER_PAIR_FLAG } from '@robota-sdk/agent-local-host';
import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { FIXTURE_PASSPHRASE } from '@robota-sdk/agent-local-host/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import {
  enableSecureConversations,
  resolveSecureRuntime,
} from '../../__tests__/helpers/secure-product-state.js';
import {
  overrideProductSecureMode,
  productKeyHolder,
  productSecureMode,
  resolveProductSessionSealing,
} from '../../product/session-sealing.js';
import {
  registerLockedKeyHolder,
  startSecureRuntimeOrExit,
} from '../secure-runtime-composition.js';

const homes: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestProductRuntimes();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** A runtime whose state root has secure conversations on, with its keyring file unless told not to. */
async function secureRuntime(options: { readonly keyring?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'locked-holder-'));
  homes.push(home);
  const plain = createTestProductRuntime('test-product', { HOME: home });
  await enableSecureConversations(plain, options);
  return resolveSecureRuntime(plain);
}

const REFUSAL = /sealing key holder is unavailable; no conversation store may open/u;

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

describe('the locked key holder of the surfaces that run as their own process', () => {
  it.each([
    ['print mode', ['node', 'cli', '-p', 'hi']],
    ['--goal', ['node', 'cli', '--goal', 'finish']],
    ['acp', ['node', 'cli', 'acp']],
    ['MCP over stdio', ['node', 'cli', 'mcp', 'serve']],
  ])('is registered as the sealing of %s, and holds no read key', async (_surface, argv) => {
    const runtime = await secureRuntime();

    const holder = registerLockedKeyHolder(runtime, argv, undefined);

    expect(holder).toBeDefined();
    expect(productKeyHolder(runtime)).toBe(holder);
    expect(holder?.isUnlocked).toBe(false);
    const sealing = resolveProductSessionSealing(runtime);
    if (sealing === 'plain') throw new Error('a secure process never seals plain');
    const context = { kind: 'session-record', id: 'session_locked_holder' } as const;
    const sealed = sealing.sealer.sealBytes(Buffer.from('CANARY-locked-write'), context);
    expect(Buffer.from(sealed).includes(Buffer.from('CANARY-locked-write'))).toBe(false);
    // Nothing here ever unlocked, so what it sealed does not open for it either.
    expect(() => sealing.sealer.openBytes(sealed, context)).toThrow(ArtifactLockedError);
    expect(holder?.isUnlocked).toBe(false);
  });

  it.each([
    ['usage', ['node', 'cli', 'usage']],
    ['the direct user-local command with a print flag', ['node', 'cli', 'user-local', 'list', '-p']],
    ['the direct user-local command', ['node', 'cli', 'user-local', 'list']],
    ['a session listing, even with a print flag', ['node', 'cli', 'session', 'list', '-p']],
    ['a daemon start', ['node', 'cli', 'daemon', 'start']],
    ['a background session start', ['node', 'cli', 'session', 'start', '--background']],
    ['the attached terminal', ['node', 'cli', '--attach']],
    ['a served runtime without its pair', ['node', 'cli', '--serve']],
    ['MCP over HTTP', ['node', 'cli', 'mcp', 'serve', '--http-token-file', '/tmp/robota-token']],
    ['help', ['node', 'cli', '-p', '--help']],
  ])('registers no holder for %s, so its stores still refuse', async (_what, argv) => {
    const runtime = await secureRuntime();

    expect(registerLockedKeyHolder(runtime, argv, undefined)).toBeUndefined();

    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(() => resolveProductSessionSealing(runtime)).toThrow(REFUSAL);
  });

  it.each([
    ['the terminal', ['node', 'cli']],
    ['a continued terminal session', ['node', 'cli', '--continue']],
    ['a terminal given a first prompt', ['node', 'cli', 'fix the failing test']],
  ])('is registered for %s, starts locked, and is the one a person can unlock', async (_what, argv) => {
    const runtime = await secureRuntime();

    const holder = registerLockedKeyHolder(runtime, argv, undefined);

    expect(holder).toBeDefined();
    expect(productKeyHolder(runtime)).toBe(holder);
    expect(holder?.isUnlocked).toBe(false);
    const sealing = resolveProductSessionSealing(runtime);
    if (sealing === 'plain') throw new Error('a secure process never seals plain');
    const context = { kind: 'session-record', id: 'session_terminal_holder' } as const;
    const sealed = sealing.sealer.sealBytes(Buffer.from('CANARY-terminal-write'), context);
    expect(Buffer.from(sealed).includes(Buffer.from('CANARY-terminal-write'))).toBe(false);
    // Locked is write-only: what the terminal sealed does not open until the person unlocks.
    expect(() => sealing.sealer.openBytes(sealed, context)).toThrow(ArtifactLockedError);

    await holder?.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    expect(Buffer.from(sealing.sealer.openBytes(sealed, context)).toString()).toBe(
      'CANARY-terminal-write',
    );
    holder?.lock('explicit');
    expect(() => sealing.sealer.openBytes(sealed, context)).toThrow(ArtifactLockedError);
  });

  it('registers none for a plain state root, whose stores stay plain, even beside a keyring file', async () => {
    // `secure setup` made the keyring and `secure enable` has not run, so the mode is still plain.
    const home = mkdtempSync(join(tmpdir(), 'locked-holder-plain-'));
    homes.push(home);
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    await enableSecureConversations(runtime, { mode: false });

    expect(
      registerLockedKeyHolder(runtime, ['node', 'cli', '-p', 'hi'], undefined),
    ).toBeUndefined();

    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(resolveProductSessionSealing(runtime)).toBe('plain');
  });

  it('leaves a supervised runtime with the holder its spawner pair gave it', async () => {
    exitSpy();
    const runtime = await secureRuntime();
    const started = startSecureRuntimeOrExit(
      runtime,
      ['node', 'cli', '--serve', '--supervised-session-id', 'a', SUPERVISED_SPAWNER_PAIR_FLAG],
      createRuntimeIdentity(),
    );

    // Even an argument list that reads as print mode adds nothing beside the runtime's own holder.
    expect(registerLockedKeyHolder(runtime, ['node', 'cli', '-p', 'hi'], started)).toBeUndefined();

    expect(productKeyHolder(runtime)).toBe(started?.holder);
  });

  it.each([
    ['missing', undefined],
    ['not a keyring', 'this is not a keyring'],
  ])('still refuses every store when the keyring file is %s', async (_state, content) => {
    const runtime = await secureRuntime({ keyring: false });
    if (content !== undefined) {
      writeFileSync(runtime.layout.userPaths.keyring, content, { mode: 0o600 });
    }

    expect(
      registerLockedKeyHolder(runtime, ['node', 'cli', '-p', 'hi'], undefined),
    ).toBeUndefined();

    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(() => resolveProductSessionSealing(runtime)).toThrow(REFUSAL);
  });
});
