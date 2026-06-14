import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';

import CommandConfirm from '../CommandConfirm.js';

import type { ITuiConfirmInteraction } from '../../command-interaction.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeInteraction(message: string): ITuiConfirmInteraction {
  return { onMissingArgs: 'confirm', message };
}

describe('CommandConfirm', () => {
  it('renders the message text', () => {
    const { lastFrame } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit the session?')}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(lastFrame()).toContain('Exit the session?');
  });

  it('calls onConfirm when y is pressed', () => {
    let confirmed = false;
    const { stdin } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit?')}
        onConfirm={() => {
          confirmed = true;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('y');
    expect(confirmed).toBe(true);
  });

  it('calls onConfirm when Y is pressed', () => {
    let confirmed = false;
    const { stdin } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit?')}
        onConfirm={() => {
          confirmed = true;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('Y');
    expect(confirmed).toBe(true);
  });

  it('calls onConfirm on Enter', () => {
    let confirmed = false;
    const { stdin } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit?')}
        onConfirm={() => {
          confirmed = true;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('\r');
    expect(confirmed).toBe(true);
  });

  it('calls onCancel when n is pressed', () => {
    let cancelled = false;
    const { stdin } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit?')}
        onConfirm={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('n');
    expect(cancelled).toBe(true);
  });

  it('calls onCancel when N is pressed', () => {
    let cancelled = false;
    const { stdin } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit?')}
        onConfirm={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('N');
    expect(cancelled).toBe(true);
  });

  it('calls onCancel on Escape', async () => {
    let cancelled = false;
    const { stdin } = render(
      <CommandConfirm
        commandName="exit"
        interaction={makeInteraction('Exit?')}
        onConfirm={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('\x1b');
    await delay(50);
    expect(cancelled).toBe(true);
  });
});
