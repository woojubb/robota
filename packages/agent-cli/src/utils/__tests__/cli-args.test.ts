import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parsePermissionMode,
  parseMaxTurns,
  parseOutputFormat,
  parseCliArgs,
  printHelp,
} from '../cli-args.js';
import { toSessionRunOptions } from '../../startup/args-to-options.js';

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

  it('parses --dry-run flag', () => {
    process.argv = ['node', 'cli', '--dry-run', 'Refactor auth'];
    const args = parseCliArgs();
    expect(args.dryRun).toBe(true);
    expect(args.positional).toContain('Refactor auth');
  });

  it('defaults dryRun to false', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().dryRun).toBe(false);
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

// CLI-046: --denied-tools flag
describe('denied-tools flag', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  // TC-01: --denied-tools Bash → deniedTools parsed as string 'Bash'
  it('TC-01: parses --denied-tools Bash as deniedTools string', () => {
    process.argv = ['node', 'cli', '--denied-tools', 'Bash'];
    const args = parseCliArgs();
    expect(args.deniedTools).toBe('Bash');
  });

  // TC-02: --denied-tools "*" → deniedTools parsed as '*'
  it('TC-02: parses --denied-tools "*" as wildcard deniedTools', () => {
    process.argv = ['node', 'cli', '--denied-tools', '*'];
    const args = parseCliArgs();
    expect(args.deniedTools).toBe('*');
  });

  // TC-03: --allowed-tools and --denied-tools both present → toSessionRunOptions preserves both (denied wins in runtime)
  it('TC-03: toSessionRunOptions carries both allowedTools and deniedTools when used together', () => {
    process.argv = ['node', 'cli', '--allowed-tools', 'Read,Bash', '--denied-tools', 'Bash'];
    const args = parseCliArgs();
    const opts = toSessionRunOptions(args);
    expect(opts.allowedTools).toBe('Read,Bash');
    expect(opts.deniedTools).toBe('Bash');
  });

  it('defaults deniedTools to undefined when not specified', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().deniedTools).toBeUndefined();
  });

  it('parses comma-separated denied tools string', () => {
    process.argv = ['node', 'cli', '--denied-tools', 'Bash,Write'];
    expect(parseCliArgs().deniedTools).toBe('Bash,Write');
  });
});
