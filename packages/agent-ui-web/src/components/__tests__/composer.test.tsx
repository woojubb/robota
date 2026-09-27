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

function openMenu(): void {
  render(<Composer onSubmit={vi.fn()} onCommand={vi.fn()} catalog={catalog} status={null} />);
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
    render(
      <Composer onSubmit={onSubmit} onCommand={vi.fn()} catalog={null} status={null} connected={false} />,
    );
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'are you there' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('are you there');
  });

  it('Send is disabled and says why while disconnected, even with text typed', () => {
    render(<Composer onSubmit={vi.fn()} onCommand={vi.fn()} catalog={null} status={null} connected={false} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'hello' } });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(send.getAttribute('aria-description')).toBe('Not connected');
  });

  it('clicking Send does nothing while disconnected', () => {
    const onSubmit = vi.fn();
    render(
      <Composer onSubmit={onSubmit} onCommand={vi.fn()} catalog={null} status={null} connected={false} />,
    );
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('connected (the default) still sends on Enter and clears the draft', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} onCommand={vi.fn()} catalog={null} status={null} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-description')).toBeNull();
  });
});
