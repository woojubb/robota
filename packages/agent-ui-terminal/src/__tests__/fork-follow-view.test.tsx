/**
 * The view a person has of a fork job they attach to (#3679 3f, live follow).
 *
 * A running fork is followed: the pane says so, shows what the job is doing now — its newest text,
 * however long a paragraph it has streamed — and says what the person can do (type to steer it, go
 * back). An ended fork is shown as it ended, with the way on: continue it as a session. The switcher
 * names what `a` will do on the focused row, which depends on whether the job still runs.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ExecutionWorkspaceDetailPane from '../ExecutionWorkspaceDetailPane.js';
import ExecutionWorkspaceSwitcher from '../ExecutionWorkspaceSwitcher.js';
import { FOLLOW_ROW_TAIL_CHARACTERS, formatFollowRows } from '../execution-workspace-view-model.js';

import type {
  IExecutionDetailPage,
  IExecutionDetailRecord,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';

function forkEntry(overrides: Partial<IExecutionWorkspaceEntry> = {}): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    taskKind: 'agent',
    origin: { kind: 'slash_command', sessionId: 'session_parent' },
    status: 'running',
    state: 'working',
    title: 'experiment',
    subtitle: 'general-purpose',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-11-05T00:00:00.000Z',
    controls: ['select', 'cancel', 'send', 'attach'],
    resumeSessionId: 'session_fork',
    ...overrides,
  };
}

function plainEntry(): IExecutionWorkspaceEntry {
  const { resumeSessionId: _dropped, ...entry } = forkEntry({
    id: 'task:agent_2',
    sourceId: 'agent_2',
    title: 'Explore',
    controls: ['select', 'cancel', 'send'],
  });
  return entry;
}

function page(...records: Array<[IExecutionDetailRecord['kind'], string]>): IExecutionDetailPage {
  return {
    entryId: 'task:agent_1',
    records: records.map(([kind, text], index) => ({ id: `r${index}`, kind, text })),
  };
}

/** A frame as one line of words: wrapping does not matter to what is said. */
function words(frame: string | undefined): string {
  return (frame ?? '').replace(/\s+/g, ' ').trim();
}

describe('the pane of a running fork', () => {
  it('says the job is being followed, shows its rows, and says how to steer it and go back', () => {
    const { lastFrame } = render(
      <ExecutionWorkspaceDetailPane
        entry={forkEntry({ status: 'running' })}
        page={page(
          ['message', 'Looking at the parser.'],
          ['tool_activity', 'Read /src/a.ts — done'],
        )}
      />,
    );

    const frame = words(lastFrame());
    expect(frame).toContain('Following experiment');
    expect(frame).toContain('Looking at the parser.');
    expect(frame).toContain('Read /src/a.ts — done');
    expect(frame).toContain('Type to message this job');
    expect(frame).toContain('Esc Back to the main thread');
  });

  it('shows the newest text of a long paragraph, not its first words', () => {
    const paragraph = `${'start '.repeat(300)}and the newest words end here`;
    const { lastFrame } = render(
      <ExecutionWorkspaceDetailPane
        entry={forkEntry({ status: 'running' })}
        page={page(['message', paragraph])}
      />,
    );

    const frame = words(lastFrame());
    expect(frame).toContain('and the newest words end here');
    expect(frame).toContain('…');
  });
});

describe('the pane of a fork that ended', () => {
  it('shows it as it ended and says how to continue it as a session', () => {
    const { lastFrame } = render(
      <ExecutionWorkspaceDetailPane
        entry={forkEntry({ status: 'completed', controls: ['select', 'close', 'attach'] })}
        page={page(['message', 'Found it.'], ['result', 'all done'])}
      />,
    );

    const frame = words(lastFrame());
    expect(frame).toContain('Viewing experiment');
    expect(frame).not.toContain('Following');
    expect(frame).toContain('all done');
    expect(frame).toContain('This job has ended');
    expect(frame).toContain('Ctrl+B');
    expect(frame).toContain('continue it as a session');
    expect(frame).not.toContain('Type to message this job');
  });
});

describe('the pane of a task that is not a fork', () => {
  it('is what it was: a plain view, with no follow or continue wording', () => {
    const { lastFrame } = render(
      <ExecutionWorkspaceDetailPane
        entry={plainEntry()}
        page={page(['progress', 'working on it'])}
      />,
    );

    const frame = words(lastFrame());
    expect(frame).toContain('Viewing Explore agent');
    expect(frame).toContain('working on it');
    expect(frame).not.toContain('Following');
    expect(frame).not.toContain('continue it as a session');
    expect(frame).not.toContain('Type to message this job');
  });
});

describe('the rows of a follow view', () => {
  it('keeps the newest rows within a budget, so the view never grows past the screen', () => {
    const rows: Array<[IExecutionDetailRecord['kind'], string]> = Array.from(
      { length: 40 },
      (_, index) => ['message', `row ${index} ${'x'.repeat(400)}`],
    );
    const shown = formatFollowRows(page(...rows).records);

    const total = shown.reduce((sum, row) => sum + row.text.length, 0);
    expect(total).toBeLessThanOrEqual(1300);
    expect(shown.at(-1)?.text).toContain('x');
    expect(shown.at(-1)?.id).toBe('r39');
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThanOrEqual(12);
  });

  it('never cuts a character in two when it keeps the tail', () => {
    // The emoji's two halves sit exactly across the place the tail starts.
    const text = `${'a'.repeat(50)}😀${'b'.repeat(FOLLOW_ROW_TAIL_CHARACTERS - 2)}`;
    const [row] = formatFollowRows(page(['message', text]).records);

    expect(row?.text).toBe(`…${'b'.repeat(FOLLOW_ROW_TAIL_CHARACTERS - 2)}`);
  });

  it('always shows the newest row, even when it alone is longer than the budget', () => {
    const shown = formatFollowRows(
      page(['message', 'older'], ['message', 'y'.repeat(5000)]).records,
    );

    expect(shown.at(-1)?.text.endsWith('y')).toBe(true);
    expect(shown.at(-1)?.text.length).toBeLessThanOrEqual(1300);
  });
});

describe('what the switcher says `a` will do', () => {
  function snapshotOf(entry: IExecutionWorkspaceEntry): IExecutionWorkspaceSnapshot {
    return {
      sessionId: 'session_parent',
      selectedEntryId: entry.id,
      updatedAt: '2026-11-05T00:00:00.000Z',
      entries: [entry],
    };
  }

  it('names a running fork "Follow" and an ended one "Continue"', () => {
    const running = forkEntry({ status: 'running' });
    const ended = forkEntry({ status: 'completed', controls: ['select', 'close', 'attach'] });

    const followFrame = render(
      <ExecutionWorkspaceSwitcher
        snapshot={snapshotOf(running)}
        selectedEntryId={running.id}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onAttach={vi.fn()}
      />,
    ).lastFrame();
    const continueFrame = render(
      <ExecutionWorkspaceSwitcher
        snapshot={snapshotOf(ended)}
        selectedEntryId={ended.id}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onAttach={vi.fn()}
      />,
    ).lastFrame();

    expect(words(followFrame)).toContain('A Follow');
    expect(words(followFrame)).not.toContain('A Continue');
    expect(words(continueFrame)).toContain('A Continue');
    expect(words(continueFrame)).not.toContain('A Follow');
  });
});
