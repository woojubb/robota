// @vitest-environment jsdom
/**
 * #3282 §2 (part 2) — the model, mode and effort pop-up menus under the composer: a HIG pop-up menu
 * per control, grouped/labelled per the decided design, with a checkmark on the current value.
 * Choosing a model/mode/effort runs the same path the equivalent typed command would (`onSilentCommand`
 * for a plain apply — the label itself confirms the change, no conversation card); "Manage providers…"
 * (the model menu's last item) opens Settings at the Providers & Models section instead (#3282 §4b,
 * `onManageProviders`).
 */
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusRow } from '../StatusControls.js';

import type { TCommandCatalog, TModelListSnapshot, TSessionStatus } from '../../hooks/session-client-types.js';

afterEach(cleanup);

function statusFor(overrides: Partial<TSessionStatus> = {}): TSessionStatus {
  return {
    sessionId: 's1',
    model: 'claude-sonnet-4-6',
    permissionMode: 'default',
    effort: 'auto',
    context: { usedPercentage: 12, usedTokens: 24000, maxTokens: 200000, remainingPercentage: 88 },
    goal: null,
    ...overrides,
  } as TSessionStatus;
}

const catalog: TCommandCatalog = {
  commands: [
    {
      name: 'mode',
      description: 'Show or change the permission mode',
      modelInvocable: false,
      runner: 'runtime',
      subcommands: [
        { name: 'plan', displayName: 'Plan only', description: 'Plan only, no execution' },
        { name: 'default', displayName: 'Ask first', description: 'Ask before risky actions' },
        { name: 'acceptEdits', displayName: 'Accept edits', description: 'Auto-approve file edits' },
        {
          name: 'bypassPermissions',
          displayName: 'Skip all checks',
          description: 'Skip all permission checks',
        },
        {
          name: 'auto',
          displayName: 'Auto',
          description: 'A model classifier approves or blocks risky actions',
        },
      ],
    },
  ],
  skills: [],
};

const modelList: TModelListSnapshot = {
  groups: [
    {
      profileName: 'anthropic',
      providerLabel: 'Anthropic',
      models: [
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      ],
    },
    {
      profileName: 'my-openai',
      providerLabel: 'OpenAI',
      models: [{ id: 'gpt-5.1', label: 'GPT-5.1' }],
    },
  ],
  currentProfile: 'anthropic',
  currentModel: 'claude-sonnet-4-6',
};

function baseProps(overrides: Partial<React.ComponentProps<typeof StatusRow>> = {}) {
  return {
    status: statusFor(),
    catalog,
    modelList,
    onRequestModelList: vi.fn(),
    onManageProviders: vi.fn(),
    onSilentCommand: vi.fn(),
    connected: true,
    ...overrides,
  };
}

describe('StatusRow — model control', () => {
  it('opens a pop-up menu grouped by provider, with section headers', () => {
    render(<StatusRow {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'model: claude-sonnet-4-6' }));

    const menu = screen.getByRole('menu', { name: 'Model' });
    expect(within(menu).getByText('Anthropic')).toBeTruthy();
    expect(within(menu).getByText('OpenAI')).toBeTruthy();
    expect(within(menu).getByRole('menuitemradio', { name: 'Claude Sonnet 4.6' })).toBeTruthy();
    expect(within(menu).getByRole('menuitemradio', { name: 'Claude Haiku 4.5' })).toBeTruthy();
    expect(within(menu).getByRole('menuitemradio', { name: 'GPT-5.1' })).toBeTruthy();
  });

  it('checks the current model only', () => {
    render(<StatusRow {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'model: claude-sonnet-4-6' }));

    expect(
      screen.getByRole('menuitemradio', { name: 'Claude Sonnet 4.6' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Claude Haiku 4.5' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('choosing a model runs the same path as /model <id> — sent silently, never opening Settings', () => {
    const onSilentCommand = vi.fn();
    const onManageProviders = vi.fn();
    render(<StatusRow {...baseProps({ onSilentCommand, onManageProviders })} />);
    fireEvent.click(screen.getByRole('button', { name: 'model: claude-sonnet-4-6' }));

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Claude Haiku 4.5' }));

    expect(onSilentCommand).toHaveBeenCalledWith('model', 'claude-haiku-4-5');
    expect(onManageProviders).not.toHaveBeenCalled();
  });

  it('the last item is "Manage providers…", which opens Settings at the Providers & Models section', () => {
    const onManageProviders = vi.fn();
    const onSilentCommand = vi.fn();
    render(<StatusRow {...baseProps({ onManageProviders, onSilentCommand })} />);
    fireEvent.click(screen.getByRole('button', { name: 'model: claude-sonnet-4-6' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage providers…' }));

    expect(onManageProviders).toHaveBeenCalledWith();
    expect(onSilentCommand).not.toHaveBeenCalled();
  });

  it('requests a fresh model list when the menu opens', () => {
    const onRequestModelList = vi.fn();
    render(<StatusRow {...baseProps({ onRequestModelList })} />);
    fireEvent.click(screen.getByRole('button', { name: 'model: claude-sonnet-4-6' }));

    expect(onRequestModelList).toHaveBeenCalled();
  });
});

describe('StatusRow — mode control', () => {
  it('shows the plain label with its description underneath for every mode', () => {
    render(<StatusRow {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^mode:/ }));

    const menu = screen.getByRole('menu', { name: 'Mode' });
    expect(within(menu).getByRole('menuitemradio', { name: 'Plan only' })).toBeTruthy();
    expect(within(menu).getByText('Plan only, no execution')).toBeTruthy();
    expect(within(menu).getByRole('menuitemradio', { name: 'Skip all checks' })).toBeTruthy();
    expect(within(menu).getByText('Skip all permission checks')).toBeTruthy();
  });

  it('checks the current mode only', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ permissionMode: 'acceptEdits' }) })} />);
    fireEvent.click(screen.getByRole('button', { name: /^mode:/ }));

    expect(
      screen.getByRole('menuitemradio', { name: 'Accept edits' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Ask first' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('the chip itself shows the plain label, not the raw id', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ permissionMode: 'acceptEdits' }) })} />);
    expect(screen.getByRole('button', { name: 'mode: Accept edits' })).toBeTruthy();
  });

  it('choosing a non-destructive mode sends it silently', () => {
    const onSilentCommand = vi.fn();
    render(<StatusRow {...baseProps({ onSilentCommand })} />);
    fireEvent.click(screen.getByRole('button', { name: /^mode:/ }));

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Plan only' }));

    expect(onSilentCommand).toHaveBeenCalledWith('mode', 'plan');
  });

  describe('"Skip all checks" asks for confirmation first', () => {
    it('choosing it does not apply the mode yet — a confirmation appears instead', () => {
      const onSilentCommand = vi.fn();
      render(<StatusRow {...baseProps({ onSilentCommand })} />);
      fireEvent.click(screen.getByRole('button', { name: /^mode:/ }));

      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Skip all checks' }));

      expect(onSilentCommand).not.toHaveBeenCalled();
      expect(screen.getByRole('alertdialog', { name: 'Skip all permission checks?' })).toBeTruthy();
    });

    it('Cancel keeps the mode unchanged', () => {
      const onSilentCommand = vi.fn();
      render(<StatusRow {...baseProps({ onSilentCommand })} />);
      fireEvent.click(screen.getByRole('button', { name: /^mode:/ }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Skip all checks' }));

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onSilentCommand).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('confirming applies bypassPermissions silently and marks the chip', () => {
      const onSilentCommand = vi.fn();
      const { rerender } = render(<StatusRow {...baseProps({ onSilentCommand })} />);
      fireEvent.click(screen.getByRole('button', { name: /^mode:/ }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Skip all checks' }));

      fireEvent.click(screen.getByRole('button', { name: 'Skip all checks' }));

      expect(onSilentCommand).toHaveBeenCalledWith('mode', 'bypassPermissions');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      // The label itself confirms the change once `session_status` reflects it — simulated here by
      // re-rendering with the new status, as the real chip does after its `get-status` refresh.
      rerender(<StatusRow {...baseProps({ onSilentCommand, status: statusFor({ permissionMode: 'bypassPermissions' }) })} />);
      expect(screen.getByRole('button', { name: 'mode: Skip all checks' }).className).toMatch(/warning/);
    });
  });

  it('the chip carries a warning style while Skip all checks is on', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ permissionMode: 'bypassPermissions' }) })} />);
    const chip = screen.getByRole('button', { name: 'mode: Skip all checks' });
    expect(chip.className).toMatch(/warning/);
  });

  it('does not carry the warning style for an ordinary mode', () => {
    render(<StatusRow {...baseProps()} />);
    const chip = screen.getByRole('button', { name: /^mode:/ });
    expect(chip.className).not.toMatch(/warning/);
  });
});

describe('StatusRow — effort control', () => {
  it('shows Auto, Low, Medium, High directly, and None/Minimal/Extra high/Maximum under "More"', () => {
    render(<StatusRow {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^effort:/ }));

    const menu = screen.getByRole('menu', { name: 'Effort' });
    for (const label of ['Auto', 'Low', 'Medium', 'High']) {
      expect(within(menu).getByRole('menuitemradio', { name: label })).toBeTruthy();
    }
    expect(within(menu).getByText('More')).toBeTruthy();
    for (const label of ['None', 'Minimal', 'Extra high', 'Maximum']) {
      expect(within(menu).getByRole('menuitemradio', { name: label })).toBeTruthy();
    }
  });

  it('checks the current effort only', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ effort: 'xhigh' }) })} />);
    fireEvent.click(screen.getByRole('button', { name: /^effort:/ }));

    expect(
      screen.getByRole('menuitemradio', { name: 'Extra high' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Auto' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('the chip shows the plain label even when the current value is under "More"', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ effort: 'xhigh' }) })} />);
    expect(screen.getByRole('button', { name: 'effort: Extra high' })).toBeTruthy();
  });

  it('choosing an effort level sends it silently', () => {
    const onSilentCommand = vi.fn();
    render(<StatusRow {...baseProps({ onSilentCommand })} />);
    fireEvent.click(screen.getByRole('button', { name: /^effort:/ }));

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));

    expect(onSilentCommand).toHaveBeenCalledWith('effort', 'high');
  });
});

/**
 * #3289 §2 — below `md` (768px, the same breakpoint the session-list sheet collapses at) the status
 * chips collapse to their icon alone: at 390px CSS px they used to truncate to "d…"/"claude-…"/"a…".
 * jsdom does not evaluate media queries, so this asserts the responsive classes themselves (`hidden`
 * by default, `md:inline` restoring the text at the wider breakpoint) rather than actual layout — the
 * e2e scenario at 390×800 in `web-e2e.mjs` is what actually renders the collapse and checks nothing
 * overflows or covers the composer.
 */
describe('StatusRow — collapses to icons below the md breakpoint (#3289 §2)', () => {
  it("hides each chip's value text by default and restores it only at md and up", () => {
    render(<StatusRow {...baseProps()} />);

    for (const name of [/^model:/, /^mode:/, /^effort:/]) {
      const chip = screen.getByRole('button', { name });
      const valueText = chip.querySelector('span:last-child');
      expect(valueText?.className).toContain('hidden');
      expect(valueText?.className).toContain('md:inline');
    }
  });

  it('keeps the full accessible name and a tooltip carrying the value, regardless of width', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ effort: 'xhigh' }) })} />);

    const effortChip = screen.getByRole('button', { name: 'effort: Extra high' });
    expect(effortChip.title).toBe('effort: Extra high');
  });

  it('the icon (not just the now-hidden text) carries the warning mark while Skip all checks is on', () => {
    render(<StatusRow {...baseProps({ status: statusFor({ permissionMode: 'bypassPermissions' }) })} />);

    const modeChip = screen.getByRole('button', { name: 'mode: Skip all checks' });
    // The icon has no color class of its own — it inherits the button's `text-warning` via
    // `currentColor`, so the chip's own class carrying the warning mark IS what keeps it on the icon.
    expect(modeChip.className).toMatch(/warning/);
    expect(modeChip.querySelector('svg')).toBeTruthy();
  });

  it('the menu still opens from the collapsed (icon-only) chip', () => {
    render(<StatusRow {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /^effort:/ }));

    expect(screen.getByRole('menu', { name: 'Effort' })).toBeTruthy();
  });
});

describe('StatusRow — disabled while disconnected', () => {
  it('disables every chip and gives a short "Reconnecting…" tooltip', () => {
    render(<StatusRow {...baseProps({ connected: false })} />);

    for (const name of [/^model:/, /^mode:/, /^effort:/]) {
      const chip = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
      expect(chip.title).toBe('Reconnecting…');
    }
  });

  it('a disabled chip does not open its menu', () => {
    render(<StatusRow {...baseProps({ connected: false })} />);
    fireEvent.click(screen.getByRole('button', { name: /^model:/ }));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
