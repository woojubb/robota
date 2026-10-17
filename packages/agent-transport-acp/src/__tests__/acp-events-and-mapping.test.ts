import { describe, expect, expectTypeOf, it } from 'vitest';

import { permissionDecision, permissionOptions } from '../acp-permission.js';
import { promptText } from '../acp-prompt-text.js';
import { ACP_SESSION_EVENT_POLICY, subscribeAcpEvents } from '../acp-session-events.js';
import { acpToolKind, acpToolTitle } from '../acp-tool-mapping.js';

import { createFakeSession } from './acp-test-harness.js';

import type { TAcpSubscribedEvent } from '../acp-session-events.js';
import type { TInteractiveEventName } from '@robota-sdk/agent-interface-session';

describe('session event policy', () => {
  it('decides every session event, so a new one cannot be silently dropped', () => {
    expectTypeOf<keyof typeof ACP_SESSION_EVENT_POLICY>().toEqualTypeOf<TInteractiveEventName>();
    expect(Object.keys(ACP_SESSION_EVENT_POLICY)).toHaveLength(28);
  });

  it('subscribes exactly the streamed and permission events', () => {
    expectTypeOf<TAcpSubscribedEvent>().toEqualTypeOf<
      'text_delta' | 'tool_start' | 'tool_end' | 'permission_request'
    >();
    const fake = createFakeSession();
    const unsubscribe = subscribeAcpEvents(fake.session, {
      text_delta: () => {},
      tool_start: () => {},
      tool_end: () => {},
      permission_request: () => {},
    });
    expect([...fake.everSubscribed].sort()).toEqual([
      'permission_request',
      'text_delta',
      'tool_end',
      'tool_start',
    ]);
    unsubscribe();
    expect(fake.listenerCount('text_delta')).toBe(0);
  });

  it('never subscribes an ask, so the session answers it cancelled', () => {
    expect(ACP_SESSION_EVENT_POLICY.ask_request).toBe('ignore');
  });
});

describe('promptText', () => {
  it('joins text blocks and leaves a plain message untouched', () => {
    expect(
      promptText([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toEqual({
      typed: 'ab',
      full: 'ab',
    });
  });

  it('fences context longer than any backtick run inside it', () => {
    const { full } = promptText([
      { type: 'text', text: 'q' },
      { type: 'resource', resource: { uri: 'file:///a', text: 'x ````` y' } },
    ]);
    expect(full).toBe('q\n\nContext from file:///a:\n``````\nx ````` y\n``````');
  });

  it('ignores binary resources and media blocks', () => {
    expect(
      promptText([
        { type: 'text', text: 'q' },
        { type: 'resource', resource: { uri: 'file:///a', blob: 'AA' } },
        { type: 'audio', data: 'AA', mimeType: 'audio/wav' },
      ]).full,
    ).toBe('q');
  });
});

describe('tool and permission mapping', () => {
  it('titles a call by name and its one argument', () => {
    expect(acpToolTitle('Read', 'a.ts')).toBe('Read: a.ts');
    expect(acpToolTitle('Read', '  ')).toBe('Read');
    expect(acpToolTitle('Shell', 'a\n  b')).toBe('Shell: a b');
    expect(acpToolKind('Unknown')).toBe('other');
  });

  it('offers a project allow only when it can be persisted', () => {
    expect(permissionOptions(false).map((o) => o.optionId)).not.toContain('allow-project');
    expect(permissionOptions(true).map((o) => o.optionId)).toContain('allow-project');
  });

  it('never grants more than was offered', () => {
    const offered = permissionOptions(false);
    expect(permissionDecision({ outcome: 'selected', optionId: 'allow-project' }, offered)).toBe(
      false,
    );
    expect(permissionDecision({ outcome: 'selected', optionId: 'allow-session' }, offered)).toBe(
      'allow-session',
    );
    expect(permissionDecision({ outcome: 'cancelled' }, offered)).toBe(false);
  });
});
