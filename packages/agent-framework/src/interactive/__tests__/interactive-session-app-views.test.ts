import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_APP_VIEWS,
  MAX_TOOL_APP_VIEW_BYTES,
  MAX_TOOL_APP_VIEW_ENTRY_BYTES,
  ToolAppViewStore,
  pickToolAppView,
} from '../interactive-session-app-views.js';
import type { IToolAppView } from '@robota-sdk/agent-core';

function view(html: string, extra: Partial<IToolAppView> = {}): IToolAppView {
  return {
    sourceId: 'files',
    resourceUri: 'ui://files/list',
    mimeType: 'text/html;profile=mcp-app',
    html,
    callableTools: {},
    ...extra,
  };
}

/** The bytes the store measures for `view('')`, so a limit can be set to an exact number of html bytes. */
const FRAME_BYTES = Buffer.byteLength(JSON.stringify(view('')), 'utf8');

describe('the live-only store of tool app views', () => {
  it('bounds a session at 16 views, 4 MiB each and 16 MiB in all', () => {
    expect(MAX_TOOL_APP_VIEWS).toBe(16);
    expect(MAX_TOOL_APP_VIEW_ENTRY_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_TOOL_APP_VIEW_BYTES).toBe(16 * 1024 * 1024);
  });

  it('returns what was put and nothing for an unknown id', () => {
    const store = new ToolAppViewStore();
    const kept = view('<p>a</p>');
    expect(store.put('view-a', kept)).toBe(true);
    expect(store.get('view-a')).toBe(kept);
    expect(store.get('view-b')).toBeUndefined();
  });

  it('evicts the oldest view when the count passes the limit', () => {
    const store = new ToolAppViewStore();
    for (let index = 0; index < MAX_TOOL_APP_VIEWS + 2; index += 1) {
      store.put(`view-${index}`, view(`<p>${index}</p>`));
    }
    expect(store.get('view-0')).toBeUndefined();
    expect(store.get('view-1')).toBeUndefined();
    expect(store.get('view-2')).toBeDefined();
    expect(store.get(`view-${MAX_TOOL_APP_VIEWS + 1}`)).toBeDefined();
  });

  it('measures the whole serialized view in UTF-8 bytes, not only its document', () => {
    const store = new ToolAppViewStore({ maxBytes: FRAME_BYTES * 2 + 50 });
    store.put('first', view('', { structuredContent: { rows: 'x'.repeat(10) } }));
    store.put('second', view('', { structuredContent: { rows: 'x'.repeat(10) } }));
    // The document of every view is empty: only structured content and the frame take space.
    expect(store.get('first')).toBeUndefined();
    expect(store.get('second')).toBeDefined();

    const bytes = new ToolAppViewStore({ maxBytes: FRAME_BYTES * 2 + 9 });
    bytes.put('first', view('abcd'));
    bytes.put('second', view('efgh'));
    expect(bytes.get('first')).toBeDefined();
    // Three characters, nine bytes: the count in characters would have kept the first two.
    bytes.put('third', view('€'.repeat(3)));
    expect(bytes.get('first')).toBeUndefined();
    expect(bytes.get('second')).toBeUndefined();
    expect(bytes.get('third')).toBeDefined();
  });

  it('refuses a view over the per-entry cap before evicting anything, and says so', () => {
    // The budget has room for exactly the small view and the large one, so evicting for the large
    // one would be visible; the per-entry cap must refuse it first.
    const store = new ToolAppViewStore({ maxEntryBytes: FRAME_BYTES + 4, maxBytes: FRAME_BYTES * 2 + 9 });
    expect(store.put('small', view('ab'))).toBe(true);
    expect(store.put('large', view('abcdefgh'))).toBe(false);
    expect(store.get('large')).toBeUndefined();
    // Nothing was flushed to make room for a view that was never going to fit.
    expect(store.get('small')).toBeDefined();
  });

  it('refuses a view larger than the whole budget the same way', () => {
    const store = new ToolAppViewStore({ maxBytes: FRAME_BYTES + 4 });
    expect(store.put('small', view('ab'))).toBe(true);
    expect(store.put('large', view('abcdefgh'))).toBe(false);
    expect(store.get('small')).toBeDefined();
  });

  it('counts a replaced view once and makes it the newest', () => {
    const store = new ToolAppViewStore({ maxEntries: 2 });
    store.put('a', view('1'));
    store.put('b', view('2'));
    store.put('a', view('3'));
    store.put('c', view('4'));
    expect(store.get('a')).toBeDefined();
    expect(store.get('b')).toBeUndefined();
    expect(store.get('c')).toBeDefined();
  });

  it('forgets everything on clear and counts from zero afterwards', () => {
    const store = new ToolAppViewStore({ maxBytes: FRAME_BYTES + 4 });
    store.put('a', view('1234'));
    store.clear();
    expect(store.get('a')).toBeUndefined();
    expect(store.put('b', view('1234'))).toBe(true);
    expect(store.get('b')).toBeDefined();
  });
});

describe('what counts as a view a source sent', () => {
  it('keeps only the known fields of a well formed view', () => {
    const picked = pickToolAppView({
      ...view('<p>x</p>', {
        callableTools: { list_files: 'mcp__files__list_files' },
        toolInput: { path: 'src' },
        structuredContent: { rows: 3 },
      }),
      extra: 'dropped',
    });
    expect(picked).toEqual(
      view('<p>x</p>', {
        callableTools: { list_files: 'mcp__files__list_files' },
        toolInput: { path: 'src' },
        structuredContent: { rows: 3 },
      }),
    );
    expect(picked).not.toHaveProperty('extra');
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['null', null],
    ['an array', []],
    ['a string', '<main/>'],
    ['no sourceId', { ...view('x'), sourceId: undefined }],
    ['a numeric sourceId', { ...view('x'), sourceId: 1 }],
    ['no resourceUri', { ...view('x'), resourceUri: undefined }],
    ['no mimeType', { ...view('x'), mimeType: undefined }],
    ['a non-string document', { ...view('x'), html: { raw: 'x' } }],
    ['no callableTools', { ...view('x'), callableTools: undefined }],
    ['callableTools as an array', { ...view('x'), callableTools: ['a'] }],
    ['callableTools naming a non-string', { ...view('x'), callableTools: { a: 1 } }],
    ['toolInput as an array', { ...view('x'), toolInput: [] }],
    ['toolInput as a string', { ...view('x'), toolInput: 'path=src' }],
  ])('drops %s', (_label, value) => {
    expect(pickToolAppView(value)).toBeUndefined();
  });
});
