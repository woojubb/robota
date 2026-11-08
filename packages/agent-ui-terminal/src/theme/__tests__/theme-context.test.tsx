/**
 * SCREEN-2002 TC-05/TC-06 — the resolved theme reaches components, and motion has one owner.
 *
 * The reduced-motion input is the accessibility setting this item exists for, so it is asserted
 * against the component that consumes it rather than against the hook in isolation: `WaveText` must
 * stop scheduling entirely, not merely look still.
 */
import chalk from 'chalk';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppBanner } from '../../app-banner.js';
import WaveText from '../../WaveText.js';
import { DARK_THEME, LIGHT_THEME } from '../built-in-themes.js';
// Through the BARREL, deliberately: the module's export surface is what every consumer outside
// `src/theme/` reaches, and an export dropped from it is a runtime `undefined` rather than a type
// error at the call site. Importing from `theme-context.js` here would leave that surface unguarded.
import { useSyntaxHighlighting } from '../index.js';
import { ThemeProvider } from '../theme-context.js';
import { foreground } from '../theme-styles.js';

const gateMock = vi.hoisted(() => ({ value: true }));
vi.mock('../../terminal-capabilities.js', () => ({
  isInteractiveColorTerminal: (): boolean => gateMock.value,
  supportsImeCursorPositioning: (): boolean => false,
  supportsFocusReporting: (): boolean => false,
}));

const WAVE_INTERVAL_MS = 400;

afterEach(() => {
  gateMock.value = true;
  vi.useRealTimers();
});

describe('reduced motion (SCREEN-2002 TC-06)', () => {
  const originalLevel = chalk.level;
  const TRUECOLOR = 3;
  beforeAll(() => {
    chalk.level = TRUECOLOR;
  });
  afterAll(() => {
    chalk.level = originalLevel;
  });

  it('stops the animation without stopping colour, and schedules no interval at all', () => {
    vi.useFakeTimers();
    const { lastFrame, unmount } = render(
      <ThemeProvider reducedMotion>
        <WaveText text="Waiting" />
      </ThemeProvider>,
    );
    const first = lastFrame() ?? '';
    // The whole point: no timer is armed, so nothing repaints.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(WAVE_INTERVAL_MS * 5);
    const later = lastFrame() ?? '';
    unmount();
    expect(later).toBe(first);
    // Colour is untouched — reduced motion is orthogonal to the colour gate. The frame is the
    // canonical MUTED token, not an uncoloured one and not a stopped ramp stop.
    expect(first).toContain('Waiting');
    expect(first).toContain(openCode(DARK_THEME.colors.text.muted));
    for (const stop of DARK_THEME.motion.wave) {
      expect(first).not.toContain(openCode(stop));
    }
  });

  it('animates when reduced motion is off', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <ThemeProvider>
        <WaveText text="Waiting" />
      </ThemeProvider>,
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
  });

  it('stays still when the colour gate is off, whatever the setting', () => {
    gateMock.value = false;
    vi.useFakeTimers();
    const { unmount } = render(
      <ThemeProvider>
        <WaveText text="Waiting" />
      </ThemeProvider>,
    );
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });
});

describe('a provided theme reaches components (SCREEN-2002 TC-05)', () => {
  // These assertions are about the emitted SGR, so the level is forced for them.
  const originalLevel = chalk.level;
  const TRUECOLOR = 3;
  beforeAll(() => {
    chalk.level = TRUECOLOR;
  });
  afterAll(() => {
    chalk.level = originalLevel;
  });

  it('renders the provided theme’s colours, not the default built-in’s', () => {
    const themed = render(
      <ThemeProvider theme={LIGHT_THEME}>
        <AppBanner version="1.2.3" />
      </ThemeProvider>,
    ).lastFrame();
    const unthemed = render(<AppBanner version="1.2.3" />).lastFrame();
    expect(themed).not.toBe(unthemed);
    expect(themed ?? '').toContain(openCode(LIGHT_THEME.colors.text.accent));
  });
});

function openCode(color: string): string {
  const [open] = foreground(color)('x').split('x');
  return open ?? '';
}

/**
 * SCREEN-2002: `/theme syntax off` persisted a setting that reached nothing until this travelled
 * with the theme — the command reported success for a no-op. So the assertion is that the value
 * ARRIVES at a consumer, not merely that the provider accepts it.
 */
describe('syntax highlighting travels with the theme (SCREEN-2002 TC-03)', () => {
  function Probe(): React.ReactElement {
    return <Text>{`syntax:${String(useSyntaxHighlighting())}`}</Text>;
  }

  it('defaults to on outside a provider, so today s rendering is unchanged', () => {
    expect(render(<Probe />).lastFrame()).toContain('syntax:true');
  });

  it('carries false to a consumer when the appearance says off', () => {
    const frame = render(
      <ThemeProvider syntaxHighlighting={false}>
        <Probe />
      </ThemeProvider>,
    ).lastFrame();

    expect(frame).toContain('syntax:false');
  });
});
