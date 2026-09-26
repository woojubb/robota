/**
 * `/devices` tells the running session when it changed this device's identity or lists, so the
 * device mesh opens for a new identity and pushes new lists without a restart.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDevicesCommandPort } from '../index.js';
import { scriptedOperator } from './fake-secret-terminal.js';

let home: string;
let root: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-devices-port-'));
  root = join(home, '.robota');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the /devices port and the running session', () => {
  it('says the identity changed after a verb that changed it, and not after a refusal', async () => {
    const changed = vi.fn();
    const port = createDevicesCommandPort({
      root,
      credentials: {
        store: createFileCredentialStore(join(root, 'credentials'), { withinRoot: root }),
        describe: () => undefined,
      },
      openTerminal: () => scriptedOperator().session,
      onIdentityChanged: changed,
    });

    expect((await port.init({ name: 'laptop' })).ok).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    // Refused: this device already has an identity. Nothing changed, nothing said.
    expect((await port.init({ name: 'laptop' })).ok).toBe(false);
    await port.list();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
