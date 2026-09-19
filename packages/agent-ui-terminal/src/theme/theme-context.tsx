/**
 * SCREEN-2002 — the resolved theme, published to the tree.
 *
 * The `screen-reader-context` shape: one resolved value in a React context, defaulting to the `dark`
 * built-in outside a provider so a component rendered in a test behaves exactly as it did before the
 * theme existed. Components read `usePalette()` where they used to import `PALETTE`; nothing takes the
 * theme as a prop, so a missed prop cannot leave one component on another theme.
 */
import React, { createContext, useContext, useMemo } from 'react';

import { DARK_THEME } from './built-in-themes.js';
import { useScreenReader } from '../screen-reader-context.js';
import { isInteractiveColorTerminal } from '../terminal-capabilities.js';

import type { IThemeColors, IThemeMotion, ITuiTheme } from './theme-contracts.js';

const ThemeContext = createContext<ITuiTheme>(DARK_THEME);
const ReducedMotionContext = createContext<boolean>(false);

export function ThemeProvider({
  theme,
  reducedMotion = false,
  children,
}: {
  theme?: ITuiTheme;
  reducedMotion?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ThemeContext.Provider value={theme ?? DARK_THEME}>
      <ReducedMotionContext.Provider value={reducedMotion}>
        {children}
      </ReducedMotionContext.Provider>
    </ThemeContext.Provider>
  );
}

/** The whole resolved theme. Most components want {@link usePalette} instead. */
export function useTheme(): ITuiTheme {
  return useContext(ThemeContext);
}

/** The colour tokens — the direct replacement for the former `PALETTE` import. */
export function usePalette(): IThemeColors {
  return useTheme().colors;
}

/** The animation ramp — the direct replacement for the former `MOTION` import. */
export function useMotionTokens(): IThemeMotion {
  return useTheme().motion;
}

/**
 * May this process ANIMATE? One owner for a three-input rule, with exactly one consumer (`WaveText`,
 * the package's only animation). Deliberately NOT gating the background countdown (a once-a-second
 * number is content — freezing it would show a stale `in 59s`) or the streaming indicator's
 * screen-reader collapse (that drops content, which a sighted reduced-motion user still wants).
 */
export function useMotion(): boolean {
  const screenReader = useScreenReader();
  const reducedMotion = useContext(ReducedMotionContext);
  return useMemo(
    () => isInteractiveColorTerminal() && !screenReader && !reducedMotion,
    [reducedMotion, screenReader],
  );
}
