import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { describe, expect, it, vi } from 'vitest';

import { assembleSessionTools } from '../assemble-session-tools.js';

import type { IEditCheckpointRecorder } from '../../checkpoints/edit-checkpoint-types.js';
import type { ICreateSessionOptions } from '../create-session-types.js';

/**
 * Issue #3081 — checkpointing follows where FILE writes land. A shared-filesystem sandbox confines
 * commands but writes files on the host, so those edits still need checkpoints.
 */
function options(sandboxClient: InMemorySandboxClient): ICreateSessionOptions {
  return {
    sandboxClient,
    defaultTools: [],
    editCheckpointRecorder: { record: vi.fn() } as unknown as IEditCheckpointRecorder,
  } as unknown as ICreateSessionOptions;
}

describe('assembleSessionTools and the sandbox filesystem relation', () => {
  it('keeps host edit checkpoints under a shared-filesystem sandbox', async () => {
    const shared = Object.assign(new InMemorySandboxClient(), { filesystem: 'shared' as const });
    const assembled = await assembleSessionTools(options(shared), '/workspace');
    expect(assembled.checkpointAvailable).toBe(true);
  });

  it('turns them off when files live in a separate sandbox filesystem', async () => {
    const assembled = await assembleSessionTools(options(new InMemorySandboxClient()), '/workspace');
    expect(assembled.checkpointAvailable).toBe(false);
  });
});
