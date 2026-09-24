import { describe, expect, it } from 'vitest';

import { humanizeToolName } from '../humanize-tool-name.js';

describe('humanizeToolName (SCREEN-012)', () => {
  it('strips the neutral prefix to recover the command name', () => {
    expect(humanizeToolName('command_agent')).toBe('agent');
    expect(humanizeToolName('command_parallel')).toBe('parallel');
  });

  it('uses a host-selected prefix without changing other tool names', () => {
    expect(humanizeToolName('robota_command_agent', 'robota_command_')).toBe('agent');
    expect(humanizeToolName('acme_command_agent', 'acme_command_')).toBe('agent');
    expect(humanizeToolName('acme_command_agent')).toBe('acme_command_agent');
  });

  it('drops a trailing 8-hex projection hash', () => {
    expect(humanizeToolName('command_some_long_command_1a2b3c4d')).toBe('some_long_command');
  });

  it('leaves non-command tool names unchanged', () => {
    expect(humanizeToolName('Shell')).toBe('Shell');
    expect(humanizeToolName('Read')).toBe('Read');
    expect(humanizeToolName('Bash')).toBe('Bash');
  });

  it('falls back to the original when stripping would leave nothing', () => {
    expect(humanizeToolName('command_')).toBe('command_');
  });
});
