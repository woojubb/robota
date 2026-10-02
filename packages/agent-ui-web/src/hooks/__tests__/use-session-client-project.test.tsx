// @vitest-environment jsdom
/**
 * #3282 §4c — the Project panel's correlated request/response state: `requestProjectStatus`/
 * `requestProjectDiff`/`requestProjectMemory` send the matching wire message with a fresh
 * `requestId`, and a reply is only applied when it answers the LATEST request of its kind (a stale
 * diff reply — superseded by clicking a different file before the first one answered — is dropped).
 */

import { renderHook } from '../../testing/product-provider.js';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TClientMessage } from '../../client/ws-session-client.js';
import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
  sent: TClientMessage[];
} {
  const sent: TClientMessage[] = [];
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    return { connect: () => {}, disconnect: () => {}, send: (msg) => sent.push(msg) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return { result, deliver: (msg) => act(() => onMessage?.(msg)), sent };
}

describe('#3282 §4c — the Project panel reducer state', () => {
  it('starts idle with nothing loaded', () => {
    const { result } = setup();
    expect(result.current.projectStatusState).toBe('idle');
    expect(result.current.projectStatus).toBeNull();
    expect(result.current.projectDiffState).toBe('idle');
    expect(result.current.projectDiff).toBeNull();
    expect(result.current.projectMemoryState).toBe('idle');
    expect(result.current.projectMemory).toBeNull();
  });

  it('requestProjectStatus sends project-status and a reply lands as reducer state', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.requestProjectStatus());
    expect(result.current.projectStatusState).toBe('loading');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'project-status' });
    const requestId = (sent[0] as Extract<TClientMessage, { type: 'project-status' }>).requestId;
    deliver({ type: 'project_status', requestId, result: { kind: 'not-a-repository' } });
    expect(result.current.projectStatusState).toBe('ready');
    expect(result.current.projectStatus).toEqual({ kind: 'not-a-repository' });
  });

  it('requestProjectDiff sends the path and a matching reply lands as reducer state', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.requestProjectDiff('src/a.ts'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'project-diff', path: 'src/a.ts' });
    const requestId = (sent[0] as Extract<TClientMessage, { type: 'project-diff' }>).requestId;
    deliver({
      type: 'project_diff',
      requestId,
      result: { kind: 'diff', diffLines: [], truncated: false },
    });
    expect(result.current.projectDiffState).toBe('ready');
    expect(result.current.projectDiff).toEqual({ kind: 'diff', diffLines: [], truncated: false });
    expect(result.current.projectDiffPath).toBe('src/a.ts');
  });

  it('drops a stale diff reply superseded by a second request', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.requestProjectDiff('a.ts'));
    const firstId = (sent[0] as Extract<TClientMessage, { type: 'project-diff' }>).requestId;
    act(() => result.current.requestProjectDiff('b.ts'));
    const secondId = (sent[1] as Extract<TClientMessage, { type: 'project-diff' }>).requestId;
    expect(firstId).not.toBe(secondId);
    // The first (now-stale) request answers after the second was sent.
    deliver({
      type: 'project_diff',
      requestId: firstId,
      result: { kind: 'diff', diffLines: [{ type: 'add', text: 'stale', lineNumber: 1 }], truncated: false },
    });
    expect(result.current.projectDiffState).toBe('loading');
    expect(result.current.projectDiff).toBeNull();
    // The second (current) request's own answer is applied.
    deliver({
      type: 'project_diff',
      requestId: secondId,
      result: { kind: 'diff', diffLines: [], truncated: false },
    });
    expect(result.current.projectDiffState).toBe('ready');
    expect(result.current.projectDiff).toEqual({ kind: 'diff', diffLines: [], truncated: false });
  });

  it('requestProjectMemory sends project-memory and a reply lands as reducer state', () => {
    const { result, deliver, sent } = setup();
    act(() => result.current.requestProjectMemory());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'project-memory' });
    const requestId = (sent[0] as Extract<TClientMessage, { type: 'project-memory' }>).requestId;
    deliver({
      type: 'project_memory',
      requestId,
      result: { kind: 'unavailable', message: "Project memory isn't available for this folder." },
    });
    expect(result.current.projectMemoryState).toBe('ready');
    expect(result.current.projectMemory).toEqual({
      kind: 'unavailable',
      message: "Project memory isn't available for this folder.",
    });
  });
});
