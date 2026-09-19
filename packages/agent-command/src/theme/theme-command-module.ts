import type {
  ICommandModule,
  ISystemCommand,
  TAppearanceSettingsPatch,
} from '@robota-sdk/agent-framework';
import type {
  ICommand,
  ICommandResult,
  ICommandSource,
  IThemeAppearanceState,
  IThemeCatalogueEntry,
  IThemeCataloguePort,
} from '@robota-sdk/agent-interface-command';

const THEME_DESCRIPTION =
  'List, preview or switch the terminal colour theme, and toggle syntax highlighting and motion';
const THEME_ARGUMENT_HINT = 'list | <theme-id> | syntax on|off | motion on|off';

const THEME_UNAVAILABLE = 'Themes are not available in this environment.';

function formatToggle(value: boolean): string {
  return value ? 'on' : 'off';
}

function formatCatalogue(catalogue: IThemeCataloguePort): string {
  const { settings, reducedMotionOverride, reducedMotionForRun } = catalogue.getAppearance();
  const rows = catalogue.listThemes().map((theme) => {
    const marker = theme.id === settings.theme ? '* ' : '  ';
    return `${marker}${theme.id} — ${theme.name} (${theme.appearance}, ${theme.source})`;
  });
  // Two facts, never one: what this run does, and what is saved. Reporting the SAVED value beside
  // the tier reads as a contradiction on a `--no-reduced-motion` run over a `true` setting, and as
  // an outright wrong answer to "is motion reduced right now".
  const motion = reducedMotionOverride
    ? `${formatToggle(reducedMotionForRun ?? settings.reducedMotion)} for this run (pinned by ${reducedMotionOverride}; saved ${formatToggle(settings.reducedMotion)})`
    : formatToggle(settings.reducedMotion);
  return [
    'Available themes:',
    ...rows,
    '',
    `syntax highlighting: ${formatToggle(settings.syntaxHighlighting)}`,
    `reduced motion: ${motion}`,
  ].join('\n');
}

function listResult(catalogue: IThemeCataloguePort): ICommandResult {
  return {
    success: true,
    message: formatCatalogue(catalogue),
    data: {
      themes: catalogue.listThemes().map((theme) => ({ ...theme })),
      appearance: { ...catalogue.getAppearance().settings },
    },
  };
}

function unknownThemeResult(id: string, catalogue: IThemeCataloguePort): ICommandResult {
  const known = catalogue
    .listThemes()
    .map((theme) => theme.id)
    .join(', ');
  return {
    success: false,
    message: `Unknown theme "${id}". Available: ${known || '(none)'}`,
  };
}

/** `on` / `off`, and nothing else — a typo must not read as its opposite. */
function parseToggle(word: string | undefined): boolean | undefined {
  if (word === 'on') return true;
  if (word === 'off') return false;
  return undefined;
}

interface IParsedThemeArgs {
  readonly patch?: TAppearanceSettingsPatch;
  readonly themeId?: string;
  readonly error?: string;
}

/**
 * `/theme <id> [syntax on|off] [motion on|off]`, or a bare `syntax`/`motion` toggle. The theme id is
 * NOT resolved here — parsing answers what was asked for, and the caller decides whether the
 * catalogue holds it, so an unknown id is reported with the catalogue rather than as a parse error.
 */
function parseThemeArgs(tokens: readonly string[]): IParsedThemeArgs {
  const patch: TAppearanceSettingsPatch = {};
  let index = 0;
  let themeId: string | undefined;
  if (tokens[0] !== 'syntax' && tokens[0] !== 'motion') {
    themeId = tokens[0];
    index = 1;
  }
  while (index < tokens.length) {
    const key = tokens[index];
    const value = parseToggle(tokens[index + 1]);
    if ((key !== 'syntax' && key !== 'motion') || value === undefined) {
      return { error: `Usage: /theme ${THEME_ARGUMENT_HINT}` };
    }
    if (key === 'syntax') patch.syntaxHighlighting = value;
    else patch.reducedMotion = !value;
    index += 2;
  }
  return { patch, ...(themeId === undefined ? {} : { themeId }) };
}

/**
 * `motion on` means "animate", which is `reducedMotion: false`. The inversion lives in one place
 * precisely because reading it backwards is the easy mistake — a user asking for motion and getting
 * stillness would look like the command doing nothing.
 */
function describeChange(
  patch: TAppearanceSettingsPatch,
  theme: IThemeCatalogueEntry | undefined,
  state: IThemeAppearanceState,
): string {
  const parts: string[] = [];
  if (theme) parts.push(`theme ${theme.name}`);
  if (patch.syntaxHighlighting !== undefined) {
    parts.push(`syntax highlighting ${formatToggle(patch.syntaxHighlighting)}`);
  }
  if (patch.reducedMotion !== undefined) {
    parts.push(`motion ${formatToggle(!patch.reducedMotion)}`);
  }
  const applied = parts.length > 0 ? `Applied: ${parts.join(', ')}.` : 'Nothing to change.';
  // The pin is reported, never silently obeyed or silently overridden: the setting IS persisted and
  // takes effect next run, while this run keeps what pinned it.
  if (patch.reducedMotion !== undefined && state.reducedMotionOverride) {
    return `${applied} Saved, but this run keeps reduced motion pinned by ${state.reducedMotionOverride}.`;
  }
  return applied;
}

export function executeThemeCommand(
  catalogue: IThemeCataloguePort | undefined,
  args: string,
): ICommandResult {
  if (!catalogue) return { success: false, message: THEME_UNAVAILABLE };

  const tokens = args.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) {
    return {
      success: true,
      message: 'Opening the theme picker...',
      uiIntents: [{ type: 'show-theme-picker' }],
    };
  }
  if (tokens.length === 1 && tokens[0] === 'list') return listResult(catalogue);

  const parsed = parseThemeArgs(tokens);
  if (parsed.error !== undefined || !parsed.patch) {
    return { success: false, message: parsed.error ?? `Usage: /theme ${THEME_ARGUMENT_HINT}` };
  }

  const patch = { ...parsed.patch };
  let theme: IThemeCatalogueEntry | undefined;
  if (parsed.themeId !== undefined) {
    theme = catalogue.getTheme(parsed.themeId);
    // An unknown id writes NOTHING — not the theme, and not the toggles submitted beside it.
    if (!theme) return unknownThemeResult(parsed.themeId, catalogue);
    patch.theme = theme.id;
  }

  return {
    success: true,
    message: describeChange(patch, theme, catalogue.getAppearance()),
    data: { appearance: { ...patch } },
    hostActions: [{ type: 'appearance-settings-patch', patch }],
  };
}

export function createThemeCommandEntry(): ICommand {
  return {
    name: 'theme',
    displayName: 'Theme',
    description: THEME_DESCRIPTION,
    argumentHint: THEME_ARGUMENT_HINT,
    source: 'theme',
    userInvocable: true,
    modelInvocable: false,
  };
}

export class ThemeCommandSource implements ICommandSource {
  readonly name = 'theme';

  getCommands(): ICommand[] {
    return [createThemeCommandEntry()];
  }
}

export function createThemeCommandModule(catalogue: IThemeCataloguePort): ICommandModule {
  const entry = createThemeCommandEntry();
  const command: ISystemCommand = {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    argumentHint: entry.argumentHint,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: (_context, args) => executeThemeCommand(catalogue, args),
  };
  return {
    name: 'agent-command-theme',
    commandSources: [new ThemeCommandSource()],
    systemCommands: [command],
  };
}
