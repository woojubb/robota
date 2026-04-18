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

  it('parses --output-format flag', () => {
    process.argv = ['node', 'cli', '-p', '--output-format', 'json', 'test'];
    const args = parseCliArgs();
    expect(args.outputFormat).toBe('json');
  });

  it('parses --system-prompt flag', () => {
    process.argv = ['node', 'cli', '-p', '--system-prompt', 'You are helpful', 'test'];
    const args = parseCliArgs();
    expect(args.systemPrompt).toBe('You are helpful');
  });

  it('parses --append-system-prompt flag', () => {
    process.argv = ['node', 'cli', '-p', '--append-system-prompt', 'Focus on tests', 'test'];
    const args = parseCliArgs();
    expect(args.appendSystemPrompt).toBe('Focus on tests');
  });

  it('defaults outputFormat to undefined', () => {
    process.argv = ['node', 'cli', '-p', 'test'];
    const args = parseCliArgs();
    expect(args.outputFormat).toBeUndefined();
  });
});

describe('new non-interactive flags', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses --bare flag', () => {
    process.argv = ['node', 'cli', '--bare'];
    expect(parseCliArgs().bare).toBe(true);
  });

  it('defaults bare to false', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().bare).toBe(false);
  });

  it('parses --allowed-tools flag', () => {
    process.argv = ['node', 'cli', '--allowed-tools', 'Bash,Read,Write'];
    expect(parseCliArgs().allowedTools).toBe('Bash,Read,Write');
  });

  it('defaults allowedTools to undefined', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().allowedTools).toBeUndefined();
  });

  it('parses --no-session-persistence flag', () => {
    process.argv = ['node', 'cli', '--no-session-persistence'];
    expect(parseCliArgs().noSessionPersistence).toBe(true);
  });

  it('defaults noSessionPersistence to false', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().noSessionPersistence).toBe(false);
  });

  it('parses --json-schema flag', () => {
    process.argv = ['node', 'cli', '--json-schema', '{"type":"object"}'];
    expect(parseCliArgs().jsonSchema).toBe('{"type":"object"}');
  });

  it('defaults jsonSchema to undefined', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().jsonSchema).toBeUndefined();
  });
});
