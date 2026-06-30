import { describe, expect, it } from 'vitest';

import { humanizeToolName } from '../humanize-tool-name.js';

describe('humanizeToolName (SCREEN-012)', () => {
  it('strips the robota_command_ prefix to recover the command name', () => {
    expect(humanizeToolName('robota_command_agent')).toBe('agent');
    expect(humanizeToolName('robota_command_parallel')).toBe('parallel');
  });

  it('drops a trailing 8-hex projection hash', () => {
    expect(humanizeToolName('robota_command_some_long_command_1a2b3c4d')).toBe('some_long_command');
  });

  it('leaves non-command tool names unchanged', () => {
    expect(humanizeToolName('Shell')).toBe('Shell');
    expect(humanizeToolName('Read')).toBe('Read');
    expect(humanizeToolName('Bash')).toBe('Bash');
  });

  it('falls back to the original when stripping would leave nothing', () => {
    expect(humanizeToolName('robota_command_')).toBe('robota_command_');
  });
});
