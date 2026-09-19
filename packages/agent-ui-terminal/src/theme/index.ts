/** SCREEN-2002 — the theme module's internal surface (the package exports nothing from here yet). */
/**
 * The colour DATA is deliberately NOT re-exported — neither the individual themes nor the array that
 * holds them. The anti-drift floor forbids naming them outside `src/theme/`, and a barrel re-export
 * would be the way around that. The two legitimate needs get accessors instead: a caller that must
 * render without a resolved theme asks {@link resolveTheme}, and one that must ENUMERATE the
 * built-ins asks {@link listBuiltInThemes}.
 */
export { DEFAULT_THEME_ID, listBuiltInThemes, resolveTheme } from './built-in-themes.js';
export {
  ThemeProvider,
  useMotion,
  useMotionTokens,
  usePalette,
  useSyntaxHighlighting,
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
export { parseThemeDocument, quoteThemeText, sanitizeThemeProse } from './theme-document.js';
export type { IThemeDocumentInput, TThemeDocumentResult } from './theme-document.js';
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
