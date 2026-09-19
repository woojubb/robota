export const KEYBINDING_ACTIONS = {
  app: ['open-workspace-switcher'],
  thinking: ['abort'],
  'background-detail': ['return-to-main'],
  recovery: ['retry'],
  'chat-input': [
    'submit',
    'history-previous',
    'history-next',
    'history-search',
    'cursor-left',
    'cursor-right',
    'delete-backward',
    'delete-word',
    'delete-line',
  ],
  'text-input': [
    'submit',
    'cursor-left',
    'cursor-right',
    'cursor-up',
    'cursor-down',
    'delete-backward',
    'delete-word',
    'delete-line',
  ],
  'autocomplete-menu': ['previous', 'next', 'close', 'accept', 'execute'],
  'queued-prompt': ['cancel'],
  'confirm-prompt': ['previous', 'next', 'confirm', 'choose-yes', 'choose-no'],
  'permission-prompt': [
    'previous',
    'next',
    'confirm',
    'allow-once',
    'allow-session',
    'allow-project',
    'deny',
  ],
  'text-prompt': ['submit', 'cancel', 'delete-backward'],
  'list-picker': ['previous', 'next', 'select', 'cancel'],
  'menu-select': ['previous', 'next', 'select', 'back'],
  'multi-select': ['previous', 'next', 'toggle', 'confirm', 'cancel'],
  'workspace-switcher': ['previous', 'next', 'select', 'close', 'attach'],
  'background-list': ['previous', 'next', 'open', 'close'],
  'transport-settings': ['previous', 'next', 'toggle', 'close'],
  /** SCREEN-1993: the reverse prompt-history search overlay. */
  'history-search': ['previous', 'next', 'cycle-scope', 'insert', 'execute', 'cancel'],
  /** SCREEN-2002: the theme picker. Navigation PREVIEWS; only `select` applies. */
  'theme-picker': ['previous', 'next', 'select', 'cancel'],
} as const;

export type TKeybindingContext = keyof typeof KEYBINDING_ACTIONS;
export type TKeybindingAction<TContext extends TKeybindingContext = TKeybindingContext> =
  (typeof KEYBINDING_ACTIONS)[TContext][number];

type TDefaultKeybindings = {
  readonly [TContext in TKeybindingContext]: Readonly<
    Record<TKeybindingAction<TContext>, readonly string[]>
  >;
};

export const DEFAULT_KEYBINDINGS = {
  app: { 'open-workspace-switcher': ['ctrl+b'] },
  thinking: { abort: ['escape'] },
  'background-detail': { 'return-to-main': ['escape'] },
  recovery: { retry: ['enter'] },
  'chat-input': {
    submit: ['enter'],
    'history-previous': ['up'],
    'history-next': ['down'],
    'history-search': ['ctrl+r'],
    'cursor-left': ['left'],
    'cursor-right': ['right'],
    'delete-backward': ['backspace', 'delete'],
    'delete-word': ['ctrl+w'],
    'delete-line': ['ctrl+u'],
  },
  'text-input': {
    submit: ['enter'],
    'cursor-left': ['left'],
    'cursor-right': ['right'],
    'cursor-up': ['up'],
    'cursor-down': ['down'],
    'delete-backward': ['backspace', 'delete'],
    'delete-word': ['ctrl+w'],
    'delete-line': ['ctrl+u'],
  },
  'autocomplete-menu': {
    previous: ['up'],
    next: ['down'],
    close: ['escape'],
    accept: ['tab'],
    execute: ['enter'],
  },
  'queued-prompt': { cancel: ['backspace', 'delete'] },
  'confirm-prompt': {
    previous: ['left', 'up'],
    next: ['right', 'down'],
    confirm: ['enter'],
    'choose-yes': ['y'],
    'choose-no': ['n'],
  },
  'permission-prompt': {
    previous: ['left', 'up'],
    next: ['right', 'down'],
    confirm: ['enter'],
    'allow-once': ['y'],
    'allow-session': ['s', 'a'],
    'allow-project': ['p'],
    deny: ['n', 'd'],
  },
  'text-prompt': {
    submit: ['enter'],
    cancel: ['escape'],
    'delete-backward': ['backspace', 'delete'],
  },
  'list-picker': { previous: ['up'], next: ['down'], select: ['enter'], cancel: ['escape'] },
  'menu-select': { previous: ['up'], next: ['down'], select: ['enter'], back: ['escape'] },
  'multi-select': {
    previous: ['up'],
    next: ['down'],
    toggle: ['space'],
    confirm: ['enter'],
    cancel: ['escape'],
  },
  'workspace-switcher': {
    previous: ['up'],
    next: ['down'],
    select: ['enter'],
    close: ['ctrl+b', 'escape'],
    attach: ['a'],
  },
  'background-list': {
    previous: ['up'],
    next: ['down'],
    open: ['enter'],
    close: ['escape'],
  },
  'transport-settings': {
    previous: ['up'],
    next: ['down'],
    toggle: ['space'],
    close: ['enter', 'escape'],
  },
  'history-search': {
    previous: ['up'],
    next: ['down', 'ctrl+r'],
    'cycle-scope': ['ctrl+s'],
    insert: ['enter', 'tab'],
    execute: ['ctrl+e'],
    cancel: ['escape'],
  },
  'theme-picker': {
    previous: ['up'],
    next: ['down'],
    select: ['enter'],
    cancel: ['escape'],
  },
} as const satisfies TDefaultKeybindings;

export const TEXT_ENTRY_CONTEXTS: ReadonlySet<TKeybindingContext> = new Set([
  'chat-input',
  'text-input',
  'text-prompt',
  'history-search',
]);
