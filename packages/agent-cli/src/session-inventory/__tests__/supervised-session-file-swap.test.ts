import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toExternalEventGrantDocument } from '../../external-events/external-event-grant-file.js';
import {
  takeSupervisedGrantHandoff,
  writeSupervisedGrantHandoff,
} from '../supervised-session-control.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';

/**
 * The first time the code under test checks or opens `path`, swap what is at that path for a link
 * to another file — the moment a separate check followed by a read of the same path is exposed.
 */
const swap = vi.hoisted(() => ({
  path: undefined as string | undefined,
  run: undefined as (() => void) | undefined,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const thenSwap = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: Parameters<T>) => {
      const result = fn(...args);
      if (swap.path !== undefined && args[0] === swap.path) {
        const run = swap.run;
        swap.path = undefined;
        swap.run = undefined;
        run?.();
      }
      return result;
    }) as T;
  return {
    ...actual,
    lstatSync: thenSwap(actual.lstatSync),
    statSync: thenSwap(actual.statSync),
    openSync: thenSwap(actual.openSync),
  };
});

const ID = '0f6c3a5e-8c1b-4d2a-9f3e-1a2b3c4d5e6f';

function grant(grantId: string): IExternalEventGrant {
  return {
    grantId,
    verifier: {
      issuer: 'https://issuer.example',
      resource: `https://robota.example/events/${grantId}`,
      algorithms: ['ES256'],
      requiredScopes: ['robota.events.submit'],
      allowedClients: ['ci-bot'],
    },
    kinds: ['message'],
  };
}

describe('supervised session private files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rs-swap-'));
  });
  afterEach(() => {
    swap.path = undefined;
    swap.run = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the grant handoff it checked, even when the path becomes a link right after', () => {
    const root = join(dir, 'supervised');
    writeSupervisedGrantHandoff(root, ID, [grant('handed')]);
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify([toExternalEventGrantDocument(grant('swapped'))]), {
      mode: 0o600,
    });
    const handoff = join(root, `.${ID}.grants.json`);
    swap.path = handoff;
    swap.run = () => {
      rmSync(handoff);
      symlinkSync(other, handoff);
    };

    expect(takeSupervisedGrantHandoff(root, ID).map((entry) => entry.grantId)).toEqual(['handed']);
    // The swap did happen: the handoff was checked, and only then replaced.
    expect(swap.path).toBeUndefined();
  });

  it('still refuses a handoff that is a link from the start', () => {
    const root = join(dir, 'supervised');
    writeSupervisedGrantHandoff(root, ID, [grant('handed')]);
    const handoff = join(root, `.${ID}.grants.json`);
    const other = join(dir, 'other.json');
    writeFileSync(other, JSON.stringify([toExternalEventGrantDocument(grant('linked'))]), {
      mode: 0o600,
    });
    rmSync(handoff);
    symlinkSync(other, handoff);

    expect(() => takeSupervisedGrantHandoff(root, ID)).toThrow(/could not be read/);
  });
});
