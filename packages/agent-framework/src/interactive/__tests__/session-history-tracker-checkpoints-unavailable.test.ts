import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditCheckpointsUnavailableError } from '../../checkpoints/edit-checkpoints-unavailable-error.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  createRestrictedWorkspaceProjectAccess,
  WorkspaceAuthorityRequiredError,
} from '../../workspace-trust/index.js';
import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';

import type { TWorkspaceProjectAccess } from '../../workspace-trust/index.js';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-checkpoints-unavailable-')));
  roots.push(root);
  return root;
}

function trackerWithoutStore(cwd: string, projectAccess: TWorkspaceProjectAccess) {
  return new SessionHistoryTracker(
    { cwd, projectAccess },
    () => 'session-without-store',
    () => false,
    vi.fn(),
    vi.fn(),
    vi.fn(),
  );
}

function reasonFor(tracker: SessionHistoryTracker): string | undefined {
  try {
    tracker.listEditCheckpoints();
  } catch (error) {
    if (error instanceof EditCheckpointsUnavailableError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('a session without an edit checkpoint store', () => {
  it('says the workspace is restricted when that is what stands in the way', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const cwd = tempRoot();
    const tracker = trackerWithoutStore(
      cwd,
      createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    );

    expect(reasonFor(tracker)).toBe('restricted-workspace');
    expect(() => tracker.listEditCheckpoints()).toThrow('need a trusted workspace');
  });

  it.each(['darwin', 'win32'] as const)(
    'on %s, says the host cannot keep checkpoints, whether or not the workspace is trusted',
    async (platform) => {
      const cwd = tempRoot();
      const trusted = await createTrustedProjectAccessFixture(cwd);
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);

      for (const access of [trusted, createRestrictedWorkspaceProjectAccess('untrusted', cwd)]) {
        const tracker = trackerWithoutStore(cwd, access);
        expect(reasonFor(tracker)).toBe('host-cannot-write-project');
        expect(() => tracker.listEditCheckpoints()).toThrow(
          'cannot prove a write stays inside the project',
        );
      }
    },
  );

  it('says no store was given when the host could have kept one', async () => {
    const cwd = tempRoot();
    const trusted = await createTrustedProjectAccessFixture(cwd);
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    expect(reasonFor(trackerWithoutStore(cwd, trusted))).toBe('no-checkpoint-store');
  });

  it('names itself, and is still a workspace-authority error', () => {
    const error = new EditCheckpointsUnavailableError('no-checkpoint-store');

    expect(error.name).toBe('EditCheckpointsUnavailableError');
    expect(error).toBeInstanceOf(WorkspaceAuthorityRequiredError);
    expect(error.code).toBe('WORKSPACE_AUTHORITY_REQUIRED');
  });
});
