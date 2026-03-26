import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parsePermissionMode, parseMaxTurns, parseCliArgs } from '../cli-args.js';

describe('parsePermissionMode', () => {
  it('returns undefined for undefined input', () => {
    expect(parsePermissionMode(undefined)).toBeUndefined();
  });

  it('returns valid modes', () => {
    expect(parsePermissionMode('plan')).toBe('plan');
    expect(parsePermissionMode('default')).toBe('default');
    expect(parsePermissionMode('acceptEdits')).toBe('acceptEdits');
    expect(parsePermissionMode('bypassPermissions')).toBe('bypassPermissions');
  });
});

describe('parseMaxTurns', () => {
  it('returns undefined for undefined input', () => {
    expect(parseMaxTurns(undefined)).toBeUndefined();
  });

  it('parses valid positive integer', () => {
    expect(parseMaxTurns('5')).toBe(5);
    expect(parseMaxTurns('100')).toBe(100);
  });

  it('parses string with leading zeros', () => {
    expect(parseMaxTurns('05')).toBe(5);
  });
});

describe('parseCliArgs', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses --fork-session flag', () => {
    process.argv = ['node', 'cli', '--fork-session'];
    const args = parseCliArgs();
    expect(args.forkSession).toBe(true);
  });

  it('defaults forkSession to false', () => {
    process.argv = ['node', 'cli'];
    const args = parseCliArgs();
    expect(args.forkSession).toBe(false);
  });

  it('parses --name flag', () => {
    process.argv = ['node', 'cli', '--name', 'my-session'];
    const args = parseCliArgs();
    expect(args.sessionName).toBe('my-session');
  });

  it('parses -n short flag', () => {
    process.argv = ['node', 'cli', '-n', 'short-name'];
    const args = parseCliArgs();
    expect(args.sessionName).toBe('short-name');
  });

  it('defaults sessionName to undefined', () => {
    process.argv = ['node', 'cli'];
    const args = parseCliArgs();
    expect(args.sessionName).toBeUndefined();
  });
});
