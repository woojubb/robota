// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from '../Composer.js';

import type { TCommandCatalog } from '../../hooks/session-client-types.js';

/**
 * #3189: a command a client runs (`/shell`) stays in the `/` menu with a badge naming where it runs.
 * The row is dimmed by the colour of its name and description alone — an opacity on the row would
 * multiply into the badge (leaving it illegible) and fade the selected highlight.
 */

const catalog: TCommandCatalog = {
  commands: [
    { name: 'help', description: 'Show commands', modelInvocable: false, runner: 'runtime' },
    {
      name: 'shell',
      description: 'Open a shell',
      modelInvocable: false,
      runner: 'client',
      surfaces: ['terminal'],
    },
  ],
  skills: [],
};

/** The props every render needs beyond the ones a test itself cares about. */
function baseProps(): {
  onSubmit: ReturnType<typeof vi.fn>;
  onCommand: ReturnType<typeof vi.fn>;
  catalog: TCommandCatalog;
  status: null;
  running: boolean;
  onStop: ReturnType<typeof vi.fn>;
  queued: null;
  onCancelQueue: ReturnType<typeof vi.fn>;
} {
  return {
    onSubmit: vi.fn(),
    onCommand: vi.fn(),
    catalog,
    status: null,
    running: false,
    onStop: vi.fn(),
    queued: null,
    onCancelQueue: vi.fn(),
  };
}

function openMenu(): void {
  render(<Composer {...baseProps()} />);
  fireEvent.change(screen.getByLabelText('message'), { target: { value: '/' } });
}

/** Every opacity class on the element and the ancestors up to the listbox. */
function opacitiesUpToMenu(element: HTMLElement): string[] {
  const found: string[] = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    found.push(...Array.from(node.classList).filter((name) => name.startsWith('opacity-')));
    if (node.getAttribute('role') === 'listbox') break;
  }
  return found;
}

describe('Composer command menu', () => {
  afterEach(cleanup);

  it('keeps the "terminal" badge of a client command free of any opacity, in solid muted text', () => {
    openMenu();

    const badge = screen.getByText('terminal');

    expect(opacitiesUpToMenu(badge)).toEqual([]);
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('dims a client command by its text colours, leaving the selected highlight undimmed', () => {
    openMenu();
    const shell = screen.getByRole('option', { name: /\/shell/u });
    const help = screen.getByRole('option', { name: /\/help/u });

    fireEvent.mouseEnter(shell);

    expect(shell.getAttribute('aria-selected')).toBe('true');
    expect(shell.className).toContain('bg-hover');
    expect(opacitiesUpToMenu(shell)).toEqual([]);
    expect(screen.getByText('/shell').className).toContain('text-subtle');
    expect(screen.getByText('Open a shell').className).toContain('text-subtle');
    // A session command keeps its brighter name.
    expect(help.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('/help').className).toContain('text-foreground');
    expect(screen.getByText('/help').className).not.toContain('text-subtle');
  });
});

/**
 * #3280 §5: while the transport is not `connected`, nothing typed is lost — Enter and Send refuse to
 * submit, and the draft stays exactly as typed. Send explains why via an accessible description.
 */
describe('Composer — refuses to send while not connected', () => {
  afterEach(cleanup);

  it('Enter sends nothing and keeps the draft while disconnected', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} connected={false} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'are you there' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('are you there');
  });

  it('Send is disabled and says why while disconnected, even with text typed', () => {
    render(<Composer {...baseProps()} connected={false} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'hello' } });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(send.getAttribute('aria-description')).toBe('Not connected');
  });

  it('clicking Send does nothing while disconnected', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} connected={false} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('connected (the default) still sends on Enter and clears the draft', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-description')).toBeNull();
  });

  it('Stop is unavailable while disconnected too: an abort could not be delivered either', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} connected={false} />);
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(onStop).not.toHaveBeenCalled();
  });
});

/**
 * #3280 §2: while a turn runs the composer can stop it (button or Esc) instead of only waiting, and
 * a message the host queued behind the turn is visible and editable rather than silently swallowed.
 */
describe('Composer — stop a running turn', () => {
  afterEach(cleanup);

  it('shows Send (not Stop) while idle, and disables it for an empty draft', () => {
    render(<Composer {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Stop instead of Send while a turn runs, always enabled', () => {
    render(<Composer {...baseProps()} running />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop).toBeTruthy();
    expect(stop.disabled).toBe(false);
  });

  it('clicking Stop calls onStop', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('Esc in the composer stops a running turn', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} />);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('Esc does nothing while idle', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} onStop={onStop} />);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Esc closes the command menu instead of stopping, even while a turn runs', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'commands' })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'commands' })).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Enter still submits (queues) while a turn runs — the draft is not blocked', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} running onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'follow-up' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('follow-up');
    expect(input.value).toBe('');
  });
});

describe('Composer — queued message row', () => {
  afterEach(cleanup);

  it('shows nothing when nothing is queued', () => {
    render(<Composer {...baseProps()} />);
    expect(screen.queryByRole('status', { name: 'queued prompt' })).toBeNull();
  });

  it('shows the queued text, truncated to one line, with no "and N more" for a single entry', () => {
    render(<Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} />);
    const row = screen.getByRole('status', { name: 'queued prompt' });
    expect(row.textContent).toContain('Queued: ping the team');
    expect(row.textContent).not.toContain('more');
  });

  it('adds "and N more" when more than one prompt is queued', () => {
    render(<Composer {...baseProps()} queued={{ text: 'ping the team', count: 3 }} />);
    expect(screen.getByText(/and 2 more/)).toBeTruthy();
  });

  it('Remove sends cancel-queue', () => {
    const onCancelQueue = vi.fn();
    render(
      <Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} onCancelQueue={onCancelQueue} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onCancelQueue).toHaveBeenCalledTimes(1);
  });

  it('Edit sends cancel-queue and restores the text to the draft', () => {
    const onCancelQueue = vi.fn();
    render(
      <Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} onCancelQueue={onCancelQueue} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onCancelQueue).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('ping the team');
  });
});
