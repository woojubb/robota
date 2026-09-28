/**
 * #3282 §4c — the Project panel's reads dispatch: success answers the matching `project_*` message
 * under the request's `requestId`; a rejected read becomes a `failed`/`unavailable` result (never an
 * uncaught rejection — the exact class of bug the `/memory` red-toast fix addresses at the command
 * layer, guarded again here at the wire boundary); a session that does not implement the capability
 * (`Partial<ISessionProjectRead>` — see `protocol-session.ts`) answers `protocol_error`, never a throw.
 */
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { handleProjectReadMessage, isProjectReadMessage } from '../project-read-messages.js';

import type { TOutboundDeliver } from '../outbound-delivery.js';
import type { TProjectReadCapableSession } from '../protocol-session.js';
import type { TClientMessage, TServerMessage } from '../wire-messages.js';

function collect(): { sent: TServerMessage[]; deliver: TOutboundDeliver } {
  const sent: TServerMessage[] = [];
  return { sent, deliver: createOutboundDelivery((m) => sent.push(m), vi.fn()) };
}

describe('isProjectReadMessage', () => {
  it('recognizes exactly the three Project panel read types', () => {
    expect(isProjectReadMessage({ type: 'project-status', requestId: 'r' })).toBe(true);
    expect(isProjectReadMessage({ type: 'project-diff', requestId: 'r', path: 'a.txt' })).toBe(true);
    expect(isProjectReadMessage({ type: 'project-memory', requestId: 'r' })).toBe(true);
    expect(isProjectReadMessage({ type: 'get-status' } as TClientMessage)).toBe(false);
  });
});

describe('handleProjectReadMessage', () => {
  it('answers project_status with the session result under the same requestId', async () => {
    const { sent, deliver } = collect();
    const session = {
      readProjectStatus: vi.fn().mockResolvedValue({ kind: 'not-a-repository' }),
    } as unknown as TProjectReadCapableSession;
    handleProjectReadMessage(session, deliver, { type: 'project-status', requestId: 'r1' });
    await Promise.resolve();
    expect(sent).toEqual([
      { type: 'project_status', requestId: 'r1', result: { kind: 'not-a-repository' } },
    ]);
  });

  it('passes the path through to readProjectDiff and answers project_diff', async () => {
    const { sent, deliver } = collect();
    const readProjectDiff = vi.fn().mockResolvedValue({ kind: 'diff', diffLines: [], truncated: false });
    const session = { readProjectDiff } as unknown as TProjectReadCapableSession;
    handleProjectReadMessage(session, deliver, {
      type: 'project-diff',
      requestId: 'r2',
      path: 'src/a.ts',
    });
    await Promise.resolve();
    expect(readProjectDiff).toHaveBeenCalledExactlyOnceWith('src/a.ts');
    expect(sent).toEqual([
      { type: 'project_diff', requestId: 'r2', result: { kind: 'diff', diffLines: [], truncated: false } },
    ]);
  });

  it('answers project_memory with the session result', async () => {
    const { sent, deliver } = collect();
    const session = {
      readProjectMemory: vi
        .fn()
        .mockResolvedValue({ kind: 'memory', content: 'x', path: 'MEMORY.md', truncated: false }),
    } as unknown as TProjectReadCapableSession;
    handleProjectReadMessage(session, deliver, { type: 'project-memory', requestId: 'r3' });
    await Promise.resolve();
    expect(sent).toEqual([
      {
        type: 'project_memory',
        requestId: 'r3',
        result: { kind: 'memory', content: 'x', path: 'MEMORY.md', truncated: false },
      },
    ]);
  });

  it('turns a rejected readProjectStatus into a failed result, never an uncaught rejection', async () => {
    const { sent, deliver } = collect();
    const session = {
      readProjectStatus: vi.fn().mockRejectedValue(new Error('git not found')),
    } as unknown as TProjectReadCapableSession;
    handleProjectReadMessage(session, deliver, { type: 'project-status', requestId: 'r4' });
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([
      { type: 'project_status', requestId: 'r4', result: { kind: 'failed', message: 'git not found' } },
    ]);
  });

  it('turns a rejected readProjectMemory into an unavailable result', async () => {
    const { sent, deliver } = collect();
    const session = {
      readProjectMemory: vi.fn().mockRejectedValue(new Error('no store')),
    } as unknown as TProjectReadCapableSession;
    handleProjectReadMessage(session, deliver, { type: 'project-memory', requestId: 'r5' });
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toEqual([
      { type: 'project_memory', requestId: 'r5', result: { kind: 'unavailable', message: 'no store' } },
    ]);
  });

  it('answers protocol_error, never a throw, when the session has no project-read capability', () => {
    const { sent, deliver } = collect();
    const session = {} as unknown as TProjectReadCapableSession;
    expect(() =>
      handleProjectReadMessage(session, deliver, { type: 'project-status', requestId: 'r6' }),
    ).not.toThrow();
    expect(sent).toEqual([
      {
        type: 'protocol_error',
        message: 'This host does not support the Project panel.',
        requestId: 'r6',
      },
    ]);
  });
});
