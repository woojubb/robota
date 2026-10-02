// @vitest-environment jsdom
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HelpSheet } from '../HelpSheet.js';

import type { TCommandCatalog } from '../../hooks/session-client-types.js';

afterEach(cleanup);

const catalog: TCommandCatalog = {
  commands: [
    { name: 'mode', description: 'Change the permission mode', modelInvocable: false, runner: 'runtime' },
    { name: 'git', description: 'Show git status and diffs', modelInvocable: false, runner: 'runtime' },
    {
      name: 'shell',
      description: 'Open a shell',
      modelInvocable: false,
      runner: 'client',
      surfaces: ['terminal'],
    },
  ],
  skills: [
    { name: 'parity-demo', description: 'Demo skill', source: 'project', modelInvocable: true, userInvocable: true },
  ],
};

describe('HelpSheet (#3282 §4e)', () => {
  it('is not rendered while closed', () => {
    render(<HelpSheet open={false} onClose={vi.fn()} catalog={catalog} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists commands, grouped separately from skills, with descriptions', () => {
    render(<HelpSheet open onClose={vi.fn()} catalog={catalog} />);
    const sheet = screen.getByRole('dialog', { name: 'Help' });

    const commandsSection = within(sheet).getByLabelText('Commands');
    expect(within(commandsSection).getByText('/mode')).toBeTruthy();
    expect(within(commandsSection).getByText('Change the permission mode')).toBeTruthy();
    expect(within(commandsSection).getByText('/git')).toBeTruthy();

    const skillsSection = within(sheet).getByLabelText('Skills');
    expect(within(skillsSection).getByText('/parity-demo')).toBeTruthy();
    expect(within(skillsSection).getByText('Demo skill')).toBeTruthy();
  });

  it('leaves out a command the GUI cannot run at all, same as the slash menu', () => {
    render(<HelpSheet open onClose={vi.fn()} catalog={catalog} />);
    const sheet = screen.getByRole('dialog', { name: 'Help' });
    expect(within(sheet).queryByText('/shell')).toBeNull();
  });

  it('lists the keyboard shortcuts this surface answers', () => {
    render(<HelpSheet open onClose={vi.fn()} catalog={catalog} />);
    const sheet = screen.getByRole('dialog', { name: 'Help' });
    const shortcuts = within(sheet).getByLabelText('Shortcuts');
    expect(within(shortcuts).getByText('⌘,')).toBeTruthy();
    expect(within(shortcuts).getByText('Esc')).toBeTruthy();
    expect(within(shortcuts).getByText('Shift+Tab')).toBeTruthy();
    expect(within(shortcuts).getByText('Enter')).toBeTruthy();
    expect(within(shortcuts).getByText('Shift+Enter')).toBeTruthy();
  });

  it('omits the Skills section entirely when there are none', () => {
    render(<HelpSheet open onClose={vi.fn()} catalog={{ ...catalog, skills: [] }} />);
    const sheet = screen.getByRole('dialog', { name: 'Help' });
    expect(within(sheet).queryByLabelText('Skills')).toBeNull();
  });

  it('Close calls onClose', () => {
    const onClose = vi.fn();
    render(<HelpSheet open onClose={onClose} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close Help' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
