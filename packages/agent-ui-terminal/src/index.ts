export { renderApp } from './render.js';
export { TuiInteractionChannel } from './TuiInteractionChannel.js';
export type { ITuiInteractionChannelOptions } from './TuiInteractionChannel.js';
export type { IRenderOptions } from './render.js';
export type { TScreenReaderChannel } from './screen-reader-announcement.js';
export type { ITuiCliAdapter } from './tui-cli-adapter.js';
export type { IDefaultTuiCliAdapterOptions } from './create-default-tui-cli-adapter.js';
export { createDefaultTuiCliAdapter } from './create-default-tui-cli-adapter.js';
export {
  createNodeKeybindingsSource,
  DEFAULT_KEYBINDINGS_DOCUMENT,
  KEYBINDINGS_SCHEMA_URL,
} from './keybindings/node-keybindings-source.js';
// SCREEN-2002: the product shell assembles one registry and hands it to both `/theme` and
// `renderApp`. The theme DATA stays unexported — a caller asks the registry, never a built-in.
export { createThemeCataloguePort, createThemeRegistry } from './theme/theme-registry.js';
// The product shell composes the registry, so it must be able to enumerate the built-ins, parse the
// files that join them, and build its OWN diagnostics through the same escaping policy. The
// accessor comes from the module that USES it rather than from the data module, which the
// anti-drift floor forbids naming outside `src/theme/`.
export { listBuiltInThemes } from './theme/theme-registry.js';
export {
  escapeThemeText,
  parseThemeDocument,
  quoteThemeText,
  sanitizeThemeProse,
} from './theme/theme-document.js';
export type {
  IThemeCataloguePortOptions,
  IThemeRegistry,
  IThemeResolution,
  IThemeSkip,
} from './theme/theme-registry.js';
export type { IThemeDocumentInput, TThemeDocumentResult } from './theme/theme-document.js';
// `createThemeRegistry` takes themes, so a caller must be able to name one.
export type { ITuiTheme, TThemeSource } from './theme/theme-contracts.js';
export type {
  IKeybindingsFilePort,
  IKeybindingsSource,
  INodeKeybindingsSourceOptions,
} from './keybindings/node-keybindings-source.js';
export type {
  IKeybindingDiagnostic,
  IKeybindingSnapshot,
  IKeybindingWarning,
  TKeybindingAction,
  TKeybindingContext,
} from './keybindings/keybinding-registry.js';
export type {
  TOnMissingArgsAction,
  ITuiPickerItem,
  ITuiCommandInteraction,
  ITuiPickerInteraction,
  ITuiConfirmInteraction,
  TAnyTuiCommandInteraction,
} from './command-interaction.js';
