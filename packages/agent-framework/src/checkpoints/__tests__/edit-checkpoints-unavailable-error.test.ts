import { describe, expect, it } from 'vitest';

import { EditCheckpointsUnavailableError } from '../edit-checkpoints-unavailable-error.js';

/**
 * #3289 §3 — "Edit checkpoints are off on this host: it cannot prove a write stays inside the
 * project, so a checkpoint could be neither saved nor restored." named an internal mechanism
 * instead of saying what the person cannot do. The user-facing feature is `/rewind`
 * (`packages/agent-command/src/rewind`), so the message names that instead of "edit checkpoints".
 */
describe('EditCheckpointsUnavailableError("host-cannot-write-project")', () => {
  it('says plainly that rewind is not available here, not an internal write-containment reason', () => {
    const error = new EditCheckpointsUnavailableError('host-cannot-write-project');
    expect(error.message).toBe("Rewind isn't available on this computer yet.");
    expect(error.message).not.toMatch(/prove a write stays inside the project/);
  });
});
