/** SCREEN-2002 — the theme module's internal surface (the package exports nothing from here yet). */
/**
 * The colour DATA (`DARK_THEME` and its siblings) is deliberately NOT re-exported: the anti-drift
 * floor forbids it outside `src/theme/`, and a barrel re-export would be the way around that. A
 * caller that needs a theme it did not receive asks {@link resolveTheme}.
 */
export { BUILT_IN_THEMES, DEFAULT_THEME_ID, resolveTheme } from './built-in-themes.js';
export {
  ThemeProvider,
  useMotion,
  useMotionTokens,
  usePalette,
  useTheme,
} from './theme-context.js';
export {
  background,
  diffRowStyles,
  foreground,
  isThemeColor,
  markdownRendererOptions,
  syntaxHighlightTheme,
} from './theme-styles.js';
export { THEME_SYNTAX_KEYS } from './theme-contracts.js';
export { simulate, simulatedDistance, toRgb } from './color-vision.js';
export type { IDiffRowStyles } from './theme-styles.js';
export type {
  IThemeColors,
  IThemeMarkdown,
  IThemeMotion,
  IThemeSyntax,
  ITuiTheme,
  TThemeAppearance,
  TThemeColor,
  TThemeSource,
} from './theme-contracts.js';
