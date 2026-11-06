/**
 * On Windows agent-core reads no process start time of its own, so presence passes the product's
 * reader (`readWindowsProcessStartTime`) both when it records this process and when it judges another:
 * without it every Windows presence would be `unknown`, and a recycled pid could pass for a live one.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity } from '@robota-sdk/agent-core/node';
import { leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { readWindowsProcessStartTime } from '@robota-sdk/agent-local-host';
import { writeProductMigrationMarker } from '../process-presence.js';

import type { ICliRuntimeContext } from '../runtime-context.js';

vi.mock('@robota-sdk/agent-local-host', async (importOriginal) => ({
  ...await importOriginal<typeof import('@robota-sdk/agent-local-host')>(),
  readWindowsProcessStartTime: vi.fn((pid: number) => `creation-time-${pid}`),
}));

const reader = vi.mocked(readWindowsProcessStartTime);
let home: string;
let runtime: ICliRuntimeContext;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'process-presence-windows-')));
  runtime = createTestProductRuntime('test-product', { HOME: home });
  reader.mockClear();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('presence on Windows', () => {
  it('records this process with the start time the Windows reader gives', () => {
    const marker = writeProductMigrationMarker(runtime, { platform: 'win32' });

    expect(reader).toHaveBeenCalledWith(process.pid);
    const owner = JSON.parse(readFileSync(join(marker.directory, '.owner.json'), 'utf8')) as {
      startTime?: string;
    };
    expect(owner.startTime).toBe(`creation-time-${process.pid}`);
    marker.release();
  });

  it('judges another process by the start time the Windows reader gives for it', () => {
    // The parent process is alive; the reader says it started when its record says, so it is alive.
    const parent = process.ppid;
    leaveProcessScopedDirectory(runtime.layout.userPaths.presence, 'process-', {
      ...readCurrentProcessIdentity(),
      pid: parent,
      startTime: `creation-time-${parent}`,
    });
    const marker = writeProductMigrationMarker(runtime, { platform: 'win32' });

    const others = marker.others();

    expect(reader).toHaveBeenCalledWith(parent);
    expect(others).toEqual([expect.objectContaining({ pid: parent, liveness: 'alive' })]);
    marker.release();
  });

  it("judges an entry naming this process's pid by the start time the Windows reader gives for this process", () => {
    // Another directory of this very process, as the Windows reader recorded it: alive, never swept.
    const mine = leaveProcessScopedDirectory(runtime.layout.userPaths.presence, 'process-', {
      ...readCurrentProcessIdentity(),
      startTime: `creation-time-${process.pid}`,
    });
    const marker = writeProductMigrationMarker(runtime, { platform: 'win32' });

    const others = marker.others();

    expect(others).toEqual([expect.objectContaining({ path: mine, liveness: 'alive' })]);
    expect(existsSync(mine)).toBe(true);
    marker.release();
  });
});
