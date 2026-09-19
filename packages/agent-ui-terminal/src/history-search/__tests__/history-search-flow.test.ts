import { describe, expect, it } from 'vitest';

import {
  collapseToNewest,
  cycleScope,
  filterPrompts,
  inScope,
  splitByRanges,
} from '../history-search-flow.js';

import type { IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';

function entry(text: string, sessionId = 's1', project = '/p1'): IPromptHistoryEntry {
  return { at: '2026-01-01T00:00:00.000Z', sessionId, project, text };
}

describe('history-search-flow (SCREEN-1993 TC-03)', () => {
  it('filters case-insensitively with every match range, and an empty query matches all', () => {
    const entries = [
      entry('Deploy the canary'),
      entry('redeploy after the deploy hook'),
      entry('tidy'),
    ];
    const matches = filterPrompts(entries, 'DEPLOY');
    expect(matches.map((match) => match.entry.text)).toEqual([
      'Deploy the canary',
      'redeploy after the deploy hook',
    ]);
    expect(matches[0]?.ranges).toEqual([[0, 6]]);
    expect(matches[1]?.ranges).toEqual([
      [2, 8],
      [19, 25],
    ]);
    expect(filterPrompts(entries, '').map((match) => match.ranges)).toEqual([[], [], []]);
  });

  it('collapses duplicates to the newest occurrence and keeps newest-first order', () => {
    const collapsed = collapseToNewest([
      entry('deploy staging'),
      entry('rotate secrets'),
      entry('deploy staging '),
      entry('tidy'),
      entry('rotate secrets'),
    ]);
    expect(collapsed.map((item) => item.text)).toEqual([
      'deploy staging',
      'rotate secrets',
      'tidy',
    ]);
  });

  it('cycles all → session → project → all and scopes by session id or project', () => {
    expect(cycleScope('all')).toBe('session');
    expect(cycleScope('session')).toBe('project');
    expect(cycleScope('project')).toBe('all');
    const context = { sessionId: 's1', project: '/p1' };
    const here = entry('a', 's1', '/p1');
    const otherSession = entry('b', 's2', '/p1');
    const otherProject = entry('c', 's3', '/p2');
    expect([here, otherSession, otherProject].map((item) => inScope(item, 'all', context))).toEqual(
      [true, true, true],
    );
    expect(
      [here, otherSession, otherProject].map((item) => inScope(item, 'session', context)),
    ).toEqual([true, false, false]);
    expect(
      [here, otherSession, otherProject].map((item) => inScope(item, 'project', context)),
    ).toEqual([true, true, false]);
  });

  it('splits text into plain and matched runs for colour-free highlighting', () => {
    expect(
      splitByRanges('redeploy after the deploy hook', [
        [2, 8],
        [19, 25],
      ]),
    ).toEqual([
      { text: 're', matched: false },
      { text: 'deploy', matched: true },
      { text: ' after the ', matched: false },
      { text: 'deploy', matched: true },
      { text: ' hook', matched: false },
    ]);
    expect(splitByRanges('plain', [])).toEqual([{ text: 'plain', matched: false }]);
  });
});
