/**
 * SCREEN-2002 TC-10 — the theme picker.
 *
 * Preview-on-move is the behaviour worth pinning: the highlighted row IS the live region's theme
 * while the picker is open, so moving the highlight must call `preview` and LEAVING must not
 * persist it. Selecting does not write — it submits `/theme <id>` through the normal command path,
 * which is what keeps the host the only writer of the settings document.
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScreenReaderProvider } from '../screen-reader-context.js';

const gateMock = vi.hoisted(() => ({ value: true }));
// Spread the real module and override ONE export: a hand-listed factory silently drops whatever
// the module gains later, and the failure lands as "not a function" in an unrelated file.
vi.mock('../terminal-capabilities.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terminal-capabilities.js')>()),
  isInteractiveColorTerminal: (): boolean => gateMock.value,
}));

afterEach(() => {
  gateMock.value = true;
});
import { DARK_THEME, LIGHT_THEME, listBuiltInThemes } from '../theme/built-in-themes.js';
import ThemePicker from '../ThemePicker.js';

import type { IAppThemePickerViewModel } from '../hooks/useAppThemeState.js';

const ARROW_DOWN = '\x1b[B';
const ARROW_UP = '\x1b[A';
const ENTER = '\r';
const ESCAPE = '\x1b';

function picker(overrides: Partial<IAppThemePickerViewModel> = {}): IAppThemePickerViewModel {
  return {
    visible: true,
    themes: listBuiltInThemes(),
    skipped: [],
    activeThemeId: 'dark',
    syntaxHighlighting: true,
    reducedMotion: false,
    preview: vi.fn(),
    select: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('the theme picker (SCREEN-2002 TC-10)', () => {
  it('lists every theme with its appearance and source, and marks the active one', () => {
    const frame = render(<ThemePicker picker={picker()} />).lastFrame() ?? '';

    expect(frame).toContain(`${DARK_THEME.name} — dark, built-in (current)`);
    expect(frame).toContain(`${LIGHT_THEME.name} — light, built-in`);
    expect(frame).not.toContain(`${LIGHT_THEME.name} — light, built-in (current)`);
  });

  it('starts focused on the ACTIVE theme, not on the first row', async () => {
    const view = picker({ activeThemeId: 'dark-daltonized' });
    const { stdin } = render(<ThemePicker picker={view} />);
    await tick();

    stdin.write(ARROW_DOWN);
    await tick();

    // From `dark-daltonized` (index 2), down lands on `light-daltonized` — not on `light`.
    expect(view.preview).toHaveBeenCalledWith('light-daltonized');
  });

  it('previews on move, and does not select or cancel while moving', async () => {
    const view = picker();
    const { stdin } = render(<ThemePicker picker={view} />);
    await tick();

    stdin.write(ARROW_DOWN);
    await tick();

    expect(view.preview).toHaveBeenCalledWith('light');
    expect(view.select).not.toHaveBeenCalled();
    expect(view.cancel).not.toHaveBeenCalled();
  });

  it('wraps at both ends rather than stopping', async () => {
    const view = picker();
    const { stdin } = render(<ThemePicker picker={view} />);
    await tick();

    stdin.write(ARROW_UP);
    await tick();

    expect(view.preview).toHaveBeenCalledWith('light-daltonized');
  });

  it('selects the focused row, and selects the PREVIEWED one after moving', async () => {
    const view = picker();
    const { stdin } = render(<ThemePicker picker={view} />);
    await tick();

    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(view.select).toHaveBeenCalledWith('light', {
      syntaxHighlighting: true,
      reducedMotion: false,
    });
    expect(view.select).toHaveBeenCalledTimes(1);
  });

  it('cancels on escape WITHOUT selecting — the persisted theme is what remains', async () => {
    const view = picker();
    const { stdin } = render(<ThemePicker picker={view} />);
    await tick();

    stdin.write(ARROW_DOWN);
    await tick();
    stdin.write(ESCAPE);
    await tick();

    expect(view.cancel).toHaveBeenCalledTimes(1);
    expect(view.select).not.toHaveBeenCalled();
  });

  it('toggles syntax and motion locally, and submits them WITH the theme as one patch', async () => {
    const view = picker();
    const { stdin, lastFrame } = render(<ThemePicker picker={view} />);
    await tick();

    expect(lastFrame() ?? '').toContain('syntax on · motion on');
    stdin.write('s');
    await tick();
    stdin.write('m');
    await tick();
    expect(lastFrame() ?? '').toContain('syntax off · motion off');
    // Nothing is written until select — a toggle is pending, like the previewed theme.
    expect(view.select).not.toHaveBeenCalled();

    stdin.write(ENTER);
    await tick();

    expect(view.select).toHaveBeenCalledWith('dark', {
      syntaxHighlighting: false,
      reducedMotion: true,
    });
  });

  it('abandons pending toggles on escape, exactly as it abandons the preview', async () => {
    const view = picker();
    const { stdin } = render(<ThemePicker picker={view} />);
    await tick();

    stdin.write('s');
    await tick();
    stdin.write(ESCAPE);
    await tick();

    expect(view.cancel).toHaveBeenCalledTimes(1);
    expect(view.select).not.toHaveBeenCalled();
  });

  it('seeds the toggles from what is PERSISTED, not from the defaults', async () => {
    const view = picker({ syntaxHighlighting: false, reducedMotion: true });
    const { lastFrame } = render(<ThemePicker picker={view} />);
    await tick();

    expect(lastFrame() ?? '').toContain('syntax off · motion off');
  });

  it('admits a motion pin, so the row cannot read `motion on` on a visibly still run', () => {
    const frame =
      render(
        <ThemePicker picker={picker({ reducedMotion: true, reducedMotionOverride: 'flag' })} />,
      ).lastFrame() ?? '';

    expect(frame).toContain('motion off (pinned by flag)');
  });

  it('says previews cannot show when colour is off, rather than looking broken', () => {
    gateMock.value = false;

    const frame = render(<ThemePicker picker={picker()} />).lastFrame() ?? '';

    expect(frame).toContain('Colour is off for this terminal');
  });

  it('renders the empty state rather than an empty box', () => {
    const frame = render(<ThemePicker picker={picker({ themes: [] })} />).lastFrame() ?? '';

    expect(frame).toContain('No themes installed');
  });
});

describe('the theme picker in screen-reader mode (SCREEN-2002 TC-10)', () => {
  function renderInMode(view: IAppThemePickerViewModel): ReturnType<typeof render> {
    return render(
      <ScreenReaderProvider enabled>
        <ThemePicker picker={view} />
      </ScreenReaderProvider>,
    );
  }

  it('numbers the rows and prompts for a typed answer instead of drawing a highlight', () => {
    const frame = renderInMode(picker()).lastFrame() ?? '';

    expect(frame).toContain('1.');
    expect(frame).toContain('4.');
    // No box-drawing chrome in the mode.
    expect(frame).not.toMatch(/[─-╿]/u);
  });

  it('applies on SELECT and never previews per keystroke — there is no highlight to hear', async () => {
    const view = picker();
    const { stdin } = renderInMode(view);
    await tick();

    stdin.write('2');
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(view.select).toHaveBeenCalledWith('light', {
      syntaxHighlighting: true,
      reducedMotion: false,
    });
    expect(view.preview).not.toHaveBeenCalled();
  });

  it('cancels on the mode s own cancel path', async () => {
    const view = picker();
    const { stdin } = renderInMode(view);
    await tick();

    stdin.write(ESCAPE);
    await tick();

    expect(view.cancel).toHaveBeenCalledTimes(1);
    expect(view.select).not.toHaveBeenCalled();
  });
});

describe('the theme picker over files it refused (SCREEN-2002 TC-11)', () => {
  const skipped = [
    { id: 'custom:broken', fileName: 'broken.json', reason: '$.overrides.colors.text.accent: bad' },
  ];

  it('shows a refused file as a row that carries its reason and cannot be chosen', async () => {
    const view = picker({ skipped });
    const { lastFrame, stdin } = render(<ThemePicker picker={view} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('broken.json');
    expect(frame).toContain('$.overrides.colors.text.accent: bad');

    // Walking past the end of the applicable rows wraps to the first one; it never lands on a file
    // the run has already refused, because selecting it could only fail.
    await tick();
    for (let index = 0; index <= listBuiltInThemes().length; index += 1) {
      stdin.write(ARROW_DOWN);
      await tick();
    }
    stdin.write(ENTER);
    await tick();

    expect(view.select).toHaveBeenCalledTimes(1);
    const [selectedId] = (view.select as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(listBuiltInThemes().map((theme) => theme.id)).toContain(selectedId);
  });

  it('says nothing about skipped files when there are none', () => {
    expect(render(<ThemePicker picker={picker()} />).lastFrame() ?? '').not.toContain('Skipped');
  });

  it('numbers only the applicable rows in screen-reader mode', async () => {
    const view = picker({ skipped });
    const { lastFrame, stdin } = render(
      <ScreenReaderProvider enabled>
        <ThemePicker picker={view} />
      </ScreenReaderProvider>,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('broken.json');
    expect(frame).not.toMatch(/5\.\s*Skipped/u);

    await tick();
    stdin.write('5');
    await tick();
    stdin.write(ENTER);
    await tick();

    expect(view.select).not.toHaveBeenCalled();
  });
});

describe('the toggles row names a route the mode can take (SCREEN-2002 TC-11)', () => {
  it('names the commands in screen-reader mode, where `s` and `m` are not bound', () => {
    const frame =
      render(
        <ScreenReaderProvider enabled>
          <ThemePicker picker={picker()} />
        </ScreenReaderProvider>,
      ).lastFrame() ?? '';

    expect(frame).toContain('syntax on · motion on');
    expect(frame).toContain('/theme syntax on|off');
    expect(frame).toContain('/theme motion on|off');
  });

  it('does NOT name them in sighted mode, where the keys are bound and hinted', () => {
    const frame = render(<ThemePicker picker={picker()} />).lastFrame() ?? '';

    expect(frame).toContain('syntax on · motion on');
    expect(frame).not.toContain('/theme syntax');
  });
});
