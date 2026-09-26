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
    expect(shell.className).toContain('bg-primary/10');
    expect(opacitiesUpToMenu(shell)).toEqual([]);
    expect(screen.getByText('/shell').className).toContain('text-muted-foreground');
    expect(screen.getByText('Open a shell').className).toContain('text-muted-foreground/70');
    // A session command keeps its brighter name.
    expect(help.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('/help').className).toContain('text-foreground/90');
  });
});
