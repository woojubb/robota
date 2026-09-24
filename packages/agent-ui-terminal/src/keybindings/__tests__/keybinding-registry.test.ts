import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { KEYBINDING_ACTIONS } from '../keybinding-catalogue.js';
import {
  createEmptyChordState,
  DEFAULT_KEYBINDINGS,
  keybindingHints,
  parseKeybindingsDocument,
  resolveKeybindingInput,
} from '../keybinding-registry.js';

const SOURCE = '/tmp/robota-keybindings.json';

function parse(document: unknown) {
  return parseKeybindingsDocument(JSON.stringify(document), SOURCE);
}

describe('contextual keybinding registry', () => {
  it('normalizes aliases and uppercase, reuses bindings by context, and applies null unbinding', () => {
    const result = parse({
      version: 1,
      bindings: {
        'chat-input': { submit: 'control+j', 'history-previous': null },
        'autocomplete-menu': { accept: 'ctrl+j' },
        'workspace-switcher': { attach: 'A' },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.bindings['chat-input'].submit).toEqual(['ctrl+j']);
    expect(result.snapshot.bindings['chat-input']['history-previous']).toEqual([]);
    expect(result.snapshot.bindings['autocomplete-menu'].accept).toEqual(['ctrl+j']);
    expect(result.snapshot.bindings['workspace-switcher'].attach).toEqual(['shift+a']);
    expect(result.snapshot.bindings['chat-input']['cursor-left']).toEqual(
      DEFAULT_KEYBINDINGS['chat-input']['cursor-left'],
    );
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it.each([
    [{ version: 1, bindings: { missing: { submit: 'enter' } } }, '$.bindings.missing'],
    [
      { version: 1, bindings: { 'chat-input': { missing: 'enter' } } },
      '$.bindings.chat-input.missing',
    ],
    [
      { version: 1, bindings: { 'chat-input': { submit: 'ctrl+c' } } },
      '$.bindings.chat-input.submit',
    ],
    // SCREEN-1993: Ctrl+C stays reserved in the search overlay too.
    [
      { version: 1, bindings: { 'history-search': { execute: 'ctrl+c' } } },
      '$.bindings.history-search.execute',
    ],
    [
      {
        version: 1,
        bindings: { 'chat-input': { submit: 'ctrl+j', 'history-previous': 'control+j' } },
      },
      '$.bindings.chat-input.history-previous',
    ],
    [
      {
        version: 1,
        bindings: { 'chat-input': { submit: 'ctrl+m', 'history-previous': 'enter' } },
      },
      '$.bindings.chat-input.history-previous',
    ],
    [
      {
        version: 1,
        bindings: { 'chat-input': { submit: 'ctrl+x', 'history-previous': 'ctrl+x ctrl+p' } },
      },
      '$.bindings.chat-input.history-previous',
    ],
    [{ version: 1, bindings: { 'chat-input': { submit: 'g g' } } }, '$.bindings.chat-input.submit'],
  ])('rejects an invalid replacement atomically with an exact path', (document, path) => {
    const result = parse(document);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.path).toBe(path);
    expect(result.diagnostic.file).toBe(SOURCE);
  });

  it('keeps multiplexer and undeliverable modifier conflicts as warnings', () => {
    const result = parse({
      version: 1,
      bindings: {
        app: { 'open-workspace-switcher': 'ctrl+b' },
        'workspace-switcher': { attach: 'ctrl+shift+a' },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.warnings.map((warning) => warning.code)).toEqual([
      'multiplexer-conflict',
      'modifier-delivery',
    ]);
  });

  it('resolves bounded chords and re-evaluates one mismatching stroke', () => {
    const parsed = parse({
      version: 1,
      bindings: {
        'workspace-switcher': { attach: 'g g', close: 'escape' },
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const first = resolveKeybindingInput({
      snapshot: parsed.snapshot,
      state: createEmptyChordState(),
      context: 'workspace-switcher',
      input: 'g',
      key: {},
      now: 100,
    });
    expect(first).toMatchObject({ actions: [], consumed: true });

    const mismatch = resolveKeybindingInput({
      snapshot: parsed.snapshot,
      state: first.state,
      context: 'workspace-switcher',
      input: '',
      key: { escape: true },
      now: 200,
    });
    expect(mismatch.actions).toEqual(['close']);
    expect(mismatch.state.strokes).toEqual([]);
  });

  it('resolves terminal control-code aliases without changing the configured label', () => {
    const parsed = parse({
      version: 1,
      bindings: { 'chat-input': { submit: 'ctrl+m' } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = resolveKeybindingInput({
      snapshot: parsed.snapshot,
      state: createEmptyChordState(),
      context: 'chat-input',
      input: '',
      key: { return: true },
      now: 0,
    });

    expect(result).toMatchObject({ actions: ['submit'], consumed: true });
    expect(keybindingHints(parsed.snapshot, 'chat-input', [['submit', 'Submit']])).toEqual([
      { keys: 'Ctrl+M', label: 'Submit' },
    ]);
  });

  it('resets pending chords on timeout, context change, and snapshot replacement', () => {
    const parsed = parse({
      version: 1,
      bindings: { 'workspace-switcher': { attach: 'g g' } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pending = resolveKeybindingInput({
      snapshot: parsed.snapshot,
      state: createEmptyChordState(),
      context: 'workspace-switcher',
      input: 'g',
      key: {},
      now: 0,
    }).state;

    for (const input of [
      { context: 'workspace-switcher' as const, now: 1_001, generation: 0, strokes: ['g'] },
      { context: 'list-picker' as const, now: 100, generation: 0, strokes: [] },
      { context: 'workspace-switcher' as const, now: 100, generation: 1, strokes: ['g'] },
    ]) {
      const snapshot = { ...parsed.snapshot, generation: input.generation };
      const result = resolveKeybindingInput({
        snapshot,
        state: pending,
        context: input.context,
        input: 'g',
        key: {},
        now: input.now,
      });
      expect(result.actions).toEqual([]);
      expect(result.state.strokes).toEqual(input.strokes);
    }
  });

  it('derives user-facing hints only from effective active bindings', () => {
    const parsed = parse({
      version: 1,
      bindings: { 'chat-input': { submit: 'ctrl+j', 'history-previous': null } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      keybindingHints(parsed.snapshot, 'chat-input', [
        ['history-previous', 'Previous'],
        ['submit', 'Submit'],
      ]),
    ).toEqual([{ keys: 'Ctrl+J', label: 'Submit' }]);
  });

  it('keeps the published JSON Schema aligned with every runtime context and action', () => {
    const schemaPath = new URL(
      '../../../../../apps/docs/public/schemas/keybindings.schema.json',
      import.meta.url,
    );
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
      $id: string;
      properties: { bindings: { properties: Record<string, { $ref: string }> } };
      $defs: Record<string, { properties?: Record<string, unknown> }>;
    };

    expect(schema.$id).toBe('https://docs.robota.io/schemas/keybindings.schema.json');
    expect(Object.keys(schema.properties.bindings.properties)).toEqual(
      Object.keys(KEYBINDING_ACTIONS),
    );
    for (const [context, actions] of Object.entries(KEYBINDING_ACTIONS)) {
      expect(Object.keys(schema.$defs[context]?.properties ?? {})).toEqual(actions);
    }
  });
});
