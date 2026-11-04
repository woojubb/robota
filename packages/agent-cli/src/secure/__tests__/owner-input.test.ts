/**
 * What counts as the owner being at the keyboard, for the idle lock: acting does, looking does not.
 * Paging, refreshes and reconnects must not keep the keys open for a viewer nobody is typing at.
 */
import { describe, expect, it } from 'vitest';

import { OWNER_CONTROL_ACTS, OWNER_INPUT, isOwnerControlAct, isOwnerInput } from '../owner-input.js';

describe('owner input in the session protocol', () => {
  it('counts what changes the session or answers it, and nothing that only reads', () => {
    const acting = Object.entries(OWNER_INPUT)
      .filter(([, counts]) => counts)
      .map(([type]) => type)
      .sort();
    expect(acting).toEqual(
      [
        'abort',
        'ask-response',
        'call-app-tool',
        'cancel-background-task',
        'cancel-queue',
        'close-background-task',
        'command',
        'delete-session',
        'new-session',
        'permission-response',
        'rename-session',
        'send-background-task',
        'stop-waiting-loop',
        'submit',
        'switch-session',
        'update-settings',
      ].sort(),
    );
  });

  it('does not count paging, refreshes, waits, acknowledgements or reconnects', () => {
    for (const type of [
      'get-history',
      'get-messages',
      'get-status',
      'get-executing',
      'list-sessions',
      'read-background-task-log',
      'read-execution-detail',
      'wait-background-job-group',
      'ack',
      'resume',
    ] as const) {
      expect(isOwnerInput(JSON.stringify({ type }))).toBe(false);
    }
  });

  it('reads the type of a serialized message, and counts nothing it cannot read', () => {
    expect(isOwnerInput(JSON.stringify({ type: 'submit', prompt: 'hello' }))).toBe(true);
    expect(
      isOwnerInput(JSON.stringify({ type: 'permission-response', id: 'p', result: true })),
    ).toBe(true);
    for (const data of [
      '',
      'not json',
      '{}',
      '[]',
      'null',
      '{"type":7}',
      '{"type":"toString"}',
      '{"type":"__proto__"}',
    ]) {
      expect(isOwnerInput(data)).toBe(false);
    }
  });
});

describe('owner control requests', () => {
  it('count what the owner changes in the runtime, and not what it reads', () => {
    const acting = Object.entries(OWNER_CONTROL_ACTS)
      .filter(([, counts]) => counts)
      .map(([command]) => command)
      .sort();
    expect(acting).toEqual(
      ['attach', 'events-revoke', 'link-pr', 'rename', 'take-daemon-role', 'unlink-pr'].sort(),
    );
    expect(isOwnerControlAct('rename')).toBe(true);
    expect(isOwnerControlAct('status')).toBe(false);
    expect(isOwnerControlAct('events-list')).toBe(false);
  });

  it('count nothing that is not a command', () => {
    for (const command of ['', 'toString', '__proto__', 'nope']) {
      expect(isOwnerControlAct(command)).toBe(false);
    }
  });
});
