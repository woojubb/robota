/** SCREEN-2002 — the theme module's internal surface (the package exports nothing from here yet). */
export { BUILT_IN_THEMES, DARK_THEME, DEFAULT_THEME_ID } from './built-in-themes.js';
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
