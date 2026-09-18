export interface IKeyInput {
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
  readonly return?: boolean;
  readonly escape?: boolean;
  readonly tab?: boolean;
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly leftArrow?: boolean;
  readonly rightArrow?: boolean;
  readonly backspace?: boolean;
  readonly delete?: boolean;
}

const MODIFIER_ALIASES: Readonly<Record<string, 'ctrl' | 'alt' | 'meta' | 'shift'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  shift: 'shift',
};
const MODIFIER_ORDER = ['ctrl', 'alt', 'meta', 'shift'] as const;
const KEY_ALIASES: Readonly<Record<string, string>> = {
  return: 'enter',
  enter: 'enter',
  esc: 'escape',
  escape: 'escape',
  tab: 'tab',
  space: 'space',
  spacebar: 'space',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  backspace: 'backspace',
  delete: 'delete',
};

export function normalizeBinding(raw: string): string | undefined {
  const strokes = raw.trim().split(/\s+/u);
  if (strokes.length < 1 || strokes.length > 2) return undefined;
  const normalized = strokes.map(normalizeStroke);
  return normalized.every((stroke): stroke is string => stroke !== undefined)
    ? normalized.join(' ')
    : undefined;
}

function normalizeStroke(raw: string): string | undefined {
  if (!raw || raw.includes(' ')) return undefined;
  const parts = raw.split('+');
  if (parts.some((part) => part.length === 0)) return undefined;
  const rawKey = parts.at(-1);
  if (rawKey === undefined) return undefined;
  const modifiers = new Set<'ctrl' | 'alt' | 'meta' | 'shift'>();
  for (const rawModifier of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[rawModifier.toLowerCase()];
    if (modifier === undefined || modifiers.has(modifier)) return undefined;
    modifiers.add(modifier);
  }
  let key = KEY_ALIASES[rawKey.toLowerCase()];
  if (key === undefined) {
    if ([...rawKey].length !== 1 || /\s/u.test(rawKey)) return undefined;
    key = rawKey.toLowerCase();
    if (parts.length === 1 && rawKey !== key) modifiers.add('shift');
  }
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

function keyStrokeFromInput(input: string, key: IKeyInput): string | undefined {
  // Ink preserves LF as a one-character input string instead of setting `key.return`. In terminal
  // raw mode that byte is Ctrl+J; normalize it before printable-text handling can treat it as paste.
  if (/^[\r\n]*\n[\r\n]*$/u.test(input)) return 'ctrl+j';
  const special = key.return
    ? 'enter'
    : key.escape
      ? 'escape'
      : key.tab
        ? 'tab'
        : key.upArrow
          ? 'up'
          : key.downArrow
            ? 'down'
            : key.leftArrow
              ? 'left'
              : key.rightArrow
                ? 'right'
                : key.backspace
                  ? 'backspace'
                  : key.delete
                    ? 'delete'
                    : input === ' '
                      ? 'space'
                      : [...input].length === 1
                        ? input.toLowerCase()
                        : undefined;
  if (special === undefined) return undefined;
  const modifiers = [
    ...(key.ctrl ? ['ctrl'] : []),
    ...(key.meta ? ['meta'] : []),
    ...(key.shift ? ['shift'] : []),
  ];
  return [...modifiers, special].join('+');
}

/**
 * Terminal protocols collapse several control characters onto named keys. Keep the configured
 * spelling for hints, but offer every spelling that the same received byte can represent.
 */
export function keyStrokesFromInput(input: string, key: IKeyInput): readonly string[] {
  const primary = keyStrokeFromInput(input, key);
  if (primary === undefined) return [];
  if (primary === 'enter') return ['enter', 'ctrl+m'];
  if (primary === 'tab') return ['tab', 'ctrl+i'];
  if (primary === 'escape') return ['escape', 'ctrl+['];
  return [primary];
}

export function keybindingDeliverySignature(binding: string): string {
  return binding
    .split(' ')
    .map((stroke) => {
      if (stroke === 'ctrl+m') return 'enter';
      if (stroke === 'ctrl+i') return 'tab';
      if (stroke === 'ctrl+[') return 'escape';
      return stroke;
    })
    .join(' ');
}

export function displayBinding(binding: string): string {
  const displayStroke = (stroke: string): string =>
    stroke
      .split('+')
      .map(
        (part) =>
          ({
            ctrl: 'Ctrl',
            alt: 'Alt',
            meta: 'Meta',
            shift: 'Shift',
            escape: 'Esc',
            up: '↑',
            down: '↓',
            left: '←',
            right: '→',
          })[part] ??
          (part.length === 1 ? part.toUpperCase() : `${part[0]?.toUpperCase()}${part.slice(1)}`),
      )
      .join('+');
  return binding.split(' ').map(displayStroke).join(' ');
}
