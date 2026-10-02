import { describe, expect, it } from 'vitest';
import { projectHostedSessionCheckpoint } from '../hosted-session-checkpoint.js';

function record() {
  const message = { id: 'saved-user', timestamp: '2026-01-01T00:00:00.000Z', state: 'complete' };
  return { schemaVersion: 1, record: {
    id: 'saved-session', cwd: '/old/workspace', name: 'Task conversation',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    systemPrompt: 'old authority', sandboxSnapshotId: 'old VM', sessionLoops: [],
    goal: { id: 'old-goal', objective: 'old autonomous instructions', status: 'active', iterations: 1, maxIterations: 50, startedAt: '2026-01-01T00:00:00.000Z', progress: [] },
    activeBranch: { branchId: 'old-branch', checkpointId: 'old-authority' },
    history: [{ id: 'old-event', timestamp: '2026-01-01T00:00:00.000Z', category: 'event', type: 'execution', data: { authority: 'old authority event' } }],
    messages: [
      { ...message, role: 'system', content: 'old system authority' },
      { ...message, role: 'user', content: 'work context', metadata: { trust: 'old authority' } },
      { ...message, id: 'saved-tool', role: 'tool', toolCallId: 'saved-call', content: 'old tool result' },
    ],
  } };
}

describe('hosted conversation checkpoint projection', () => {
  it('preserves conversation and name, relocates cwd and rebuilds authority from current composition', () => {
    const source = record();
    const restored = projectHostedSessionCheckpoint(source, '/fresh/workspace');
    expect(restored).toEqual({
      id: 'saved-session', cwd: '/fresh/workspace', name: 'Task conversation',
      createdAt: source.record.createdAt, updatedAt: source.record.updatedAt,
      history: expect.any(Array),
      messages: [
        { id: 'saved-user', timestamp: new Date(source.record.createdAt), state: 'complete', role: 'user', content: 'work context' },
        { id: 'saved-tool', timestamp: new Date(source.record.createdAt), state: 'complete', role: 'tool', toolCallId: 'saved-call', content: 'old tool result' },
      ],
    });
    expect(source.record.messages[1]).toHaveProperty('metadata', { trust: 'old authority' });
  });

  it('reconstructs display history from the projected conversation rather than importing old event state', () => {
    const source = record();
    const restored = projectHostedSessionCheckpoint(source, '/fresh/workspace');
    expect(restored.history?.map((entry) => entry.data)).toEqual(restored.messages);
    expect(restored.history?.map((entry) => ({ category: entry.category, type: entry.type }))).toEqual([
      { category: 'chat', type: 'user' }, { category: 'chat', type: 'tool' },
    ]);
    expect(JSON.stringify(restored.history)).not.toContain('old authority');
  });

  it.each(['version', 'selector', 'malformed', 'empty', 'bytes', 'projected-bytes', 'messages'])('refuses an unusable checkpoint: %s', (fault) => {
    const source = record();
    if (fault === 'version') source.schemaVersion = 900;
    if (fault === 'selector') source.record.id = '../settings';
    if (fault === 'malformed') source.record.messages[1]!.state = 'unknown';
    if (fault === 'empty') source.record.messages = source.record.messages.slice(0, 1);
    if (fault === 'bytes') source.record.messages[1]!.content = 'x'.repeat(8 * 1024 * 1024);
    if (fault === 'projected-bytes') source.record.messages[1]!.content = 'x'.repeat(5 * 1024 * 1024);
    if (fault === 'messages') source.record.messages = Array.from({ length: 10_001 }, () => source.record.messages[1]!);
    expect(() => projectHostedSessionCheckpoint(source, '/fresh/workspace')).toThrow(/conversation checkpoint/u);
  });
});
