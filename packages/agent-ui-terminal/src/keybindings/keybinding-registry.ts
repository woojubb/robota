import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_ACTIONS,
  TEXT_ENTRY_CONTEXTS,
  type TKeybindingAction,
  type TKeybindingContext,
} from './keybinding-catalogue.js';
import {
  displayBinding,
  keybindingDeliverySignature,
  keyStrokesFromInput,
  normalizeBinding,
  type IKeyInput,
} from './keybinding-syntax.js';

export { DEFAULT_KEYBINDINGS } from './keybinding-catalogue.js';
export type { IKeyInput } from './keybinding-syntax.js';
export type { TKeybindingAction, TKeybindingContext } from './keybinding-catalogue.js';

export interface IKeybindingWarning {
  readonly code: 'multiplexer-conflict' | 'modifier-delivery';
  readonly path: string;
  readonly message: string;
}

export interface IKeybindingDiagnostic {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export interface IKeybindingSnapshot {
  readonly generation: number;
  readonly sourcePath: string;
  readonly bindings: Readonly<
    Record<TKeybindingContext, Readonly<Record<string, readonly string[]>>>
  >;
  readonly warnings: readonly IKeybindingWarning[];
  readonly diagnostic?: IKeybindingDiagnostic;
}

export type TParseKeybindingsResult =
  | { readonly ok: true; readonly snapshot: IKeybindingSnapshot }
  | { readonly ok: false; readonly diagnostic: IKeybindingDiagnostic };

type TJsonValue = string | number | boolean | null | TJsonValue[] | TJsonRecord;
interface TJsonRecord {
  [key: string]: TJsonValue;
}

const CHORD_TIMEOUT_MS = 1_000;

function diagnostic(file: string, path: string, message: string): TParseKeybindingsResult {
  return { ok: false, diagnostic: { file, path, message } };
}

function isRecord(value: TJsonValue): value is TJsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneDefaults(): Record<TKeybindingContext, Record<string, string[]>> {
  return Object.fromEntries(
    Object.entries(DEFAULT_KEYBINDINGS).map(([context, actions]) => [
      context,
      Object.fromEntries(
        Object.entries(actions).map(([action, bindings]) => [action, [...bindings]]),
      ),
    ]),
  ) as Record<TKeybindingContext, Record<string, string[]>>;
}

function bindingValues(value: TJsonValue): readonly string[] | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return undefined;
}

function validateContextBindings(
  context: TKeybindingContext,
  bindings: Record<string, string[]>,
  file: string,
): TParseKeybindingsResult | undefined {
  const owners = new Map<string, string>();
  const prefixes = new Map<string, string>();
  for (const [action, values] of Object.entries(bindings)) {
    for (const binding of values) {
      const deliveryBinding = keybindingDeliverySignature(binding);
      const owner = owners.get(deliveryBinding);
      const actionPath = `$.bindings.${context}.${action}`;
      if (owner !== undefined && owner !== action) {
        return diagnostic(file, actionPath, `Binding duplicates action ${owner}.`);
      }
      const strokes = deliveryBinding.split(' ');
      if (strokes.length > 1 && TEXT_ENTRY_CONTEXTS.has(context) && isPrintable(strokes[0] ?? '')) {
        return diagnostic(
          file,
          actionPath,
          'Printable text cannot begin a chord in a text context.',
        );
      }
      owners.set(deliveryBinding, action);
      if (strokes.length > 1) prefixes.set(strokes[0] ?? '', action);
    }
  }
  for (const [binding, action] of owners) {
    const prefixOwner = prefixes.get(binding);
    if (prefixOwner !== undefined) {
      return diagnostic(
        file,
        `$.bindings.${context}.${prefixOwner}`,
        `Chord prefix collides with action ${action}.`,
      );
    }
  }
  return undefined;
}

function isPrintable(stroke: string): boolean {
  return !stroke.includes('+') && [...stroke].length === 1;
}

function warningFor(binding: string, path: string): IKeybindingWarning[] {
  const warnings: IKeybindingWarning[] = [];
  if (binding.split(' ').includes('ctrl+b')) {
    warnings.push({
      code: 'multiplexer-conflict',
      path,
      message: 'Ctrl+B may be captured by a terminal multiplexer.',
    });
  }
  if (/ctrl\+shift\+[a-z]/u.test(binding)) {
    warnings.push({
      code: 'modifier-delivery',
      path,
      message: 'This terminal may not distinguish Ctrl+Shift from Ctrl.',
    });
  }
  return warnings;
}

export function parseKeybindingsDocument(text: string, file: string): TParseKeybindingsResult {
  let value: TJsonValue;
  try {
    value = JSON.parse(text) as TJsonValue;
  } catch (cause) {
    return diagnostic(file, '$', cause instanceof Error ? cause.message : 'Invalid JSON.');
  }
  if (!isRecord(value)) return diagnostic(file, '$', 'Expected an object.');
  if (value.version !== 1) return diagnostic(file, '$.version', 'Expected version 1.');
  if (!isRecord(value.bindings)) return diagnostic(file, '$.bindings', 'Expected an object.');

  const effective = cloneDefaults();
  const warnings: IKeybindingWarning[] = [];
  for (const [rawContext, rawActions] of Object.entries(value.bindings)) {
    if (!(rawContext in KEYBINDING_ACTIONS)) {
      return diagnostic(file, `$.bindings.${rawContext}`, 'Unknown keybinding context.');
    }
    const context = rawContext as TKeybindingContext;
    if (!isRecord(rawActions)) {
      return diagnostic(file, `$.bindings.${context}`, 'Expected an action object.');
    }
    for (const [action, rawBindings] of Object.entries(rawActions)) {
      if (!(KEYBINDING_ACTIONS[context] as readonly string[]).includes(action)) {
        return diagnostic(file, `$.bindings.${context}.${action}`, 'Unknown action.');
      }
      const values = bindingValues(rawBindings);
      const actionPath = `$.bindings.${context}.${action}`;
      if (values === undefined) {
        return diagnostic(file, actionPath, 'Expected a binding, binding list, or null.');
      }
      if (values === null) {
        effective[context][action] = [];
        continue;
      }
      const normalized: string[] = [];
      for (const rawBinding of values) {
        const binding = normalizeBinding(rawBinding);
        if (binding === undefined) return diagnostic(file, actionPath, 'Invalid binding syntax.');
        if (binding.split(' ').includes('ctrl+c')) {
          return diagnostic(file, actionPath, 'Ctrl+C is reserved for two-stage shutdown.');
        }
        normalized.push(binding);
        warnings.push(...warningFor(binding, actionPath));
      }
      effective[context][action] = normalized;
    }
  }
  for (const context of Object.keys(effective) as TKeybindingContext[]) {
    const invalid = validateContextBindings(context, effective[context], file);
    if (invalid !== undefined) return invalid;
  }
  const bindings = Object.freeze(
    Object.fromEntries(
      Object.entries(effective).map(([context, actions]) => [
        context,
        Object.freeze(
          Object.fromEntries(
            Object.entries(actions).map(([action, bindings]) => [action, Object.freeze(bindings)]),
          ),
        ),
      ]),
    ),
  ) as IKeybindingSnapshot['bindings'];
  return {
    ok: true,
    snapshot: Object.freeze({
      generation: 0,
      sourcePath: file,
      bindings,
      warnings: Object.freeze(warnings),
    }),
  };
}

export interface IChordState {
  readonly context?: TKeybindingContext;
  readonly generation?: number;
  readonly strokes: readonly string[];
  readonly deadline?: number;
}

export function createEmptyChordState(): IChordState {
  return { strokes: [] };
}

function actionBindings(
  snapshot: IKeybindingSnapshot,
  context: TKeybindingContext,
): [TKeybindingAction, readonly string[]][] {
  return Object.entries(snapshot.bindings[context]) as [TKeybindingAction, readonly string[]][];
}

export function resolveKeybindingInput(options: {
  readonly snapshot: IKeybindingSnapshot;
  readonly state: IChordState;
  readonly context: TKeybindingContext;
  readonly input: string;
  readonly key: IKeyInput;
  readonly now: number;
}): {
  readonly state: IChordState;
  readonly actions: readonly TKeybindingAction[];
  readonly consumed: boolean;
} {
  const strokes = keyStrokesFromInput(options.input, options.key);
  if (strokes.length === 0) {
    return { state: createEmptyChordState(), actions: [], consumed: false };
  }
  const stateValid =
    options.state.context === options.context &&
    options.state.generation === options.snapshot.generation &&
    (options.state.deadline === undefined || options.now <= options.state.deadline) &&
    !options.key.escape;
  const prior = stateValid ? options.state.strokes : [];
  const entries = actionBindings(options.snapshot, options.context);
  for (const stroke of strokes) {
    const sequence = [...prior, stroke].join(' ');
    const exact = entries
      .filter(([, bindings]) => bindings.includes(sequence))
      .map(([action]) => action);
    if (exact.length > 0) {
      return { state: createEmptyChordState(), actions: exact, consumed: true };
    }
    if (
      entries.some(([, bindings]) => bindings.some((binding) => binding.startsWith(`${sequence} `)))
    ) {
      return {
        state: {
          context: options.context,
          generation: options.snapshot.generation,
          strokes: [...prior, stroke],
          deadline: options.now + CHORD_TIMEOUT_MS,
        },
        actions: [],
        consumed: true,
      };
    }
  }
  if (prior.length > 0) {
    return resolveKeybindingInput({ ...options, state: createEmptyChordState() });
  }
  return { state: createEmptyChordState(), actions: [], consumed: false };
}

export function keybindingHints<TContext extends TKeybindingContext>(
  snapshot: IKeybindingSnapshot,
  context: TContext,
  actions: readonly (readonly [
    TKeybindingAction<TContext> | readonly TKeybindingAction<TContext>[],
    string,
  ])[],
): { keys: string; label: string }[] {
  return actions.flatMap(([actionOrActions, label]) => {
    const grouped = Array.isArray(actionOrActions);
    const actionList = grouped ? actionOrActions : [actionOrActions];
    const bindings = actionList.flatMap((action) => {
      const values = snapshot.bindings[context][action] ?? [];
      return grouped ? values.slice(0, 1) : values;
    });
    const displayed = bindings.map(displayBinding);
    const keys = displayed.every((binding) => /^[↑↓←→]$/u.test(binding))
      ? displayed.join('')
      : displayed.join('/');
    return bindings.length === 0 ? [] : [{ keys, label }];
  });
}
