import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parsePermissionMode,
  parseMaxTurns,
  parseOutputFormat,
  parseCliArgs,
  parseToolList,
  printHelp,
} from '../cli-args.js';

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

describe('parseOutputFormat', () => {
  it('returns undefined for undefined input', () => {
    expect(parseOutputFormat(undefined)).toBeUndefined();
  });

  it('returns valid output formats', () => {
    expect(parseOutputFormat('text')).toBe('text');
    expect(parseOutputFormat('json')).toBe('json');
    expect(parseOutputFormat('stream-json')).toBe('stream-json');
  });

  it('throws for invalid format', () => {
    expect(() => parseOutputFormat('xml')).toThrow(
      'Invalid --output-format "xml". Valid: text | json | stream-json',
    );
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

  it('parses user-local passthrough metadata flags', () => {
    process.argv = [
      'node',
      'cli',
      'user-local',
      'memory',
      'set',
      'view-preference',
      'last-panel',
      'background',
      '--summary',
      'Open the background panel',
      '--source',
      'user-input',
    ];
    const args = parseCliArgs();
    expect(args.summary).toBe('Open the background panel');
    expect(args.source).toBe('user-input');
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

  it('parses --task-file flag', () => {
    process.argv = ['node', 'cli', '-p', '--task-file', 'task.md', 'test'];
    const args = parseCliArgs();
    expect(args.taskFile).toBe('task.md');
  });

  it('defaults outputFormat to undefined', () => {
    process.argv = ['node', 'cli', '-p', 'test'];
    const args = parseCliArgs();
    expect(args.outputFormat).toBeUndefined();
  });

  it('parses provider configuration flags', () => {
    process.argv = [
      'node',
      'cli',
      '--configure-provider',
      'openai',
      '--provider',
      'openai',
      '--type',
      'openai',
      '--base-url',
      'http://localhost:1234/v1',
      '--api-key-env',
      'LM_STUDIO_API_KEY',
      '--set-current',
    ];

    const args = parseCliArgs();

    expect(args.configureProvider).toBe('openai');
    expect(args.provider).toBe('openai');
    expect(args.providerType).toBe('openai');
    expect(args.baseURL).toBe('http://localhost:1234/v1');
    expect(args.apiKeyEnv).toBe('LM_STUDIO_API_KEY');
    expect(args.setCurrent).toBe(true);
  });

  it('parses update-check flags', () => {
    process.argv = ['node', 'cli', '--check-update', '--disable-update-check'];

    const args = parseCliArgs();

    expect(args.checkUpdate).toBe(true);
    expect(args.disableUpdateCheck).toBe(true);
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

describe('help flag', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses --help flag', () => {
    process.argv = ['node', 'cli', '--help'];
    expect(parseCliArgs().help).toBe(true);
  });

  it('parses -h short flag', () => {
    process.argv = ['node', 'cli', '-h'];
    expect(parseCliArgs().help).toBe(true);
  });

  it('defaults help to false', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().help).toBe(false);
  });

  it('printHelp returns help text string', () => {
    const output = printHelp();
    expect(output).toContain('--help');
    expect(output).toContain('--version');
    expect(output).toContain('-p');
  });
});

describe('parseToolList', () => {
  it('returns undefined for undefined input', () => {
    expect(parseToolList(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseToolList('')).toBeUndefined();
  });

  it('splits a comma-separated list', () => {
    expect(parseToolList('Read,Bash')).toEqual(['Read', 'Bash']);
  });

  it('trims entries and drops empties', () => {
    expect(parseToolList(' Read , ,Bash ')).toEqual(['Read', 'Bash']);
  });
});

describe('--dry-run permission mode alias', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('TC-03: maps --dry-run to permissionMode plan', () => {
    process.argv = ['node', 'cli', '--dry-run'];
    const args = parseCliArgs();
    expect(args.dryRun).toBe(true);
    expect(args.permissionMode).toBe('plan');
  });

  it('TC-03: accepts --dry-run with explicit --permission-mode plan', () => {
    process.argv = ['node', 'cli', '--dry-run', '--permission-mode', 'plan'];
    expect(parseCliArgs().permissionMode).toBe('plan');
  });

  it('TC-03: throws on --dry-run with a conflicting --permission-mode', () => {
    process.argv = ['node', 'cli', '--dry-run', '--permission-mode', 'acceptEdits'];
    expect(() => parseCliArgs()).toThrow(/--dry-run.*--permission-mode/);
  });
});

describe('print-mode session flag validation (CLI-063)', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('TC-04: throws on print mode with an empty resume id (-r "")', () => {
    process.argv = ['node', 'cli', '-p', 'hi', '-r', ''];
    expect(() => parseCliArgs()).toThrow(/Print mode requires an explicit session id/);
  });

  it('TC-04: bare -r is a parse error in any mode (parseArgs argument missing)', () => {
    process.argv = ['node', 'cli', '-p', 'hi', '-r'];
    expect(() => parseCliArgs()).toThrow(/argument missing/);
  });

  it('TC-04: accepts print mode with an explicit -r id', () => {
    process.argv = ['node', 'cli', '-p', 'hi', '-r', 'session_abc'];
    expect(parseCliArgs().resumeId).toBe('session_abc');
  });

  it('TC-04: accepts an empty -r "" outside print mode (TUI session picker)', () => {
    process.argv = ['node', 'cli', '-r', ''];
    expect(parseCliArgs().resumeId).toBe('');
  });

  it('TC-05: throws on print mode with -c and --no-session-persistence', () => {
    process.argv = ['node', 'cli', '-p', 'hi', '-c', '--no-session-persistence'];
    expect(() => parseCliArgs()).toThrow(/--no-session-persistence conflicts/);
  });

  it('TC-05: throws on print mode with -r <id> and --no-session-persistence', () => {
    process.argv = ['node', 'cli', '-p', 'hi', '-r', 'session_abc', '--no-session-persistence'];
    expect(() => parseCliArgs()).toThrow(/--no-session-persistence conflicts/);
  });

  it('TC-05: accepts --no-session-persistence in print mode without -c/-r', () => {
    process.argv = ['node', 'cli', '-p', 'hi', '--no-session-persistence'];
    expect(parseCliArgs().noSessionPersistence).toBe(true);
  });
});

describe('printHelp flag coverage', () => {
  it('TC-04: lists --json-schema', () => {
    expect(printHelp()).toContain('--json-schema');
  });

  it('TC-04: describes --dry-run as a plan-mode alias', () => {
    expect(printHelp()).toMatch(/--dry-run\s+Alias for --permission-mode plan/);
  });

  it('TC-04: lists tool filter flags', () => {
    expect(printHelp()).toContain('--allowed-tools');
    expect(printHelp()).toContain('--denied-tools');
  });
});
