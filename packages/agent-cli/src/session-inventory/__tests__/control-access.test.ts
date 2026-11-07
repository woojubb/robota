/**
 * The decision table of the control socket: every command has a plain and a secure disposition, the
 * plain column is what the socket answers today, and the secure column leaves a same-user program
 * only what costs the owner at most a stopped runtime.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTROL_ACCESS,
  isControlCommandName,
  type IControlAccess,
  type TControlAccessTable,
  type TControlCommandName,
} from '../control-access.js';

const COMMANDS = Object.keys(CONTROL_ACCESS) as TControlCommandName[];

describe('CONTROL_ACCESS', () => {
  it('has both dispositions for every command', () => {
    expect(COMMANDS).toHaveLength(12);
    for (const command of COMMANDS) {
      expect(['open', 'absent']).toContain(CONTROL_ACCESS[command].plain);
      expect(['open', 'open-trimmed', 'owner-control', 'absent']).toContain(
        CONTROL_ACCESS[command].secure,
      );
    }
  });

  it('keeps plain mode as it answers today: the owner commands open, lock, link and the daemon role absent', () => {
    const open = COMMANDS.filter((command) => CONTROL_ACCESS[command].plain === 'open').sort();
    expect(open).toEqual(
      [
        'attach',
        'connect',
        'events-list',
        'events-revoke',
        'link-pr',
        'rename',
        'status',
        'stop',
        'unlink-pr',
      ].sort(),
    );
  });

  it('leaves a same-user program only status, stop, lock and link in secure mode', () => {
    const open = COMMANDS.filter((command) =>
      ['open', 'open-trimmed'].includes(CONTROL_ACCESS[command].secure),
    ).sort();
    expect(open).toEqual(['link', 'lock', 'status', 'stop']);
    // Nothing that hands out a token or admits a session without a proof.
    expect(CONTROL_ACCESS.connect.secure).toBe('absent');
    expect(CONTROL_ACCESS.attach.secure).toBe('absent');
    // What names the work, or changes it, is the owner's.
    for (const command of ['rename', 'link-pr', 'unlink-pr', 'events-list', 'events-revoke'] as const) {
      expect(CONTROL_ACCESS[command].secure).toBe('owner-control');
    }
    expect(CONTROL_ACCESS['take-daemon-role'].secure).toBe('owner-control');
    expect(CONTROL_ACCESS.status.secure).toBe('open-trimmed');
  });

  it('knows a command by an own property only', () => {
    expect(isControlCommandName('status')).toBe(true);
    for (const name of ['toString', '__proto__', 'constructor', 'hasOwnProperty', '', 'Status', 7, null]) {
      expect(isControlCommandName(name)).toBe(false);
    }
  });

  it('does not compile for a command with no row', () => {
    const row: IControlAccess = { plain: 'open', secure: 'open' };
    const complete: TControlAccessTable<'a' | 'b'> = { a: row, b: row };
    // @ts-expect-error a table that lacks a row for one of its commands is refused by the compiler
    const incomplete: TControlAccessTable<'a' | 'b'> = { a: row };
    expect(Object.keys(complete)).toEqual(['a', 'b']);
    expect(Object.keys(incomplete)).toEqual(['a']);
  });
});
