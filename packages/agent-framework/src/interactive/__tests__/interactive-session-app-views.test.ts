import { describe, expect, it } from 'vitest';

import {
  MAX_TOOL_APP_VIEWS,
  MAX_TOOL_APP_VIEW_BYTES,
  ToolAppViewStore,
} from '../interactive-session-app-views.js';
import type { IToolAppView } from '@robota-sdk/agent-core';

function view(html: string): IToolAppView {
  return {
    sourceId: 'files',
    resourceUri: 'ui://files/list',
    mimeType: 'text/html;profile=mcp-app',
    html,
    callableTools: {},
  };
}

describe('the live-only store of tool app views', () => {
  it('bounds a session at 16 views and 16 MiB of document', () => {
    expect(MAX_TOOL_APP_VIEWS).toBe(16);
    expect(MAX_TOOL_APP_VIEW_BYTES).toBe(16 * 1024 * 1024);
  });

  it('returns what was put and nothing for an unknown call', () => {
    const store = new ToolAppViewStore();
    const kept = view('<p>a</p>');
    store.put('call-a', kept);
    expect(store.get('call-a')).toBe(kept);
    expect(store.get('call-b')).toBeUndefined();
  });

  it('evicts the oldest view when the count passes the limit', () => {
    const store = new ToolAppViewStore();
    for (let index = 0; index < MAX_TOOL_APP_VIEWS + 2; index += 1) {
      store.put(`call-${index}`, view(`<p>${index}</p>`));
    }
    expect(store.get('call-0')).toBeUndefined();
    expect(store.get('call-1')).toBeUndefined();
    expect(store.get('call-2')).toBeDefined();
    expect(store.get(`call-${MAX_TOOL_APP_VIEWS + 1}`)).toBeDefined();
  });

  it('evicts the oldest views when their documents pass the byte limit, counting UTF-8 bytes', () => {
    const store = new ToolAppViewStore({ maxBytes: 10 });
    store.put('first', view('abcd'));
    store.put('second', view('efgh'));
    expect(store.get('first')).toBeDefined();
    // Three characters, nine bytes: the count in characters would have kept the first two.
    store.put('third', view('\u20ac'.repeat(3)));
    expect(store.get('first')).toBeUndefined();
    expect(store.get('second')).toBeUndefined();
    expect(store.get('third')).toBeDefined();
  });

  it('does not keep one view that cannot fit alone, and keeps none of the older ones for it', () => {
    const store = new ToolAppViewStore({ maxBytes: 4 });
    store.put('small', view('ab'));
    store.put('large', view('abcdefgh'));
    expect(store.get('large')).toBeUndefined();
    expect(store.get('small')).toBeUndefined();
  });

  it('counts a replaced view once and makes it the newest', () => {
    const store = new ToolAppViewStore({ maxEntries: 2, maxBytes: 6 });
    store.put('a', view('1234'));
    store.put('b', view('12'));
    store.put('a', view('12'));
    store.put('c', view('12'));
    expect(store.get('a')).toBeDefined();
    expect(store.get('b')).toBeUndefined();
    expect(store.get('c')).toBeDefined();
  });

  it('forgets everything on clear and counts from zero afterwards', () => {
    const store = new ToolAppViewStore({ maxBytes: 4 });
    store.put('a', view('1234'));
    store.clear();
    expect(store.get('a')).toBeUndefined();
    store.put('b', view('1234'));
    expect(store.get('b')).toBeDefined();
  });
});
